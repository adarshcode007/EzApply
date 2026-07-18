# ApplyPilot

Monorepo scaffold for the ApplyPilot autonomous job application agent.

## Layout
- `apps/web` - React + Vite frontend
- `apps/api` - Fastify API
- `apps/worker` - BullMQ + LangGraph workers
- `packages/shared` - shared types/utilities
- `packages/database` - Drizzle/Postgres setup

## Getting started
1. Copy `.env.example` to `.env`
2. Run `docker compose up -d`
3. Install dependencies with `pnpm install`
4. Start dev mode with `pnpm dev`

## Current MVP surface
- `POST /resumes/upload` accepts a resume file or `rawText` and stores the parsed sections
- `POST /jobs/manual` creates a manual job posting
- `POST /jobs/:jobPostingId/tailor` generates a tailored `.docx` resume and cover letter draft
- Web app at `apps/web` includes forms for upload, manual job entry, and tailoring
