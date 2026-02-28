/**
 * SSE Subscriber Service
 *
 * Subscribes to Redis Pub/Sub channels for job progress and streams updates via SSE.
 * Requirements: 5.2, 5.5
 */

import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '@webl/shared';

/**
 * Job progress payload received from Redis
 */
export interface JobProgress {
  jobId: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  stage: string;
  progress: number;
  message?: string;
  timestamp: number;
}

/**
 * Callback function for progress updates
 */
export type ProgressCallback = (progress: JobProgress) => void;

/**
 * SSE Subscriber
 *
 * Manages Redis subscriptions for job progress channels.
 * Each subscription creates a dedicated Redis connection for Pub/Sub.
 */
class SSESubscriber {
  private readonly channelPrefix = 'job:progress:';

  /**
   * Get the Redis channel name for a job
   */
  getChannel(jobId: string): string {
    return `${this.channelPrefix}${jobId}`;
  }

  /**
   * Subscribe to a job's progress channel
   *
   * Returns an unsubscribe function that cleans up the Redis connection.
   * Requirements: 5.2, 5.5
   */
  subscribe(jobId: string, callback: ProgressCallback): () => void {
    const channel = this.getChannel(jobId);

    // Create a dedicated Redis connection for this subscription
    // (Redis requires separate connections for Pub/Sub)
    // Upstash Redis requires TLS - detect from URL or enable for Upstash domains
    const redisUrl = config.redis.url;
    const isUpstash = redisUrl.includes('upstash.io');
    
    const subscriber = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Enable TLS for Upstash Redis
      ...(isUpstash && {
        tls: {
          rejectUnauthorized: true,
        },
      }),
    });

    let isUnsubscribed = false;

    // Handle incoming messages
    subscriber.on('message', (receivedChannel: string, message: string) => {
      if (receivedChannel === channel && !isUnsubscribed) {
        try {
          const progress = JSON.parse(message) as JobProgress;
          callback(progress);
        } catch (error) {
          logger.error(`Failed to parse progress message for job ${jobId}:`, error);
        }
      }
    });

    // Handle connection errors
    subscriber.on('error', (error) => {
      logger.error(`Redis subscriber error for job ${jobId}:`, error);
    });

    // Subscribe to the channel
    subscriber.subscribe(channel).catch((error) => {
      logger.error(`Failed to subscribe to channel ${channel}:`, error);
    });

    logger.debug(`Subscribed to progress channel for job ${jobId}`);

    // Return cleanup function (Requirements: 5.5)
    return () => {
      if (isUnsubscribed) return;
      isUnsubscribed = true;

      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
      logger.debug(`Unsubscribed from progress channel for job ${jobId}`);
    };
  }

  /**
   * Check if a job is in a terminal state (done, error, or cancelled)
   */
  isTerminalStatus(status: string): boolean {
    return status === 'done' || status === 'error' || status === 'cancelled';
  }
}

export const sseSubscriber = new SSESubscriber();
