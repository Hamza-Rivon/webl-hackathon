-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('tiktok', 'reels', 'shorts', 'all');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('daily', 'weekly', 'biweekly', 'monthly');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('draft', 'script_ready', 'recording_vo', 'collecting_slots', 'processing', 'preview_ready', 'rendering', 'ready', 'published', 'failed');

-- CreateEnum
CREATE TYPE "EpisodeMode" AS ENUM ('template_copy', 'auto_edit');

-- CreateEnum
CREATE TYPE "SlotType" AS ENUM ('a_roll_face', 'b_roll_illustration', 'b_roll_action', 'screen_record', 'product_shot', 'pattern_interrupt', 'cta_overlay');

-- CreateEnum
CREATE TYPE "SlotSource" AS ENUM ('recorded', 'uploaded');

-- CreateEnum
CREATE TYPE "VideoOrientation" AS ENUM ('portrait', 'landscape', 'square');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('mux_ingest', 'mux_ai_enrichment', 'template_slot_planning', 'candidate_generation', 'instant_preview', 'remotion_render', 'mux_publish', 'transcription', 'proxy_generation', 'scene_detection', 'video_understanding', 'beat_matching', 'motion_graphics', 'edit_plan', 'render');

-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('starting', 'downloading', 'uploading', 'processing', 'analyzing', 'building', 'rendering', 'publishing', 'done');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'processing', 'done', 'error', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSignInAt" TIMESTAMP(3),
    "onboarded" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'free',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "subNiche" TEXT,
    "targetAudience" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "platforms" "Platform"[],
    "offer" TEXT,
    "cta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Series" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cadence" "Cadence" NOT NULL DEFAULT 'weekly',
    "personaOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "platform" "Platform" NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "durationTarget" INTEGER NOT NULL,
    "templatePackageVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "timelineSpec" JSONB NOT NULL,
    "layoutSpec" JSONB NOT NULL,
    "slotRequirements" JSONB NOT NULL,
    "styleSpec" JSONB NOT NULL,
    "motionSpec" JSONB NOT NULL,
    "remotionCompositionId" TEXT NOT NULL,
    "remotionPropsSchema" JSONB NOT NULL,
    "canonicalScript" TEXT,
    "scriptStructure" JSONB,
    "editingRecipe" JSONB,
    "personaTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "niche" TEXT,
    "tone" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "retentionRate" DOUBLE PRECISION,
    "saveRate" DOUBLE PRECISION,
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'draft',
    "templateId" TEXT,
    "templateVersion" TEXT,
    "mode" "EpisodeMode" NOT NULL DEFAULT 'template_copy',
    "scriptContent" TEXT,
    "scriptBeats" JSONB,
    "voiceoverS3Key" TEXT,
    "finalS3Key" TEXT,
    "voiceoverDuration" DOUBLE PRECISION,
    "muxVoiceoverAssetId" TEXT,
    "muxClipAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "muxFinalAssetId" TEXT,
    "muxFinalPlaybackId" TEXT,
    "templateCompile" JSONB,
    "renderSpec" JSONB,
    "voiceoverPath" TEXT,
    "rawClipPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proxyPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "finalVideoPath" TEXT,
    "thumbnailPath" TEXT,
    "editPlan" JSONB,
    "duration" DOUBLE PRECISION,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "seriesId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlotClip" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "slotType" "SlotType" NOT NULL,
    "source" "SlotSource" NOT NULL,
    "s3Key" TEXT NOT NULL,
    "muxAssetId" TEXT,
    "muxPlaybackId" TEXT,
    "duration" DOUBLE PRECISION,
    "fps" INTEGER,
    "orientation" "VideoOrientation",
    "width" INTEGER,
    "height" INTEGER,
    "aiTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiSummary" TEXT,
    "aiEmbeddingsRef" TEXT,
    "moderationStatus" TEXT,
    "selectedSegments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlotClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "stage" "JobStage" NOT NULL DEFAULT 'starting',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "overallProgress" INTEGER NOT NULL DEFAULT 0,
    "inputPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputPath" TEXT,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "episodeId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Persona_userId_key" ON "Persona"("userId");

-- CreateIndex
CREATE INDEX "Series_userId_idx" ON "Series"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_key" ON "Template"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Template_embeddingId_key" ON "Template"("embeddingId");

-- CreateIndex
CREATE INDEX "Template_platform_idx" ON "Template"("platform");

-- CreateIndex
CREATE INDEX "Template_niche_idx" ON "Template"("niche");

-- CreateIndex
CREATE INDEX "Episode_userId_idx" ON "Episode"("userId");

-- CreateIndex
CREATE INDEX "Episode_seriesId_idx" ON "Episode"("seriesId");

-- CreateIndex
CREATE INDEX "Episode_status_idx" ON "Episode"("status");

-- CreateIndex
CREATE INDEX "Episode_templateId_idx" ON "Episode"("templateId");

-- CreateIndex
CREATE INDEX "SlotClip_episodeId_idx" ON "SlotClip"("episodeId");

-- CreateIndex
CREATE INDEX "SlotClip_slotId_idx" ON "SlotClip"("slotId");

-- CreateIndex
CREATE INDEX "SlotClip_slotType_idx" ON "SlotClip"("slotType");

-- CreateIndex
CREATE INDEX "Job_userId_idx" ON "Job"("userId");

-- CreateIndex
CREATE INDEX "Job_episodeId_idx" ON "Job"("episodeId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_type_idx" ON "Job"("type");

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Series" ADD CONSTRAINT "Series_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlotClip" ADD CONSTRAINT "SlotClip_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
