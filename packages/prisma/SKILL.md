# packages/prisma Skill Guide

## Purpose

This folder defines the canonical data model and provides the Prisma client for the rest of the platform.

## What this folder exposes to the rest of the platform

- Prisma schema for all core entities (User, Episode, SlotClip, Job, etc).
- Migrations that evolve the database.
- Prisma client consumed as `@webl/prisma`.

## Key entry points and modules

- `packages/prisma/schema.prisma`: database schema.
- `packages/prisma/src/index.ts`: Prisma client export.
- `packages/prisma/migrations/`: migration history.
- `packages/prisma/setup-pgvector.ts`: pgvector extension setup.

## Actions you can take here

- Add or modify models and fields.
- Add migrations to support new pipelines or features.
- Update enum values to match new workflow states.

## Guardrails

- Coordinate schema changes with API and worker logic.
- Keep pgvector fields consistent with embedding dimensions (1536).
