/**
 * Jobs Barrel Export
 *
 * Exports all job processors for the new pipeline architecture:
 * 
 * Phase 1: Voiceover Pipeline
 * - voiceoverIngest: Upload voiceover to Mux (transcription handled by Deepgram)
 * - voiceoverTranscript: Extract Deepgram word-level timestamps
 * - voiceoverSilenceDetection: Detect silence and filler words
 * - voiceoverCleaning: Remove silence/fillers, create clean audio
 * - voiceoverSegmentation: Create semantic segments with embeddings
 * 
 * Phase 2: B-Roll Chunk Pipeline
 * - brollIngest: Upload B-roll clip to Mux
 * - brollChunking: Split B-roll into configurable chunks (default 2 seconds) with FFmpeg
 * - brollChunkIngest: Upload individual chunks to Mux
 * - brollChunkEnrichment: Use @mux/ai for tags, summary, moderation
 * - brollChunkEmbedding: Generate OpenAI embeddings for semantic search
 * 
 * Phase 3: Semantic Matching & Cut Plan
 * - semanticMatching: Match voiceover segments to B-roll chunks via pgvector
 * - cutPlanGeneration: Generate MicroCutPlanV2 cut list
 * - cutPlanValidation: Validate all assets and timing before render
 * - ffmpegRenderMicrocutV2: Render MicroCutPlanV2 with FFmpeg
 * 
 * Phase 5:
 * - muxPublish: Publish final video to Mux
 */

// Phase 1: Voiceover Pipeline
export { processVoiceoverIngest } from './voiceoverIngest.js';
export { processVoiceoverTranscript } from './voiceoverTranscript.js';
export { processVoiceoverTranscriptCorrection } from './voiceoverTranscriptCorrection.js';
export { processVoiceoverTakeSelection } from './voiceoverTakeSelection.js';
export { processVoiceoverSilenceDetection } from './voiceoverSilenceDetection.js';
export { processVoiceoverCleaning } from './voiceoverCleaning.js';
export { processVoiceoverSegmentation } from './voiceoverSegmentation.js';

// Phase 2: B-Roll Chunk Pipeline
export { processBrollIngest } from './brollIngest.js';
export { processBrollChunking } from './brollChunking.js';
export { processBrollChunkIngest } from './brollChunkIngest.js';
export { processSlotClipEnrichment } from './slotClipEnrichment.js';
export { processBrollChunkEnrichment } from './brollChunkEnrichment.js';
export { processBrollChunkEmbedding } from './brollChunkEmbedding.js';
export { processArollChunkTranscript } from './arollChunkTranscript.js';
export { processChunkRefinement } from './chunkRefinement.js';

// Phase 3: Semantic Matching & Creative Edit Plan & Cut Plan
export { processSemanticMatching } from './semanticMatching.js';
export { processCreativeEditPlan } from './creativeEditPlan.js';
export { processCutPlanGeneration } from './cutPlanGeneration.js';
export { processCutPlanValidation } from './cutPlanValidation.js';
export { processFfmpegRenderMicrocutV2 } from './ffmpegRenderMicrocutV2.js';

export { processMuxPublish } from './muxPublish.js';
