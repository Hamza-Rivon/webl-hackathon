-- Add tables to support script-aware keyterms for Deepgram Keyterm Prompting

-- CreateEnum
CREATE TYPE "KeytermCategory" AS ENUM ('company', 'product', 'jargon', 'non_english', 'person', 'location', 'other');

-- CreateEnum
CREATE TYPE "KeytermSource" AS ENUM ('user', 'llm');

-- CreateEnum
CREATE TYPE "EpisodeKeytermSource" AS ENUM ('user', 'matched', 'llm');

-- CreateTable
CREATE TABLE "Keyterm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalizedTerm" TEXT NOT NULL,
    "category" "KeytermCategory" NOT NULL DEFAULT 'other',
    "language" TEXT,
    "source" "KeytermSource" NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyterm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeKeyterm" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "keytermId" TEXT NOT NULL,
    "source" "EpisodeKeytermSource" NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeKeyterm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Keyterm_userId_idx" ON "Keyterm"("userId");

-- CreateIndex
CREATE INDEX "Keyterm_userId_category_idx" ON "Keyterm"("userId", "category");

-- CreateIndex
CREATE INDEX "Keyterm_normalizedTerm_idx" ON "Keyterm"("normalizedTerm");

-- CreateIndex
CREATE UNIQUE INDEX "Keyterm_userId_normalizedTerm_key" ON "Keyterm"("userId", "normalizedTerm");

-- CreateIndex
CREATE INDEX "EpisodeKeyterm_episodeId_idx" ON "EpisodeKeyterm"("episodeId");

-- CreateIndex
CREATE INDEX "EpisodeKeyterm_keytermId_idx" ON "EpisodeKeyterm"("keytermId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeKeyterm_episodeId_keytermId_key" ON "EpisodeKeyterm"("episodeId", "keytermId");

-- AddForeignKey
ALTER TABLE "Keyterm" ADD CONSTRAINT "Keyterm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeKeyterm" ADD CONSTRAINT "EpisodeKeyterm_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeKeyterm" ADD CONSTRAINT "EpisodeKeyterm_keytermId_fkey" FOREIGN KEY ("keytermId") REFERENCES "Keyterm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

