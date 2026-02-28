-- Create activity event enums
CREATE TYPE "ActivityEntityType" AS ENUM ('episode', 'job');

CREATE TYPE "ActivityEventType" AS ENUM (
  'episode_status_changed',
  'job_created',
  'job_updated',
  'job_completed',
  'job_failed',
  'job_cancelled'
);

-- Create activity event log table for realtime replay and activity feed aggregation
CREATE TABLE "ActivityEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "episodeId" TEXT,
  "jobId" TEXT,
  "entityType" "ActivityEntityType" NOT NULL,
  "eventType" "ActivityEventType" NOT NULL,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ActivityEvent"
  ADD CONSTRAINT "ActivityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityEvent"
  ADD CONSTRAINT "ActivityEvent_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActivityEvent"
  ADD CONSTRAINT "ActivityEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ActivityEvent_userId_occurredAt_idx"
  ON "ActivityEvent"("userId", "occurredAt" DESC);

CREATE INDEX "ActivityEvent_episodeId_occurredAt_idx"
  ON "ActivityEvent"("episodeId", "occurredAt" DESC);

CREATE INDEX "ActivityEvent_jobId_occurredAt_idx"
  ON "ActivityEvent"("jobId", "occurredAt" DESC);

CREATE INDEX "ActivityEvent_eventType_occurredAt_idx"
  ON "ActivityEvent"("eventType", "occurredAt" DESC);
