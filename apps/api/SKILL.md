# apps/api Skill Guide

## Purpose

This folder owns the HTTP API for WEBL. It validates requests, enforces auth via Clerk, writes to Postgres via Prisma, and enqueues background jobs in Redis.

## What this folder exposes to the rest of the platform

- REST endpoints under `/api/*` (episodes, uploads, jobs, series, templates, users, onboarding, slots).
- SSE endpoint for job progress: `/api/jobs/:id/progress`.
- Signed S3 URLs for uploads/downloads.
- Queue enqueueing to Redis via BullMQ.

## Core data flows

- Upload completion writes Episode/SlotClip records and creates Job rows, then enqueues the matching BullMQ job.
- Job status is read from the Job table and streamed via SSE (Redis Pub/Sub).
- Episode responses include Mux playback URLs and S3 download URLs.

## Key entry points and modules

- `apps/api/src/index.ts`: service entry point.
- `apps/api/src/app.ts`: Express app wiring and route registration.
- `apps/api/src/routes/uploads.ts`: S3 presign + job creation.
- `apps/api/src/routes/episodes.ts`: episode CRUD and script/candidate actions.
- `apps/api/src/routes/jobs.ts`: list/retry/cancel + SSE progress stream.
- `apps/api/src/services/queue.ts`: BullMQ queues and job mapping.
- `apps/api/src/services/s3.ts`: signed URLs and multipart uploads.

## Actions you can take here

- Add or update API endpoints.
- Extend upload flows and create new job types.
- Add response fields derived from DB or Mux/S3.
- Add middleware for validation, auth, and error handling.

## Guardrails

- Always create a Job row in Postgres before enqueuing to Redis.
- Keep episode status transitions consistent with the pipeline.
- Use Zod schemas + `validate()` for request input.
- Respect Clerk auth (only /health, /proxy, /webhooks are unauthenticated).
