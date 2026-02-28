-- Remove legacy job rows that are no longer supported
DELETE FROM "Job"
WHERE type::text IN (
  'mux_ingest',
  'mux_ai_enrichment',
  'template_slot_planning',
  'candidate_generation',
  'instant_preview',
  'remotion_render'
);

-- Drop deprecated visualNeeds column from VoiceoverSegment
ALTER TABLE "VoiceoverSegment" DROP COLUMN IF EXISTS "visualNeeds";

-- Replace JobType enum without legacy values
CREATE TYPE "JobType_new" AS ENUM (
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
  'voiceover_take_selection',
  'voiceover_silence_detection',
  'voiceover_cleaning',
  'voiceover_segmentation',
  'broll_ingest',
  'broll_chunking',
  'broll_chunk_ingest',
  'slot_clip_enrichment',
  'broll_chunk_enrichment',
  'broll_chunk_embedding',
  'aroll_chunk_transcript',
  'chunk_refinement',
  'semantic_matching',
  'creative_edit_plan',
  'cut_plan_generation',
  'cut_plan_validation',
  'ffmpeg_render_microcut_v2',
  'mux_publish'
);

ALTER TABLE "Job"
  ALTER COLUMN "type" TYPE "JobType_new"
  USING ("type"::text::"JobType_new");

DROP TYPE "JobType";
ALTER TYPE "JobType_new" RENAME TO "JobType";
