# packages/shared Skill Guide

## Purpose

This folder contains shared types, schemas, constants, and small utilities used across API, workers, and mobile.

## What this folder exposes to the rest of the platform

- Shared TypeScript types for episodes, templates, slots, and render specs.
- Zod schemas and constants used in validation.
- Small shared services (logger, S3 helpers).

## Key entry points and modules

- `packages/shared/src/index.ts`: main export barrel.
- `packages/shared/src/types/`: domain types (Episode, Slot, RenderSpec).
- `packages/shared/src/schemas/`: validation schemas.
- `packages/shared/src/constants/`: shared constants.
- `packages/shared/src/utils/`: small utilities (security, helpers).

## Actions you can take here

- Add or refine shared types used by multiple apps.
- Add shared validation schemas when the same data shape crosses services.

## Guardrails

- Avoid breaking changes; multiple packages import these types.
- Keep runtime code minimal to reduce bundle size.
