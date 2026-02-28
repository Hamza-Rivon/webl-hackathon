-- Add corrected transcript storage
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "correctedWordTranscript" JSONB;

-- Add new job type for transcript correction
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType' AND e.enumlabel = 'voiceover_transcript_correction'
  ) THEN
    ALTER TYPE "JobType" ADD VALUE 'voiceover_transcript_correction';
  END IF;
END $$;
