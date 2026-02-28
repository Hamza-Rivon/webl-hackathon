/**
 * BullMQ Queue Definitions
 *
 * Defines all job queues for the WEBL worker pipeline.
 * FFmpeg microcut render architecture.
 */

import { Queue } from 'bullmq';
import { connection } from './services/redis.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000,
  },
};

// Define all queues for new pipeline
export const queues = {
  // Phase 1: Voiceover Pipeline
  voiceoverIngest: new Queue('voiceover-ingest', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverTranscript: new Queue('voiceover-transcript', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverTranscriptCorrection: new Queue('voiceover-transcript-correction', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverTakeSelection: new Queue('voiceover-take-selection', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverSilenceDetection: new Queue('voiceover-silence-detection', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverCleaning: new Queue('voiceover-cleaning', {
    connection: connection as any,
    defaultJobOptions,
  }),

  voiceoverSegmentation: new Queue('voiceover-segmentation', {
    connection: connection as any,
    defaultJobOptions,
  }),

  // Phase 2: B-Roll Pipeline
  brollIngest: new Queue('broll-ingest', {
    connection: connection as any,
    defaultJobOptions,
  }),

  brollChunking: new Queue('broll-chunking', {
    connection: connection as any,
    defaultJobOptions,
  }),

  brollChunkIngest: new Queue('broll-chunk-ingest', {
    connection: connection as any,
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
    },
  }),

  slotClipEnrichment: new Queue('slot-clip-enrichment', {
    connection: connection as any,
    defaultJobOptions,
  }),

  brollChunkEnrichment: new Queue('broll-chunk-enrichment', {
    connection: connection as any,
    defaultJobOptions,
  }),

  brollChunkEmbedding: new Queue('broll-chunk-embedding', {
    connection: connection as any,
    defaultJobOptions,
  }),

  arollChunkTranscript: new Queue('aroll-chunk-transcript', {
    connection: connection as any,
    defaultJobOptions,
  }),

  chunkRefinement: new Queue('chunk-refinement', {
    connection: connection as any,
    defaultJobOptions,
  }),

  // Phase 3 & 4: Matching, Creative Edit & Cut Plan
  semanticMatching: new Queue('semantic-matching', {
    connection: connection as any,
    defaultJobOptions,
  }),

  creativeEditPlan: new Queue('creative-edit-plan', {
    connection: connection as any,
    defaultJobOptions,
  }),

  cutPlanGeneration: new Queue('cut-plan-generation', {
    connection: connection as any,
    defaultJobOptions,
  }),

  cutPlanValidation: new Queue('cut-plan-validation', {
    connection: connection as any,
    defaultJobOptions,
  }),

  // Phase 5: Rendering
  ffmpegRenderMicrocutV2: new Queue('ffmpeg-render-microcut-v2', {
    connection: connection as any,
    defaultJobOptions,
  }),

  muxPublish: new Queue('mux-publish', {
    connection: connection as any,
    defaultJobOptions,
  }),
} as const;

// Job priorities
export const PRIORITIES = {
  HIGH: 1, // Paid users, small files
  NORMAL: 5, // Free users
  LOW: 10, // Background tasks
} as const;

// Job types for type safety
export type QueueName = keyof typeof queues;
