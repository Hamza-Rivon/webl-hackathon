/**
 * Cron Jobs
 * 
 * Background jobs that run on a schedule.
 * Phase 5.3: Render orchestrator cron job.
 */

import { logger } from '@webl/shared';
import { renderOrchestrator } from './services/renderOrchestrator.js';

/**
 * Start all cron jobs
 */
export function startCronJobs(): void {
  // Run once on startup to avoid waiting for the first interval tick.
  void (async () => {
    try {
      await renderOrchestrator.wakeUp();
    } catch (error) {
      logger.error('Error in render orchestrator startup run:', error);
    }
  })();

  // Phase 5.3: Render orchestrator cron - runs every 30 seconds
  // This ensures any episodes waiting for render are checked regularly
  setInterval(async () => {
    try {
      await renderOrchestrator.wakeUp();
    } catch (error) {
      logger.error('Error in render orchestrator cron job:', error);
    }
  }, 30000); // 30 seconds

  logger.info('✅ Started cron jobs: render orchestrator (every 30s)');

  // Note: In a production environment, you might want to use a proper cron library
  // like node-cron or node-schedule for more robust scheduling and cleanup
}
