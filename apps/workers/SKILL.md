# apps/workers Skill Guide

## Purpose

This folder runs the background processing pipeline. Workers consume BullMQ jobs from Redis, update the database, publish progress, and render final media outputs.

## What this folder exposes to the rest of the platform

- Job processing side effects in Postgres (Episode, Job, SlotClip, BrollChunk, VoiceoverSegment).
- Progress events in Redis Pub/Sub channels (`job:progress:{jobId}`).
- Rendered outputs in S3 and published assets in Mux.

## Core pipeline phases

- Phase 1 (voiceover): ingest -> transcript -> silence detection -> cleaning -> segmentation.
- Phase 2 (b-roll): ingest -> chunking -> enrichment -> embedding.
- Phase 3: semantic matching between VoiceoverSegment and BrollChunk.
- Phase 4: cut plan generation and validation (renderSpec creation).
- Phase 5: instant preview, Remotion render, Mux publish.

## Key entry points and modules

- `apps/workers/src/index.ts`: service entry point, Redis validation, DB polling fallback.
- `apps/workers/src/workers.ts`: BullMQ worker registrations and concurrency.
- `apps/workers/src/jobs/*`: job processors (one per job type).
- `apps/workers/src/services/progress.ts`: Redis Pub/Sub progress publisher.
- `apps/workers/src/services/renderSpecBuilder.ts`: renderSpec construction.
- `apps/workers/src/services/dbPolling.ts`: Redis-down fallback processing.

## Actions you can take here

- Add new job types or adjust job processing logic.
- Update progress reporting for UI.
- Modify render spec generation and Remotion rendering behavior.
- Update readiness checks for pipeline transitions.

## Guardrails

- Update Job.status, stage, and progress consistently.
- Publish progress updates for long-running steps.
- Keep episode status transitions aligned with the pipeline.
- Prefer S3-based audio/video sources for rendering to avoid Mux latency.
