/**
 * Progress Publisher Service
 *
 * Publishes job progress updates to Redis Pub/Sub channels for real-time SSE streaming.
 * Requirements: 5.1
 */

import { connection } from './redis.js';
import { logger } from '@webl/shared';

/**
 * Job progress status values matching Prisma JobStatus enum
 */
export type ProgressStatus = 'pending' | 'processing' | 'done' | 'error';

/**
 * Job stage values matching Prisma JobStage enum
 */
export type ProgressStage =
  | 'starting'
  | 'downloading'
  | 'processing'
  | 'analyzing'
  | 'building'
  | 'rendering'
  | 'uploading'
  | 'publishing'
  | 'done';

/**
 * Job progress payload published to Redis
 */
export interface JobProgress {
  jobId: string;
  status: ProgressStatus;
  stage: ProgressStage;
  progress: number;
  message?: string;
  timestamp: number;
}

/**
 * Progress Publisher
 *
 * Publishes job progress updates to Redis channels.
 * Channel format: job:progress:{jobId}
 */
class ProgressPublisher {
  private readonly channelPrefix = 'job:progress:';

  /**
   * Get the Redis channel name for a job
   */
  getChannel(jobId: string): string {
    return `${this.channelPrefix}${jobId}`;
  }

  /**
   * Publish a progress update to the job's Redis channel
   */
  async publish(
    jobId: string,
    status: ProgressStatus,
    stage: ProgressStage,
    progress: number,
    message?: string
  ): Promise<void> {
    const channel = this.getChannel(jobId);
    const payload: JobProgress = {
      jobId,
      status,
      stage,
      progress,
      message,
      timestamp: Date.now(),
    };

    try {
      await connection.publish(channel, JSON.stringify(payload));
      logger.debug(`Published progress for job ${jobId}: ${stage} ${progress}%`);
    } catch (error) {
      logger.error(`Failed to publish progress for job ${jobId}:`, error);
      // Don't throw - progress publishing is non-critical
    }
  }

  /**
   * Publish a progress update using a JobProgress object
   */
  async publishProgress(progress: Omit<JobProgress, 'timestamp'>): Promise<void> {
    await this.publish(
      progress.jobId,
      progress.status,
      progress.stage,
      progress.progress,
      progress.message
    );
  }
}

export const progressPublisher = new ProgressPublisher();
