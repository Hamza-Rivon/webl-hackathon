-- AlterEnum: Add creative_edit_plan to JobType
ALTER TYPE "JobType" ADD VALUE 'creative_edit_plan';

-- AlterTable: Add creativeBrief to Episode
ALTER TABLE "Episode" ADD COLUMN "creativeBrief" JSONB;
