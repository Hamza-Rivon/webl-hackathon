/**
 * Queue Service
 *
 * BullMQ client for enqueueing jobs from the API.
 * Connects to the same Redis instance as the workers.
 *
 * Complete Phase 1-5 Pipeline:
 * Phase 1: voiceover_ingest, voiceover_transcript, voiceover_transcript_correction, voiceover_take_selection, voiceover_silence_detection, voiceover_cleaning, voiceover_segmentation
 * Phase 2: broll_ingest, broll_chunking, broll_chunk_ingest, broll_chunk_enrichment, broll_chunk_embedding
 * Phase 3: semantic_matching
 * Phase 4: cut_plan_generation, cut_plan_validation
 * Phase 5: ffmpeg_render_microcut_v2, mux_publish
 */

import { Queue, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '@webl/shared';

// Create Redis connection for BullMQ
// Upstash Redis requires TLS - detect from URL or enable for Upstash domains
const redisUrl = config.redis.url;
const isUpstash = redisUrl.includes('upstash.io');

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Enable TLS for Upstash Redis
  ...(isUpstash && {
    tls: {
      rejectUnauthorized: true,
    },
  }),
});

// Default job options matching workers
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
};

// Job priorities
export const PRIORITIES = {
  HIGH: 1,
  NORMAL: 5,
  LOW: 10,
} as const;

// Queue instances - Complete Phase 1-5 Pipeline
const queues = {
  // Phase 1: Voiceover Pipeline
  voiceoverIngest: new Queue('voiceover-ingest', { connection: connection as any, defaultJobOptions }),
  voiceoverTranscript: new Queue('voiceover-transcript', { connection: connection as any, defaultJobOptions }),
  voiceoverTranscriptCorrection: new Queue('voiceover-transcript-correction', { connection: connection as any, defaultJobOptions }),
  voiceoverTakeSelection: new Queue('voiceover-take-selection', { connection: connection as any, defaultJobOptions }),
  voiceoverSilenceDetection: new Queue('voiceover-silence-detection', { connection: connection as any, defaultJobOptions }),
  voiceoverCleaning: new Queue('voiceover-cleaning', { connection: connection as any, defaultJobOptions }),
  voiceoverSegmentation: new Queue('voiceover-segmentation', { connection: connection as any, defaultJobOptions }),

  // Phase 2: B-Roll Chunk Pipeline
  brollIngest: new Queue('broll-ingest', { connection: connection as any, defaultJobOptions }),
  brollChunking: new Queue('broll-chunking', { connection: connection as any, defaultJobOptions }),
  brollChunkIngest: new Queue('broll-chunk-ingest', { connection: connection as any, defaultJobOptions }),
  brollChunkEnrichment: new Queue('broll-chunk-enrichment', { connection: connection as any, defaultJobOptions }),
  brollChunkEmbedding: new Queue('broll-chunk-embedding', { connection: connection as any, defaultJobOptions }),

  // Phase 3: Semantic Matching
  semanticMatching: new Queue('semantic-matching', { connection: connection as any, defaultJobOptions }),

  // Phase 4: Cut Plan Generation
  cutPlanGeneration: new Queue('cut-plan-generation', { connection: connection as any, defaultJobOptions }),
  cutPlanValidation: new Queue('cut-plan-validation', { connection: connection as any, defaultJobOptions }),

  // Phase 5: Rendering
  ffmpegRenderMicrocutV2: new Queue('ffmpeg-render-microcut-v2', { connection: connection as any, defaultJobOptions }),
  muxPublish: new Queue('mux-publish', { connection: connection as any, defaultJobOptions }),
} as const;

// Job type to queue mapping
const jobTypeToQueue: Record<string, Queue> = {
  // Phase 1
  voiceover_ingest: queues.voiceoverIngest,
  voiceover_transcript: queues.voiceoverTranscript,
  voiceover_transcript_correction: queues.voiceoverTranscriptCorrection,
  voiceover_take_selection: queues.voiceoverTakeSelection,
  voiceover_silence_detection: queues.voiceoverSilenceDetection,
  voiceover_cleaning: queues.voiceoverCleaning,
  voiceover_segmentation: queues.voiceoverSegmentation,

  // Phase 2
  broll_ingest: queues.brollIngest,
  broll_chunking: queues.brollChunking,
  broll_chunk_ingest: queues.brollChunkIngest,
  broll_chunk_enrichment: queues.brollChunkEnrichment,
  broll_chunk_embedding: queues.brollChunkEmbedding,

  // Phase 3
  semantic_matching: queues.semanticMatching,

  // Phase 4
  cut_plan_generation: queues.cutPlanGeneration,
  cut_plan_validation: queues.cutPlanValidation,

  // Phase 5
  ffmpeg_render_microcut_v2: queues.ffmpegRenderMicrocutV2,
  mux_publish: queues.muxPublish,

  // Note: The following job types are worker-enqueued internal jobs that don't have
  // dedicated queues: slot_clip_enrichment, aroll_chunk_transcript, chunk_refinement
  // These are handled internally by workers and removeJob/getJob will return false/undefined
  // for these types, which is expected behavior.
};

// ==================== JOB DATA INTERFACES ====================

// Phase 1: Voiceover Pipeline
export interface VoiceoverIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  s3Key: string;
}

export interface VoiceoverTranscriptJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  s3Key?: string;
}

export interface VoiceoverSilenceDetectionJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export interface VoiceoverCleaningJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export interface VoiceoverSegmentationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

// Phase 2: B-Roll Chunk Pipeline
export interface BrollIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  s3Key: string;
}

export interface BrollChunkingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
}

export interface BrollChunkIngestJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
}

export interface BrollChunkEnrichmentJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  chunkId: string;
}

export interface BrollChunkEmbeddingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
  chunkIds?: string[];
  isRefinement?: boolean;
}

// Phase 3: Semantic Matching
export interface SemanticMatchingJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

// Phase 4: Cut Plan Generation
export interface CutPlanGenerationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export interface CutPlanValidationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

// Phase 5: Rendering
export interface FfmpegRenderMicrocutV2JobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export interface MuxPublishJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  finalS3Key: string;
}

/**
 * Queue Service - provides methods to enqueue jobs
 * Includes fallback handling for Redis connection issues
 */
export const queueService = {
  /**
   * Check if Redis connection is available
   */
  async isRedisAvailable(): Promise<boolean> {
    try {
      await connection.ping();
      return true;
    } catch (error) {
      logger.warn('Redis connection check failed:', error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  },

  // ==================== PHASE 1: VOICEOVER PIPELINE ====================

  /**
   * Add a voiceover ingest job to the queue (Phase 1.1)
   * Returns job ID even if Redis fails (for fallback processing)
   */
  async addVoiceoverIngestJob(data: VoiceoverIngestJobData): Promise<string> {
    try {
      const job = await queues.voiceoverIngest.add('voiceover-ingest', data, {
        jobId: data.jobId,
        priority: PRIORITIES.HIGH,
      });
      logger.info(`Queued voiceover_ingest job ${data.jobId} for episode ${data.episodeId}`);
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue voiceover ingest job ${data.jobId} to Redis:`, error);
      // Return job ID anyway - job exists in DB and can be processed via fallback
      return data.jobId;
    }
  },

  /**
   * Add a voiceover segmentation job to the queue (Phase 1.6)
   * Used by recovery flows when segmentation previously failed.
   */
  async addVoiceoverSegmentationJob(data: VoiceoverSegmentationJobData): Promise<string> {
    try {
      const job = await queues.voiceoverSegmentation.add('voiceover-segmentation', data, {
        jobId: data.jobId,
        priority: PRIORITIES.HIGH,
      });
      logger.info(`Queued voiceover_segmentation job ${data.jobId} for episode ${data.episodeId}`);
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue voiceover segmentation job ${data.jobId} to Redis:`, error);
      return data.jobId;
    }
  },

  // ==================== PHASE 2: B-ROLL CHUNK PIPELINE ====================

  /**
   * Add a B-roll ingest job to the queue (Phase 2.1)
   * Returns job ID even if Redis fails (for fallback processing)
   */
  async addBrollIngestJob(data: BrollIngestJobData): Promise<string> {
    try {
      const job = await queues.brollIngest.add('broll-ingest', data, {
        jobId: data.jobId,
        priority: PRIORITIES.NORMAL,
      });
      logger.info(`Queued broll_ingest job ${data.jobId} for episode ${data.episodeId}, slotClip ${data.slotClipId}`);
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue B-roll ingest job ${data.jobId} to Redis:`, error);
      // Return job ID anyway - job exists in DB and can be processed via fallback
      return data.jobId;
    }
  },

  /**
   * Add a B-roll chunk ingest job to the queue (Phase 2.3)
   */
  async addBrollChunkIngestJob(data: BrollChunkIngestJobData): Promise<string> {
    try {
      const job = await queues.brollChunkIngest.add('broll-chunk-ingest', data, {
        jobId: data.jobId,
        priority: PRIORITIES.NORMAL,
      });
      logger.info(
        `Queued broll_chunk_ingest job ${data.jobId} for episode ${data.episodeId}, chunk ${data.chunkId}`
      );
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue broll chunk ingest job ${data.jobId} to Redis:`, error);
      return data.jobId;
    }
  },

  /**
   * Add a B-roll chunk embedding job to the queue (Phase 2.5)
   */
  async addBrollChunkEmbeddingJob(data: BrollChunkEmbeddingJobData): Promise<string> {
    try {
      const job = await queues.brollChunkEmbedding.add('broll-chunk-embedding', data, {
        jobId: data.jobId,
        priority: PRIORITIES.NORMAL,
      });
      logger.info(
        `Queued broll_chunk_embedding job ${data.jobId} for episode ${data.episodeId}, chunk ${data.chunkId}`
      );
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue broll chunk embedding job ${data.jobId} to Redis:`, error);
      return data.jobId;
    }
  },

  /**
   * Add a semantic matching job to the queue (Phase 3.1)
   */
  async addSemanticMatchingJob(data: SemanticMatchingJobData): Promise<string> {
    try {
      const job = await queues.semanticMatching.add('semantic-matching', data, {
        jobId: data.jobId,
        priority: PRIORITIES.HIGH,
      });
      logger.info(`Queued semantic_matching job ${data.jobId} for episode ${data.episodeId}`);
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue semantic matching job ${data.jobId} to Redis:`, error);
      return data.jobId;
    }
  },

  /**
   * Add a cut plan generation job to the queue (Phase 4.1)
   */
  async addCutPlanGenerationJob(data: CutPlanGenerationJobData): Promise<string> {
    try {
      const job = await queues.cutPlanGeneration.add('cut-plan-generation', data, {
        jobId: data.jobId,
        priority: PRIORITIES.HIGH,
      });
      logger.info(`Queued cut_plan_generation job ${data.jobId} for episode ${data.episodeId}`);
      return job.id ?? data.jobId;
    } catch (error) {
      logger.error(`Failed to queue cut plan generation job ${data.jobId} to Redis:`, error);
      return data.jobId;
    }
  },

  /**
   * Add an FFmpeg microcut render job to the queue
   */
  async addFfmpegRenderMicrocutV2Job(
    data: FfmpegRenderMicrocutV2JobData
  ): Promise<string> {
    const job = await queues.ffmpegRenderMicrocutV2.add('ffmpeg-render-microcut-v2', data, {
      jobId: data.jobId,
      priority: PRIORITIES.NORMAL,
    });
    return job.id ?? data.jobId;
  },

  /**
   * Add a Mux publish job to the queue
   */
  async addMuxPublishJob(data: MuxPublishJobData): Promise<string> {
    const job = await queues.muxPublish.add('mux-publish', data, {
      jobId: data.jobId,
      priority: PRIORITIES.NORMAL,
    });
    return job.id ?? data.jobId;
  },

  /**
   * Remove a job from its queue (for cancellation)
   */
  async removeJob(jobType: string, jobId: string): Promise<boolean> {
    const queue = jobTypeToQueue[jobType];
    if (!queue) {
      logger.warn(`Unknown job type for removal: ${jobType}`);
      return false;
    }

    try {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        logger.info(`Removed job ${jobId} from ${jobType} queue`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error(`Failed to remove job ${jobId} from queue:`, error);
      return false;
    }
  },

  /**
   * Get job by ID from any queue
   */
  async getJob(jobType: string, jobId: string): Promise<Job | undefined> {
    const queue = jobTypeToQueue[jobType];
    if (!queue) {
      return undefined;
    }
    return queue.getJob(jobId);
  },

  /**
   * Close all queue connections (for graceful shutdown)
   */
  async close(): Promise<void> {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await connection.quit();
  },
};
