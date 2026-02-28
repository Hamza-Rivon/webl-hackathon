/**
 * API Configuration
 *
 * Centralized configuration for the WEBL API service.
 * All environment variables are validated and typed here.
 */

// Load .env file from project root (../../ from apps/api/src/config/)
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../../../.env') });

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:3000',

  // Clerk Authentication
  clerk: {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '',
    secretKey: process.env.CLERK_SECRET_KEY || '',
    webhookSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET || process.env.CLERK_WEBHOOK_SECRET || '',
  },

  // Database (Neon PostgreSQL)
  database: {
    url: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL || '',
  },

  // Redis (Upstash)
  redis: {
    url: process.env.REDIS_URL || '',
    restUrl: process.env.UPSTASH_REDIS_REST_URL || '',
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  },

  // AWS S3
  s3: {
    region: process.env.AWS_REGION || 'eu-west-3',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: process.env.S3_BUCKET_NAME || '',
    cloudfrontUrl: process.env.CLOUDFRONT_URL || '',
  },

  // AI Services
  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase() as
      | 'gemini'
      | 'openai'
      | 'runpod'
      | 'mistral',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  },

  // Runpod/vLLM (OpenAI-compatible, used when AI_PROVIDER=runpod)
  vllm: {
    baseUrl: (process.env.VLLM_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.VLLM_MODEL || 'Qwen/Qwen3-VL-32B-Instruct',
    apiKey: process.env.VLLM_API_KEY || '',
  },

  // AWS Bedrock (for Mistral LLM when AI_PROVIDER=mistral)
  bedrock: {
    region: process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-west-2',
    bearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK || '',
    accessKeyId: process.env.AWS_BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    mistralModel: process.env.AWS_BEDROCK_MISTRAL_MODEL || 'mistral.magistral-small-2509',
  },

  // Mux Video (new)
  mux: {
    tokenId: process.env.MUX_TOKEN_ID || '',
    tokenSecret: process.env.MUX_TOKEN_SECRET || '',
    webhookSecret: process.env.MUX_WEBHOOK_SECRET || '',
  },

  // Security
  security: {
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:8081').split(','),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
} as const;

// Validate required configuration in production
export function validateConfig(): void {
  if (config.nodeEnv === 'production') {
    const required = [
      ['CLERK_SECRET_KEY', config.clerk.secretKey],
      ['DATABASE_URL', config.database.url],
      ['AWS_ACCESS_KEY_ID', config.s3.accessKeyId],
      ['AWS_SECRET_ACCESS_KEY', config.s3.secretAccessKey],
      ['S3_BUCKET_NAME', config.s3.bucketName],
      ['MUX_TOKEN_ID', config.mux.tokenId],
      ['MUX_TOKEN_SECRET', config.mux.tokenSecret],
    ];

    for (const [name, value] of required) {
      if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
      }
    }
  }
}
