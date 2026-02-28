DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RenderEngine') THEN
    CREATE TYPE "RenderEngine" AS ENUM ('remotion', 'ffmpeg_microcut_v2');
  END IF;
END $$;

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "renderEngine" "RenderEngine" NOT NULL DEFAULT 'remotion';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'needs_more_clips'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'EpisodeStatus')
  ) THEN
    ALTER TYPE "EpisodeStatus" ADD VALUE 'needs_more_clips';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'ffmpeg_render_microcut_v2'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'JobType')
  ) THEN
    ALTER TYPE "JobType" ADD VALUE 'ffmpeg_render_microcut_v2';
  END IF;
END $$;

DROP INDEX IF EXISTS broll_chunk_embedding_idx;
DROP INDEX IF EXISTS voiceover_segment_embedding_idx;

ALTER TABLE "BrollChunk" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "BrollChunk" ADD COLUMN "embedding" vector(3072);

ALTER TABLE "VoiceoverSegment" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "VoiceoverSegment" ADD COLUMN "embedding" vector(3072);
