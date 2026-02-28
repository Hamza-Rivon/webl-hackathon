/**
 * WEBL Workers Entry Point
 *
 * Initializes all background job workers and starts processing.
 */

import { config } from './config.js';
import { logger } from '@webl/shared';
import { setupWorkers } from './workers.js';
import { connection } from './services/redis.js';
import { startDbPolling, stopDbPolling } from './services/dbPolling.js';
import { startCronJobs } from './cron.js';

/**
 * Validate AI provider configuration on startup
 * Ensures only one provider is configured and has the required API key
 */
function validateAIProviderConfig() {
  const provider = config.ai.provider;
  
  if (provider !== 'gemini' && provider !== 'openai') {
    throw new Error(
      `Invalid AI_PROVIDER="${provider}". Must be either "gemini" or "openai". ` +
      `Set AI_PROVIDER in .env to choose which provider to use.`
    );
  }
  
  // Validate that the selected provider has its API key configured
  if (provider === 'gemini') {
    if (!config.ai.geminiApiKey) {
      throw new Error(
        'AI_PROVIDER is set to "gemini" but GEMINI_API_KEY is not configured. ' +
        'Please set GEMINI_API_KEY in your .env file.'
      );
    }
    logger.info(`✅ AI Provider: Gemini (model: ${config.ai.geminiModel})`);
  } else if (provider === 'openai') {
    if (!config.openai.apiKey) {
      throw new Error(
        'AI_PROVIDER is set to "openai" but OPENAI_API_KEY is not configured. ' +
        'Please set OPENAI_API_KEY in your .env file.'
      );
    }
    logger.info(`✅ AI Provider: OpenAI (model: ${config.openai.model})`);
  }
  
  // Log that only the selected provider will be used
  logger.info(`ℹ️  Only ${provider.toUpperCase()} will be used for chunk selection (other provider will be ignored)`);
}

async function main() {
  try {
    logger.info('🚀 Starting WEBL Workers...');
    logger.info(`📍 Environment: ${config.nodeEnv}`);
    
    // Validate AI provider configuration before starting workers
    validateAIProviderConfig();

    let workers: any[] = [];
    let dbPollingInterval: NodeJS.Timeout | null = null;

    // Try to connect to Redis
    try {
      await connection.ping();
      logger.info('✅ Redis connected');

      // Setup all workers (requires Redis)
      workers = setupWorkers();
      logger.info(`✅ Started ${workers.length} workers`);
      logger.info('🎬 Workers ready and listening for jobs from Redis');

      // Start cron jobs
      startCronJobs();
    } catch (error) {
      logger.warn('⚠️ Redis connection failed, starting database polling fallback:', error);
      logger.info('📊 Workers will poll database for pending jobs');

      // Start database polling as fallback
      dbPollingInterval = startDbPolling();
    }

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down workers...`);
      
      if (workers.length > 0) {
        await Promise.all(workers.map((w) => w.close()));
      }
      
      if (dbPollingInterval) {
        stopDbPolling(dbPollingInterval);
      }
      
      try {
        await connection.quit();
      } catch {
        // Ignore if Redis wasn't connected
      }
      
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Monitor Redis connection and switch between modes
    setInterval(async () => {
      try {
        await connection.ping();
        // Redis is back - if we were using DB polling, we could switch back
        // For now, just log it
      } catch {
        // Redis still down - DB polling should handle it
      }
    }, 30000); // Check every 30 seconds
  } catch (error) {
    logger.error('Failed to start workers:', error);
    process.exit(1);
  }
}

main();
