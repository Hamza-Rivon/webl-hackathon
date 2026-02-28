-- Add new JobType enum values for Phase 2 two-stage enrichment
-- This migration adds slot_clip_enrichment and chunk_refinement job types

-- Add new enum values to JobType
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'slot_clip_enrichment';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'chunk_refinement';

-- Note: If 'aroll_chunk_transcript' already exists in the database but not in migrations,
-- it's already been added manually. This migration only adds the new values.
