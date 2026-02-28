-- Add metadata column to VoiceoverSegment table
-- This field stores candidate chunk IDs and matching metadata for cut plan generation
ALTER TABLE "VoiceoverSegment" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
