-- Resolve drift: sync migration history with actual database schema

-- Add aroll_chunk_transcript to JobType enum
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'aroll_chunk_transcript';

-- Remove index on BrollChunk.embedding if it exists
DROP INDEX IF EXISTS "BrollChunk_embedding_idx";
DROP INDEX IF EXISTS "broll_chunk_embedding_idx";

-- Update BrollChunk.updatedAt to remove default (Prisma @updatedAt handles this)
ALTER TABLE "BrollChunk" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Make Job.maxRetries required (set default for existing NULL values, then make NOT NULL)
UPDATE "Job" SET "maxRetries" = 3 WHERE "maxRetries" IS NULL;
ALTER TABLE "Job" ALTER COLUMN "maxRetries" SET NOT NULL;
ALTER TABLE "Job" ALTER COLUMN "maxRetries" SET DEFAULT 3;

-- Make SlotClip.chunkCount required (set default for existing NULL values, then make NOT NULL)
UPDATE "SlotClip" SET "chunkCount" = 0 WHERE "chunkCount" IS NULL;
ALTER TABLE "SlotClip" ALTER COLUMN "chunkCount" SET NOT NULL;
ALTER TABLE "SlotClip" ALTER COLUMN "chunkCount" SET DEFAULT 0;

-- Update UserUsage.updatedAt to remove default (Prisma @updatedAt handles this)
ALTER TABLE "UserUsage" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Remove index on VoiceoverSegment.embedding if it exists
DROP INDEX IF EXISTS "VoiceoverSegment_embedding_idx";
DROP INDEX IF EXISTS "voiceover_segment_embedding_idx";

-- Update VoiceoverSegment.keywords and visualNeeds to remove default empty array
-- Change default from [] to NULL (or no default)
ALTER TABLE "VoiceoverSegment" ALTER COLUMN "keywords" DROP DEFAULT;
ALTER TABLE "VoiceoverSegment" ALTER COLUMN "visualNeeds" DROP DEFAULT;
