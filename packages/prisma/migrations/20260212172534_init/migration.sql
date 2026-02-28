-- AlterEnum
-- Guard this enum addition because it already exists in
-- 20260209120000_add_creative_edit_plan for normal migration history.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'JobType' AND e.enumlabel = 'creative_edit_plan'
  ) THEN
    ALTER TYPE "JobType" ADD VALUE 'creative_edit_plan';
  END IF;
END $$;
