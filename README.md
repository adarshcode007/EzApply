# ApplyPilot

Monorepo scaffold for the ApplyPilot autonomous job application agent.

## Layout
- `apps/web` - React + Vite frontend with Tailwind CSS
- `apps/api` - Fastify API with OpenAI structured outputs and LangGraph orchestration
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
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default `gpt-4o-mini`)
- `API_BASE_URL` for the worker service (default `http://localhost:3001`)
- `VITE_API_URL` for the web app (default `http://localhost:3001`)

## Current MVP surface
- `POST /resumes/upload` accepts a resume file or `rawText` and stores the parsed sections
- `PUT /users/:email/preferences` saves autonomy threshold settings
- `POST /jobs/manual` creates a manual job posting
- `POST /jobs/:jobPostingId/plan` runs the planner with OpenAI structured output
- `POST /jobs/:jobPostingId/process` runs the LangGraph planner → conditional route → tailor → track flow
- `POST /jobs/:jobPostingId/resume` resumes the same LangGraph thread/checkpoint
- `GET /jobs/:jobPostingId/graph-state` inspects the latest LangGraph checkpoint state
- `POST /jobs/:jobPostingId/tailor` can still run tailoring directly for manual testing
- `POST /pipelines/run` enqueues a BullMQ scrape → plan/process workflow
- Web app at `apps/web` includes forms for upload, planner settings, manual job entry, tailoring, and a Kanban dashboard

### Queue flow
1. API enqueues `scrape-queue`
2. Worker creates jobs and enqueues `plan-queue`
3. Each `plan-queue` job triggers a LangGraph run with Postgres-backed checkpoints
4. The graph handles planner → conditional route → tailor → track
5. Manual status changes on the Kanban board update `human_overridden` and log a tracker event
