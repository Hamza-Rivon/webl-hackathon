/**
 * Render Orchestrator Service
 * 
 * Orchestrator that wakes up blocked render jobs when dependencies become ready.
 * Runs as a background job that checks for eligible renders.
 * 
 * Phase 2.2: Wake-up orchestrator for render jobs.
 */

import { prisma } from './db.js';
import { logger } from '@webl/shared';
import { queues } from '../queue.js';
import { canRender } from './renderReadiness.js';

/**
 * Orchestrator that checks for episodes waiting for render and creates jobs when eligible
 */
export class RenderOrchestrator {
  /**
   * Check if any episodes are waiting for render and are now eligible
   * Creates and queues jobs for eligible episodes
   */
  async checkAndTriggerEligibleRenders(): Promise<void> {
    // Find episodes with render requested but not yet started
    const episodesWaitingForRender = await prisma.episode.findMany({
      where: {
        renderRequested: true,
        renderJobId: null, // No job created yet
        status: 'cut_plan_ready',
      },
      select: {
        id: true,
        userId: true,
        renderRequestedAt: true,
      },
    });

    logger.debug(
      `Render orchestrator: Found ${episodesWaitingForRender.length} episodes waiting for final render`
    );

    for (const episode of episodesWaitingForRender) {
      const readiness = await canRender(episode.id, 'final');

      if (readiness.eligible) {
        logger.info(`Episode ${episode.id} now eligible for final render, triggering job`);

        // Create and queue job
        const job = await prisma.job.create({
          data: {
            type: 'ffmpeg_render_microcut_v2',
            status: 'pending',
            episodeId: episode.id,
            userId: episode.userId,
          },
        });

        // Update episode with job ID
        await prisma.episode.update({
          where: { id: episode.id },
          data: {
            renderJobId: job.id,
            status: 'rendering',
            renderRequested: true,
            renderRequestedAt: episode.renderRequestedAt ?? new Date(),
          },
        });

        // Queue the job
        await queues.ffmpegRenderMicrocutV2.add('ffmpeg-render-microcut-v2', {
          jobId: job.id,
          episodeId: episode.id,
          userId: episode.userId,
        });

        logger.info(`Created and queued render job ${job.id} for episode ${episode.id}`, {
          renderEngine: 'ffmpeg_microcut_v2',
        });
      } else {
        logger.debug(
          `Episode ${episode.id} not yet eligible for final render: ${readiness.reason}`
        );
      }
    }
  }

  /**
   * Run orchestrator check (call this from cron job or after job completion)
   */
  async wakeUp(): Promise<void> {
    try {
      await this.checkAndTriggerEligibleRenders();
    } catch (error) {
      logger.error('Error in render orchestrator wakeUp:', error);
      throw error;
    }
  }
}

export const renderOrchestrator = new RenderOrchestrator();
