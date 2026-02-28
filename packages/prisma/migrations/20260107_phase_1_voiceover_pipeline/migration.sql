-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Update existing Episode statuses to new Phase 1 statuses
UPDATE "Episode" 
SET status = 'draft' 
WHERE status NOT IN ('draft', 'ready', 'published', 'failed');

-- Add new columns to Episode table for Phase 1
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "rawVoiceoverS3Key" TEXT;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "rawVoiceoverMuxAssetId" TEXT;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "rawVoiceoverDuration" DOUBLE PRECISION;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "cleanVoiceoverS3Key" TEXT;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "cleanVoiceoverMuxAssetId" TEXT;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "cleanVoiceoverPlaybackId" TEXT;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "cleanVoiceoverDuration" DOUBLE PRECISION;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "wordTranscript" JSONB;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "cutPlan" JSONB;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "matchCoverage" DOUBLE PRECISION;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "averageMatchScore" DOUBLE PRECISION;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "estimatedCostUSD" DOUBLE PRECISION;
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "actualCostUSD" DOUBLE PRECISION;

-- Update EpisodeStatus enum
ALTER TYPE "EpisodeStatus" RENAME TO "EpisodeStatus_old";

CREATE TYPE "EpisodeStatus" AS ENUM (
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'preview_ready',
  'rendering',
  'ready',
  'published',
  'failed'
);

ALTER TABLE "Episode" ALTER COLUMN status DROP DEFAULT;
ALTER TABLE "Episode" ALTER COLUMN status TYPE "EpisodeStatus" USING (
  CASE 
    WHEN status::text = 'draft' THEN 'draft'::"EpisodeStatus"
    WHEN status::text = 'ready' THEN 'ready'::"EpisodeStatus"
    WHEN status::text = 'published' THEN 'published'::"EpisodeStatus"
    WHEN status::text = 'failed' THEN 'failed'::"EpisodeStatus"
    WHEN status::text = 'rendering' THEN 'rendering'::"EpisodeStatus"
    WHEN status::text = 'preview_ready' THEN 'preview_ready'::"EpisodeStatus"
    ELSE 'draft'::"EpisodeStatus"
  END
);
ALTER TABLE "Episode" ALTER COLUMN status SET DEFAULT 'draft'::"EpisodeStatus";

DROP TYPE "EpisodeStatus_old";

-- Update JobType enum with Phase 1-5 types
DO $$ BEGIN
  CREATE TYPE "JobType_new" AS ENUM (
    'voiceover_ingest',
    'voiceover_transcript',
    'voiceover_silence_detection',
    'voiceover_cleaning',
    'voiceover_segmentation',
    'broll_ingest',
    'broll_chunking',
    'broll_chunk_ingest',
    'broll_chunk_enrichment',
    'broll_chunk_embedding',
    'semantic_matching',
    'cut_plan_generation',
    'cut_plan_validation',
    'instant_preview',
    'remotion_render',
    'mux_publish',
    'mux_ingest',
    'mux_ai_enrichment',
    'template_slot_planning',
    'candidate_generation'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Only update Job table if JobType_new was created
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JobType_new') THEN
    ALTER TABLE "Job" ALTER COLUMN type TYPE "JobType_new" USING (
      CASE 
        WHEN type::text = 'mux_ingest' THEN 'mux_ingest'::"JobType_new"
        WHEN type::text = 'mux_ai_enrichment' THEN 'mux_ai_enrichment'::"JobType_new"
        WHEN type::text = 'template_slot_planning' THEN 'template_slot_planning'::"JobType_new"
        WHEN type::text = 'candidate_generation' THEN 'candidate_generation'::"JobType_new"
        WHEN type::text = 'instant_preview' THEN 'instant_preview'::"JobType_new"
        WHEN type::text = 'remotion_render' THEN 'remotion_render'::"JobType_new"
        WHEN type::text = 'mux_publish' THEN 'mux_publish'::"JobType_new"
        ELSE 'mux_ingest'::"JobType_new"
      END
    );
    DROP TYPE "JobType";
    ALTER TYPE "JobType_new" RENAME TO "JobType";
  END IF;
END $$;

-- Add new columns to Job table
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "parentJobId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "childJobIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "batchId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "batchIndex" INTEGER;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "batchTotal" INTEGER;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "inputData" JSONB;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "outputData" JSONB;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "maxRetries" INTEGER DEFAULT 3;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "estimatedCostUSD" DOUBLE PRECISION;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "actualCostUSD" DOUBLE PRECISION;

-- Create index on batchId
CREATE INDEX IF NOT EXISTS "Job_batchId_idx" ON "Job"("batchId");

-- Add chunkCount to SlotClip
ALTER TABLE "SlotClip" ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER DEFAULT 0;

-- Create UserUsage table
CREATE TABLE IF NOT EXISTS "UserUsage" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT UNIQUE NOT NULL,
  "chunksProcessedThisHour" INTEGER DEFAULT 0 NOT NULL,
  "hourlyResetAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "episodesCreatedToday" INTEGER DEFAULT 0 NOT NULL,
  "rendersCompletedToday" INTEGER DEFAULT 0 NOT NULL,
  "dailyResetAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "totalChunksProcessed" INTEGER DEFAULT 0 NOT NULL,
  "totalEpisodesCreated" INTEGER DEFAULT 0 NOT NULL,
  "totalRendersCompleted" INTEGER DEFAULT 0 NOT NULL,
  "totalEstimatedCostUSD" DOUBLE PRECISION DEFAULT 0 NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "UserUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "UserUsage_userId_idx" ON "UserUsage"("userId");
CREATE INDEX IF NOT EXISTS "UserUsage_hourlyResetAt_idx" ON "UserUsage"("hourlyResetAt");

-- Create BrollChunk table
CREATE TABLE IF NOT EXISTS "BrollChunk" (
  "id" TEXT PRIMARY KEY,
  "episodeId" TEXT NOT NULL,
  "slotClipId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "s3Key" TEXT,
  "muxAssetId" TEXT,
  "muxPlaybackId" TEXT,
  "thumbnailUrl" TEXT,
  "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "aiSummary" TEXT,
  "moderationStatus" TEXT,
  "moderationScores" JSONB,
  "embedding" vector(1536),
  "embeddingText" TEXT,
  "qualityScore" DOUBLE PRECISION,
  "motionScore" DOUBLE PRECISION,
  "compositionScore" DOUBLE PRECISION,
  "matchedToSegmentId" TEXT,
  "matchScore" DOUBLE PRECISION,
  "isUsedInFinalCut" BOOLEAN DEFAULT false NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "BrollChunk_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BrollChunk_slotClipId_fkey" FOREIGN KEY ("slotClipId") REFERENCES "SlotClip"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "BrollChunk_episodeId_idx" ON "BrollChunk"("episodeId");
CREATE INDEX IF NOT EXISTS "BrollChunk_slotClipId_idx" ON "BrollChunk"("slotClipId");
CREATE INDEX IF NOT EXISTS "BrollChunk_chunkIndex_idx" ON "BrollChunk"("chunkIndex");
CREATE INDEX IF NOT EXISTS "BrollChunk_matchedToSegmentId_idx" ON "BrollChunk"("matchedToSegmentId");

-- Create pgvector index for BrollChunk
CREATE INDEX IF NOT EXISTS "broll_chunk_embedding_idx" 
ON "BrollChunk" USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create VoiceoverSegment table
CREATE TABLE IF NOT EXISTS "VoiceoverSegment" (
  "id" TEXT PRIMARY KEY,
  "episodeId" TEXT NOT NULL,
  "segmentIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "words" JSONB NOT NULL,
  "keywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visualNeeds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "emotionalTone" TEXT,
  "embedding" vector(1536),
  "embeddingText" TEXT,
  "matchedChunkId" TEXT,
  "matchScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "VoiceoverSegment_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "VoiceoverSegment_episodeId_idx" ON "VoiceoverSegment"("episodeId");
CREATE INDEX IF NOT EXISTS "VoiceoverSegment_segmentIndex_idx" ON "VoiceoverSegment"("segmentIndex");

-- Create pgvector index for VoiceoverSegment
CREATE INDEX IF NOT EXISTS "voiceover_segment_embedding_idx" 
ON "VoiceoverSegment" USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create function for similarity search
CREATE OR REPLACE FUNCTION find_similar_chunks(
  p_episode_id TEXT,
  p_segment_embedding vector(1536),
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id TEXT,
  slot_clip_id TEXT,
  chunk_index INT,
  start_ms INT,
  end_ms INT,
  ai_tags TEXT[],
  ai_summary TEXT,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bc.id,
    bc."slotClipId",
    bc."chunkIndex",
    bc."startMs",
    bc."endMs",
    bc."aiTags",
    bc."aiSummary",
    1 - (bc.embedding <=> p_segment_embedding) AS similarity
  FROM "BrollChunk" bc
  WHERE bc."episodeId" = p_episode_id
    AND bc.embedding IS NOT NULL
    AND bc."moderationStatus" = 'safe'
  ORDER BY bc.embedding <=> p_segment_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
