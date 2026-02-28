-- AlterTable
ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "rawDeepgramResponse" JSONB;
