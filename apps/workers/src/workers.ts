/**
 * Worker Setup
 *
 * Initializes all job workers with their processors.
 * FFmpeg microcut pipeline for video processing.
 */

import { Worker, Job } from 'bullmq';
import { connection } from './services/redis.js';
import { config } from './config.js';
import { logger } from '@webl/shared';

// Import job processors
import {
  // Phase 1: Voiceover Pipeline
  processVoiceoverIngest,
  processVoiceoverTranscript,
  processVoiceoverTranscriptCorrection,
  processVoiceoverTakeSelection,
  processVoiceoverSilenceDetection,
  processVoiceoverCleaning,
  processVoiceoverSegmentation,
  
  // Phase 2: B-Roll Chunk Pipeline
  processBrollIngest,
  processBrollChunking,
  processBrollChunkIngest,
  processSlotClipEnrichment,
  processBrollChunkEnrichment,
  processBrollChunkEmbedding,
  processArollChunkTranscript,
  processChunkRefinement,
  
  // Phase 3: Semantic Matching, Creative Edit & Cut Plan
  processSemanticMatching,
  processCreativeEditPlan,
  processCutPlanGeneration,
  processCutPlanValidation,
  
  processFfmpegRenderMicrocutV2,
  processMuxPublish,
} from './jobs/index.js';

// ==================== WORKER SETUP ====================

export function setupWorkers(): Worker[] {
  const workers: Worker[] = [];

  // ==================== PHASE 1: VOICEOVER PIPELINE ====================

  // Voiceover Ingest Worker
  workers.push(
    new Worker('voiceover-ingest', async (job: Job) => {
      logger.info(`[Phase 1.1] Processing voiceover-ingest job ${job.id}`);
      await processVoiceoverIngest(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverIngest,
    })
  );

  // Voiceover Transcript Worker
  workers.push(
    new Worker('voiceover-transcript', async (job: Job) => {
      logger.info(`[Phase 1.2] Processing voiceover-transcript job ${job.id}`);
      await processVoiceoverTranscript(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverTranscript,
    })
  );

  // Voiceover Transcript Correction Worker
  workers.push(
    new Worker('voiceover-transcript-correction', async (job: Job) => {
      logger.info(`[Phase 1.3] Processing voiceover-transcript-correction job ${job.id}`);
      await processVoiceoverTranscriptCorrection(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverTranscriptCorrection,
    })
  );

  // Voiceover Take Selection Worker
  workers.push(
    new Worker('voiceover-take-selection', async (job: Job) => {
      logger.info(`[Phase 1.4] Processing voiceover-take-selection job ${job.id}`);
      await processVoiceoverTakeSelection(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverTakeSelection,
    })
  );

  // Voiceover Silence Detection Worker
  workers.push(
    new Worker('voiceover-silence-detection', async (job: Job) => {
      logger.info(`[Phase 1.5] Processing voiceover-silence-detection job ${job.id}`);
      await processVoiceoverSilenceDetection(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverSilenceDetection,
    })
  );

  // Voiceover Cleaning Worker
  workers.push(
    new Worker('voiceover-cleaning', async (job: Job) => {
      logger.info(`[Phase 1.6] Processing voiceover-cleaning job ${job.id}`);
      await processVoiceoverCleaning(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverCleaning,
    })
  );

  // Voiceover Segmentation Worker
  workers.push(
    new Worker('voiceover-segmentation', async (job: Job) => {
      logger.info(`[Phase 1.7] Processing voiceover-segmentation job ${job.id}`);
      await processVoiceoverSegmentation(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.voiceoverSegmentation,
    })
  );

  // ==================== PHASE 2: B-ROLL CHUNK PIPELINE ====================

  // B-Roll Ingest Worker
  workers.push(
    new Worker('broll-ingest', async (job: Job) => {
      logger.info(`[Phase 2.1] Processing broll-ingest job ${job.id}`);
      await processBrollIngest(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollIngest,
    })
  );

  // B-Roll Chunking Worker
  workers.push(
    new Worker('broll-chunking', async (job: Job) => {
      logger.info(`[Phase 2.2] Processing broll-chunking job ${job.id}`);
      await processBrollChunking(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunking,
    })
  );

  // B-Roll Chunk Ingest Worker
  workers.push(
    new Worker('broll-chunk-ingest', async (job: Job) => {
      logger.info(`[Phase 2.3] Processing broll-chunk-ingest job ${job.id}`);
      await processBrollChunkIngest(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkIngest,
    })
  );

  // Slot Clip Enrichment Worker
  workers.push(
    new Worker('slot-clip-enrichment', async (job: Job) => {
      logger.info(`[Phase 2.2] Processing slot-clip-enrichment job ${job.id}`);
      await processSlotClipEnrichment(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkEnrichment, // Reuse same concurrency
    })
  );

  // B-Roll Chunk Enrichment Worker
  workers.push(
    new Worker('broll-chunk-enrichment', async (job: Job) => {
      logger.info(`[Phase 2.4] Processing broll-chunk-enrichment job ${job.id}`);
      await processBrollChunkEnrichment(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkEnrichment,
    })
  );

  // B-Roll Chunk Embedding Worker
  workers.push(
    new Worker('broll-chunk-embedding', async (job: Job) => {
      logger.info(`[Phase 2.5] Processing broll-chunk-embedding job ${job.id}`);
      await processBrollChunkEmbedding(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkEmbedding,
    })
  );

  // A-Roll Chunk Transcript Worker
  workers.push(
    new Worker('aroll-chunk-transcript', async (job: Job) => {
      logger.info(`[Phase 2.3b] Processing aroll-chunk-transcript job ${job.id}`);
      await processArollChunkTranscript(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkEnrichment, // Use same concurrency as enrichment
    })
  );

  // Chunk Refinement Worker
  workers.push(
    new Worker('chunk-refinement', async (job: Job) => {
      logger.info(`[Phase 2.4] Processing chunk-refinement job ${job.id}`);
      await processChunkRefinement(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.brollChunkEnrichment, // Use same concurrency
    })
  );

  // ==================== PHASE 3: SEMANTIC MATCHING & CUT PLAN ====================

  // Semantic Matching Worker
  workers.push(
    new Worker('semantic-matching', async (job: Job) => {
      logger.info(`[Phase 3.1] Processing semantic-matching job ${job.id}`);
      await processSemanticMatching(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.semanticMatching,
    })
  );

  // Creative Edit Plan Worker (LLM-powered Creative Director)
  workers.push(
    new Worker('creative-edit-plan', async (job: Job) => {
      logger.info(`[Phase 3.5] Processing creative-edit-plan job ${job.id}`);
      await processCreativeEditPlan(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.creativeEditPlan,
    })
  );

  // Cut Plan Generation Worker
  workers.push(
    new Worker('cut-plan-generation', async (job: Job) => {
      logger.info(`[Phase 3.2] Processing cut-plan-generation job ${job.id}`);
      await processCutPlanGeneration(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.cutPlanGeneration,
    })
  );

  // Cut Plan Validation Worker
  workers.push(
    new Worker('cut-plan-validation', async (job: Job) => {
      logger.info(`[Phase 3.3] Processing cut-plan-validation job ${job.id}`);
      await processCutPlanValidation(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.cutPlanValidation,
    })
  );

  // ==================== PHASE 5: RENDERING ====================

  // FFmpeg Render Worker (Microcut V2)
  workers.push(
    new Worker('ffmpeg-render-microcut-v2', async (job: Job) => {
      logger.info(`[Phase 5.2] Processing ffmpeg-render-microcut-v2 job ${job.id}`);
      await processFfmpegRenderMicrocutV2(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.ffmpegRenderMicrocutV2,
    })
  );

  // Mux Publish Worker (Phase 5.3)
  workers.push(
    new Worker('mux-publish', async (job: Job) => {
      logger.info(`[Phase 5.3] Processing mux-publish job ${job.id}`);
      await processMuxPublish(job);
    }, {
      connection: connection as any,
      concurrency: config.concurrency.muxPublish,
    })
  );

  // Add error handlers to all workers
  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      logger.error(`Job ${job?.id} failed in worker ${worker.name}:`, error);
    });

    worker.on('completed', (job) => {
      logger.debug(`Job ${job.id} completed in worker ${worker.name}`);
    });

    worker.on('error', (error) => {
      logger.error(`Worker ${worker.name} error:`, error);
    });
  }

  logger.info(`Started ${workers.length} workers for video processing pipeline`);

  return workers;
}
