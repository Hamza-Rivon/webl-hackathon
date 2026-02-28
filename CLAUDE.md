# WEBL - AI Video Editing Platform

## Monorepo Structure
- `apps/api` — Express + Socket.IO REST API (Clerk auth, BullMQ, Prisma, Mux, S3)
- `apps/workers` — BullMQ background jobs (FFmpeg, Gemini, OpenAI, Mux, Deepgram)
- `apps/mobile` — Expo v54 + React Native + NativeWind + Zustand + Expo Router
- `apps/admin-dashboard` — Next.js v14 admin panel
- `packages/shared` — Shared types, schemas, Zod validation, utils
- `packages/prisma` — Prisma v6 schema, Neon PostgreSQL + pgvector

## Commands
- `pnpm dev` — Run API + workers
- `pnpm dev:api|mobile|workers|admin` — Single app
- `pnpm build:packages` — Build shared + prisma first
- `pnpm db:migrate|seed|push` — Database ops

## Conventions
- Package manager: **pnpm** (v10.15+)
- All packages ESM (`"type": "module"`) scoped `@webl/*`
- TypeScript strict mode, max 500-line files, 100-line functions
- Pipeline architecture: Episode → Jobs (BullMQ) → realtime progress (Socket.IO)
- Clerk auth across all apps
- See `/ARCHITECTURE.md` for pipeline details and DB model
- See `CODEBASE_ANALYSIS.md` for more accurate and detailed full code base behavior
