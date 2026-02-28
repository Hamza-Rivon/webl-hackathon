-- Remove legacy preview/remotion jobs
DELETE FROM "Job" WHERE type IN ('instant_preview', 'remotion_render');

-- Map preview-ready episodes back to cut_plan_ready
UPDATE "Episode" SET "status" = 'cut_plan_ready' WHERE "status" = 'preview_ready';

-- Drop preview request fields (no preview flow)
ALTER TABLE "Episode" DROP COLUMN IF EXISTS "previewRequested";
ALTER TABLE "Episode" DROP COLUMN IF EXISTS "previewRequestedAt";
ALTER TABLE "Episode" DROP COLUMN IF EXISTS "previewJobId";

-- Drop Remotion template fields
ALTER TABLE "Template" DROP COLUMN IF EXISTS "remotionCompositionId";
ALTER TABLE "Template" DROP COLUMN IF EXISTS "remotionPropsSchema";

-- Update RenderEngine enum to ffmpeg-only
ALTER TYPE "RenderEngine" RENAME TO "RenderEngine_old";
CREATE TYPE "RenderEngine" AS ENUM ('ffmpeg_microcut_v2');

-- IMPORTANT: drop the old default before changing the enum type
ALTER TABLE "Template" ALTER COLUMN "renderEngine" DROP DEFAULT;

ALTER TABLE "Template" ALTER COLUMN "renderEngine" TYPE "RenderEngine" USING (
  CASE
    WHEN "renderEngine"::text = 'ffmpeg_microcut_v2' THEN 'ffmpeg_microcut_v2'::"RenderEngine"
    ELSE 'ffmpeg_microcut_v2'::"RenderEngine"
  END
);

-- Re-set default (explicit cast is safest)
ALTER TABLE "Template" ALTER COLUMN "renderEngine" SET DEFAULT 'ffmpeg_microcut_v2'::"RenderEngine";

DROP TYPE "RenderEngine_old";


-- Update EpisodeStatus enum (remove preview_ready)
ALTER TYPE "EpisodeStatus" RENAME TO "EpisodeStatus_old";
CREATE TYPE "EpisodeStatus" AS ENUM (
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'published',
  'failed'
);
-- IMPORTANT: drop old default before altering the enum type
ALTER TABLE "Episode" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Episode" ALTER COLUMN "status" TYPE "EpisodeStatus" USING (
  CASE
    WHEN "status"::text = 'preview_ready' THEN 'cut_plan_ready'::"EpisodeStatus"
    ELSE "status"::text::"EpisodeStatus"
  END
);

-- Re-set the default to whatever your schema expects (example: 'draft')
ALTER TABLE "Episode" ALTER COLUMN "status" SET DEFAULT 'draft'::"EpisodeStatus";

DROP TYPE "EpisodeStatus_old";

-- Update JobType enum (remove instant_preview/remotion_render)
ALTER TYPE "JobType" RENAME TO "JobType_old";
CREATE TYPE "JobType" AS ENUM (
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
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
  'cut_plan_generation',
  'cut_plan_validation',
  'ffmpeg_render_microcut_v2',
  'mux_publish',
  'mux_ingest',
  'mux_ai_enrichment',
  'template_slot_planning',
  'candidate_generation'
);
ALTER TABLE "Job" ALTER COLUMN "type" TYPE "JobType" USING (
  CASE
    WHEN type::text = 'voiceover_ingest' THEN 'voiceover_ingest'::"JobType"
    WHEN type::text = 'voiceover_transcript' THEN 'voiceover_transcript'::"JobType"
    WHEN type::text = 'voiceover_transcript_correction' THEN 'voiceover_transcript_correction'::"JobType"
    WHEN type::text = 'voiceover_silence_detection' THEN 'voiceover_silence_detection'::"JobType"
    WHEN type::text = 'voiceover_cleaning' THEN 'voiceover_cleaning'::"JobType"
    WHEN type::text = 'voiceover_segmentation' THEN 'voiceover_segmentation'::"JobType"
    WHEN type::text = 'broll_ingest' THEN 'broll_ingest'::"JobType"
    WHEN type::text = 'broll_chunking' THEN 'broll_chunking'::"JobType"
    WHEN type::text = 'broll_chunk_ingest' THEN 'broll_chunk_ingest'::"JobType"
    WHEN type::text = 'slot_clip_enrichment' THEN 'slot_clip_enrichment'::"JobType"
    WHEN type::text = 'broll_chunk_enrichment' THEN 'broll_chunk_enrichment'::"JobType"
    WHEN type::text = 'broll_chunk_embedding' THEN 'broll_chunk_embedding'::"JobType"
    WHEN type::text = 'aroll_chunk_transcript' THEN 'aroll_chunk_transcript'::"JobType"
    WHEN type::text = 'chunk_refinement' THEN 'chunk_refinement'::"JobType"
    WHEN type::text = 'semantic_matching' THEN 'semantic_matching'::"JobType"
    WHEN type::text = 'cut_plan_generation' THEN 'cut_plan_generation'::"JobType"
    WHEN type::text = 'cut_plan_validation' THEN 'cut_plan_validation'::"JobType"
    WHEN type::text = 'ffmpeg_render_microcut_v2' THEN 'ffmpeg_render_microcut_v2'::"JobType"
    WHEN type::text = 'mux_publish' THEN 'mux_publish'::"JobType"
    WHEN type::text = 'mux_ingest' THEN 'mux_ingest'::"JobType"
    WHEN type::text = 'mux_ai_enrichment' THEN 'mux_ai_enrichment'::"JobType"
    WHEN type::text = 'template_slot_planning' THEN 'template_slot_planning'::"JobType"
    WHEN type::text = 'candidate_generation' THEN 'candidate_generation'::"JobType"
    ELSE 'voiceover_ingest'::"JobType"
  END
);
DROP TYPE "JobType_old";
