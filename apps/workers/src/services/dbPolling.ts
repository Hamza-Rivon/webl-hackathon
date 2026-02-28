/**
 * Database Polling Service
 *
 * Fallback mechanism to poll database for jobs when Redis is unavailable.
 * This ensures jobs can still be processed even if Redis is down.
 */

import { prisma } from './db.js';
import { logger } from '@webl/shared';
import { connection } from './redis.js';
import {
  processVoiceoverIngest,
  processVoiceoverTranscript,
  processVoiceoverTranscriptCorrection,
  processVoiceoverTakeSelection,
  processVoiceoverSilenceDetection,
  processVoiceoverCleaning,
  processVoiceoverSegmentation,
  processBrollIngest,
  processBrollChunking,
  processBrollChunkIngest,
  processSlotClipEnrichment,
  processBrollChunkEnrichment,
  processBrollChunkEmbedding,
  processArollChunkTranscript,
  processChunkRefinement,
  processSemanticMatching,
  processCutPlanGeneration,
  processCutPlanValidation,
  processFfmpegRenderMicrocutV2,
  processMuxPublish,
} from '../jobs/index.js';
import { Job as BullJob } from 'bullmq';

// Poll interval in milliseconds (default: 10 seconds)
const POLL_INTERVAL = parseInt(process.env.DB_POLL_INTERVAL_MS || '10000', 10);

// Job type to processor mapping
const jobProcessors: Record<string, (job: BullJob) => Promise<void>> = {
  voiceover_ingest: processVoiceoverIngest,
  voiceover_transcript: processVoiceoverTranscript,
  voiceover_transcript_correction: processVoiceoverTranscriptCorrection,
  voiceover_take_selection: processVoiceoverTakeSelection,
  voiceover_silence_detection: processVoiceoverSilenceDetection,
  voiceover_cleaning: processVoiceoverCleaning,
  voiceover_segmentation: processVoiceoverSegmentation,
  broll_ingest: processBrollIngest,
  broll_chunking: processBrollChunking,
  broll_chunk_ingest: processBrollChunkIngest,
  slot_clip_enrichment: processSlotClipEnrichment,
  broll_chunk_enrichment: processBrollChunkEnrichment,
  broll_chunk_embedding: processBrollChunkEmbedding,
  aroll_chunk_transcript: processArollChunkTranscript,
  chunk_refinement: processChunkRefinement,
  semantic_matching: processSemanticMatching,
  cut_plan_generation: processCutPlanGeneration,
  cut_plan_validation: processCutPlanValidation,
  ffmpeg_render_microcut_v2: processFfmpegRenderMicrocutV2,
  mux_publish: processMuxPublish,
};

// Valid job types for database query
const validJobTypes = [
  // Phase 1: Voiceover Processing
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
  'voiceover_take_selection',
  'voiceover_silence_detection',
  'voiceover_cleaning',
  'voiceover_segmentation',
  // Phase 2: B-Roll Chunk Processing
  'broll_ingest',
  'broll_chunking',
  'broll_chunk_ingest',
  'broll_chunk_enrichment',
  'broll_chunk_embedding',
  'slot_clip_enrichment',
  'aroll_chunk_transcript',
  'chunk_refinement',
  // Phase 3: Semantic Matching
  'semantic_matching',
  // Phase 4: Cut Plan Generation
  'cut_plan_generation',
  'cut_plan_validation',
  // Phase 5: Rendering
  'ffmpeg_render_microcut_v2',
  'mux_publish',
] as const;

/**
 * Check if Redis is available
 */
async function isRedisAvailable(): Promise<boolean> {
  try {
    await connection.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a BullMQ-like job object from database job
 */
function createBullJobFromDb(dbJob: any): BullJob {
  const metadata = (dbJob.metadata as Record<string, any>) || {};
  const inputData = (dbJob.inputData as Record<string, any>) || {};
  const inputPaths = dbJob.inputPaths || [];

  const jobData: any = {
    jobId: dbJob.id,
    episodeId: dbJob.episodeId,
    userId: dbJob.userId,
    ...inputData,
    ...metadata,
  };

  if (!jobData.s3Key && inputPaths[0]) {
    jobData.s3Key = inputPaths[0];
  }

  return {
    id: dbJob.id,
    data: jobData,
    name: dbJob.type,
  } as BullJob;
}

/**
 * Poll database for pending jobs and process them
 */
async function pollAndProcessJobs(): Promise<void> {
  try {
    // Check if Redis is back online - if so, stop polling
    if (await isRedisAvailable()) {
      logger.debug('Redis is available, database polling paused');
      return;
    }

    // Find pending jobs that need processing
    const pendingJobs = await prisma.job.findMany({
      where: {
        status: 'pending',
        type: {
          in: validJobTypes as any,
        },
      },
      take: 10, // Process up to 10 jobs per poll
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (pendingJobs.length === 0) {
      return;
    }

    logger.info(`[DB Polling] Found ${pendingJobs.length} pending jobs to process`);

    // Process each job
    for (const dbJob of pendingJobs) {
      const processor = jobProcessors[dbJob.type];
      if (!processor) {
        logger.warn(`[DB Polling] No processor found for job type: ${dbJob.type}`);
        continue;
      }

      try {
        // Update job status to processing
        await prisma.job.update({
          where: { id: dbJob.id },
          data: {
            status: 'processing',
            stage: 'starting',
            progress: 0,
          },
        });

        // Create BullMQ-like job object
        const bullJob = createBullJobFromDb(dbJob);

        // Process the job
        logger.info(`[DB Polling] Processing job ${dbJob.id} (${dbJob.type})`);
        await processor(bullJob);

        logger.info(`[DB Polling] Successfully processed job ${dbJob.id}`);
      } catch (error) {
        logger.error(`[DB Polling] Failed to process job ${dbJob.id}:`, error);
        
        // Update job status to error
        await prisma.job.update({
          where: { id: dbJob.id },
          data: {
            status: 'error',
            stage: 'done',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
  } catch (error) {
    logger.error('[DB Polling] Error polling database:', error);
  }
}

/**
 * Start database polling service
 * Only runs when Redis is unavailable
 */
export function startDbPolling(): NodeJS.Timeout | null {
  let intervalHandle: NodeJS.Timeout | null = null;
  let isPolling = false;

  // Single interval that checks Redis and polls if needed
  intervalHandle = setInterval(async () => {
    const available = await isRedisAvailable();
    
    if (available) {
      // Redis is back online - stop polling if it was running
      if (isPolling) {
        logger.info('✅ Redis is available again, stopping database polling');
        isPolling = false;
      }
      return;
    }

    // Redis is unavailable - start polling if not already
    if (!isPolling) {
      logger.warn('⚠️ Redis is unavailable, starting database polling fallback');
      logger.info(`[DB Polling] Starting with ${POLL_INTERVAL}ms interval`);
      isPolling = true;
    }

    // Poll and process jobs
    await pollAndProcessJobs();
  }, POLL_INTERVAL);

  return intervalHandle;
}

/**
 * Stop database polling
 */
export function stopDbPolling(interval: NodeJS.Timeout | null): void {
  if (interval) {
    clearInterval(interval);
    logger.info('[DB Polling] Stopped');
  }
}
