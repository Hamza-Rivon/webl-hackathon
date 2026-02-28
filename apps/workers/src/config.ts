/**
 * Worker Configuration
 *
 * Centralized configuration for the WEBL worker service.
 */

// Load .env file from project root (../../ from apps/workers/src/)
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

function parseBoundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

export const config = {
  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database (Neon PostgreSQL)
  database: {
    url: process.env.DATABASE_URL || '',
    directUrl: process.env.DIRECT_URL || '',
  },

  // Redis (Upstash)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },

  // AWS S3
  s3: {
    region: process.env.AWS_REGION || 'eu-west-3',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: process.env.S3_BUCKET_NAME || '',
  },

  // AI Services - Only ONE provider is used at a time based on AI_PROVIDER env var
  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase() as 'gemini' | 'openai',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3-pro-preview',
  },

  // OpenAI (for @mux/ai integration and chunk selection)
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
  },

  // Deepgram (word-level transcription for voiceover pipeline)
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY || '',
    model: process.env.DEEPGRAM_MODEL || 'nova-2',
    language: process.env.DEEPGRAM_LANGUAGE || 'en',
    punctuate: process.env.DEEPGRAM_PUNCTUATE === 'true',
    smartFormat: process.env.DEEPGRAM_SMART_FORMAT === 'true',
    fillerWords: process.env.DEEPGRAM_FILLER_WORDS !== 'false',
    numerals: process.env.DEEPGRAM_NUMERALS === 'true',
    utterances: process.env.DEEPGRAM_UTTERANCES === 'true',
    utteranceSplit: Number.isFinite(Number(process.env.DEEPGRAM_UTT_SPLIT))
      ? Number(process.env.DEEPGRAM_UTT_SPLIT)
      : undefined,
  },

  // Voiceover pipeline tuning
  voiceover: {
    deepgramKeytermPrompting: {
      enabled: process.env.VOICEOVER_DEEPGRAM_KEYTERM_PROMPTING_ENABLED !== 'false',
      maxKeyterms: Number.isFinite(Number(process.env.VOICEOVER_DEEPGRAM_KEYTERM_MAX_KEYTERMS))
        ? Math.max(0, Number(process.env.VOICEOVER_DEEPGRAM_KEYTERM_MAX_KEYTERMS))
        : 50,
    },
    models: {
      call1: process.env.VOICEOVER_CALL1_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
      call2: process.env.VOICEOVER_CALL2_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
      call3: process.env.VOICEOVER_CALL3_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
      call4: process.env.VOICEOVER_CALL4_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini',
    },
    transcriptCorrection: {
      enabled: process.env.VOICEOVER_TRANSCRIPT_CORRECTION_ENABLED !== 'false',
      minCoverageForSkip: Number.isFinite(Number(process.env.VOICEOVER_TRANSCRIPT_CORRECTION_MIN_COVERAGE))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TRANSCRIPT_CORRECTION_MIN_COVERAGE)))
        : 0.9,
      forceForKeyterms: process.env.VOICEOVER_TRANSCRIPT_CORRECTION_FORCE_FOR_KEYTERMS !== 'false',
    },
    takeSelection: {
      enabled: process.env.VOICEOVER_TAKE_SELECTION_ENABLED !== 'false',
      maxCandidates: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_MAX_CANDIDATES))
        ? Math.max(1, Number(process.env.VOICEOVER_TAKE_SELECTION_MAX_CANDIDATES))
        : 5,
      llmMinCandidateScore: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_LLM_MIN_CANDIDATE_SCORE))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TAKE_SELECTION_LLM_MIN_CANDIDATE_SCORE)))
        : 0.35,
      llmConfidenceThreshold: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_LLM_CONFIDENCE_THRESHOLD))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TAKE_SELECTION_LLM_CONFIDENCE_THRESHOLD)))
        : 0.5,
      heuristicKeepScore: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_HEURISTIC_KEEP_SCORE))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TAKE_SELECTION_HEURISTIC_KEEP_SCORE)))
        : 0.5,
      minCoverageRatio: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_MIN_COVERAGE_RATIO))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TAKE_SELECTION_MIN_COVERAGE_RATIO)))
        : 0.5,
      scriptMinWords: Number.isFinite(Number(process.env.VOICEOVER_TAKE_SELECTION_SCRIPT_MIN_WORDS))
        ? Math.max(1, Number(process.env.VOICEOVER_TAKE_SELECTION_SCRIPT_MIN_WORDS))
        : 2,
    },
    removalVerification: {
      enabled: process.env.VOICEOVER_REMOVAL_VERIFICATION_ENABLED !== 'false',
      maxSegments: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MAX_SEGMENTS))
        ? Math.max(1, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MAX_SEGMENTS))
        : 8,
      minDurationMs: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MIN_DURATION_MS))
        ? Math.max(0, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MIN_DURATION_MS))
        : 120,
      maxDurationMs: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MAX_DURATION_MS))
        ? Math.max(0, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_MAX_DURATION_MS))
        : 4000,
      contextWords: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_CONTEXT_WORDS))
        ? Math.max(0, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_CONTEXT_WORDS))
        : 16,
      keepConfidenceThreshold: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_KEEP_CONFIDENCE))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_KEEP_CONFIDENCE)))
        : 0.6,
      padMs: Number.isFinite(Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_PAD_MS))
        ? Math.max(0, Number(process.env.VOICEOVER_REMOVAL_VERIFICATION_PAD_MS))
        : 120,
    },
    silenceRemoval: {
      // Prevent accidental "disabled cleaning" configs (e.g. 100500ms)
      minGapMs: parseBoundedNumber(
        process.env.VOICEOVER_SILENCE_REMOVAL_MIN_GAP_MS,
        1500,
        100,
        10000
      ),
    },
    tailEnergy: {
      enabled: process.env.VOICEOVER_TAIL_ENERGY_CHECK_ENABLED !== 'false',
      // Keep tail check focused on the tail (not the full file)
      windowMs: parseBoundedNumber(
        process.env.VOICEOVER_TAIL_ENERGY_WINDOW_MS,
        1500,
        300,
        15000
      ),
      threshold: Number.isFinite(Number(process.env.VOICEOVER_TAIL_ENERGY_THRESHOLD))
        ? Math.max(0, Math.min(1, Number(process.env.VOICEOVER_TAIL_ENERGY_THRESHOLD)))
        : 0.02,
    },
    cleaning: {
      gapMs: Number.isFinite(Number(process.env.VOICEOVER_CLEANING_GAP_MS))
        ? Math.max(0, Number(process.env.VOICEOVER_CLEANING_GAP_MS))
        : 150,
    },
  },

  // Mux Video (new)
  mux: {
    tokenId: process.env.MUX_TOKEN_ID || '',
    tokenSecret: process.env.MUX_TOKEN_SECRET || '',
    webhookSecret: process.env.MUX_WEBHOOK_SECRET || '',
  },

  // Worker Concurrency - ffmpeg microcut pipeline
  concurrency: {
    // Phase 1: Voiceover Pipeline
    voiceoverIngest: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_INGEST || '5', 10),
    voiceoverTranscript: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_TRANSCRIPT || '5', 10),
    voiceoverTranscriptCorrection: parseInt(
      process.env.MAX_CONCURRENT_VOICEOVER_TRANSCRIPT_CORRECTION || '3',
      10
    ),
    voiceoverTakeSelection: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_TAKE_SELECTION || '3', 10),
    voiceoverSilenceDetection: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_SILENCE || '3', 10),
    voiceoverCleaning: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_CLEANING || '2', 10),
    voiceoverSegmentation: parseInt(process.env.MAX_CONCURRENT_VOICEOVER_SEGMENTATION || '3', 10),
    
    // Phase 2: B-Roll Pipeline
    brollIngest: parseInt(process.env.MAX_CONCURRENT_BROLL_INGEST || '5', 10),
    brollChunking: parseInt(process.env.MAX_CONCURRENT_BROLL_CHUNKING || '3', 10),
    brollChunkIngest: parseInt(process.env.MAX_CONCURRENT_BROLL_CHUNK_INGEST || '4', 10),
    brollChunkEnrichment: parseInt(process.env.MAX_CONCURRENT_BROLL_CHUNK_ENRICHMENT || '5', 10),
    brollChunkEmbedding: parseInt(process.env.MAX_CONCURRENT_BROLL_CHUNK_EMBEDDING || '10', 10),
    
    // Phase 3 & 4: Matching, Creative Edit & Cut Plan
    semanticMatching: parseInt(process.env.MAX_CONCURRENT_SEMANTIC_MATCHING || '3', 10),
    creativeEditPlan: parseInt(process.env.MAX_CONCURRENT_CREATIVE_EDIT_PLAN || '3', 10),
    cutPlanGeneration: parseInt(process.env.MAX_CONCURRENT_CUT_PLAN_GENERATION || '5', 10),
    cutPlanValidation: parseInt(process.env.MAX_CONCURRENT_CUT_PLAN_VALIDATION || '5', 10),
    
    // Phase 5: Rendering
    ffmpegRenderMicrocutV2: parseInt(
      process.env.MAX_CONCURRENT_FFMPEG_RENDER_MICROCUT_V2 || '1',
      10
    ),
    muxPublish: parseInt(process.env.MAX_CONCURRENT_MUX_PUBLISH || '5', 10),
  },
} as const;
