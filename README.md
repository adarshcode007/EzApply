# ApplyPilot

Monorepo scaffold for the ApplyPilot autonomous job application agent.

## Layout
- `apps/web` - React + Vite frontend with Tailwind CSS
- `apps/api` - Fastify API
- `apps/worker` - BullMQ + LangGraph workers
- `packages/shared` - shared types/utilities
- `packages/database` - Drizzle/Postgres setup

## Getting started
1. Copy `.env.example` to `.env`
2. Run `docker compose up -d`
3. Install dependencies with `pnpm install`
4. Start dev mode with `pnpm dev`

## Env
- `DATABASE_URL`
- `REDIS_URL`
- `API_BASE_URL` for the worker service (default `http://localhost:3001`)
- `VITE_API_URL` for the web app (default `http://localhost:3001`)

## Current MVP surface
- `POST /resumes/upload` accepts a resume file or `rawText` and stores the parsed sections
- `PUT /users/:email/preferences` saves autonomy threshold settings
- `POST /jobs/manual` creates a manual job posting
- `POST /jobs/:jobPostingId/plan` runs the planner and returns apply/skip + confidence
- `POST /jobs/:jobPostingId/tailor` plans first, then tailors only if approved
- `POST /pipelines/run` enqueues a BullMQ scrape → plan → tailor workflow
- Web app at `apps/web` includes forms for upload, planner settings, manual job entry, tailoring, and a Kanban dashboard

### Queue flow
1. API enqueues `scrape-queue`
2. Worker creates jobs and enqueues `plan-queue`
3. Planner routes `apply` jobs to a `tailor-queue -> track-queue` flow
4. Manual status changes on the Kanban board update `human_overridden` and log a tracker event
