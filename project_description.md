# ApplyPilot — Autonomous Job Application Agent

## 1. Project Summary

ApplyPilot is a multi-tenant, multi-agent system that autonomously discovers relevant job
postings, decides which ones are worth applying to, tailors resumes and cover letters per
job, and tracks application status on a Kanban-style dashboard.

The key differentiator from a typical "AI resume generator" project: **the system makes
autonomous decisions about what to apply to**, with a calibrated human-in-the-loop trust
boundary (an "autonomy threshold" the user controls), full reasoning transparency, and an
auditable trail of every agent decision. It is not just an LLM text generator wrapped in a
UI — it is a stateful, observable, multi-agent pipeline.

Build this as a real, runnable full-stack application, not a prototype/demo script. Prioritize
correctness of the data model and pipeline architecture over UI polish in early phases.

---

## 2. Tech Stack

| Layer                       | Choice                                                                | Notes                                                                     |
| --------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Frontend                    | React (Vite), TypeScript                                              | Kanban board (dnd-kit), dashboards                                        |
| Backend API                 | Node.js, Fastify (or Express)                                         | REST API, TypeScript throughout                                           |
| Agent orchestration         | LangGraph (JS/TS)                                                     | Explicit state machine, not CrewAI — see §5 for rationale                 |
| Job queue                   | BullMQ (Redis-backed)                                                 | Scraping, planning, tailoring, tracking queues                            |
| Database                    | PostgreSQL                                                            | Primary datastore, see schema in §4                                       |
| Scraping                    | Playwright                                                            | Prefer structured ATS APIs (Greenhouse/Lever/Ashby) over generic scraping |
| LLM                         | Claude API (Anthropic), `claude-sonnet-4-6` or latest available model | Structured JSON outputs via tool-use/schema                               |
| Auth                        | Standard session/JWT auth (implementation detail, not the focus)      | Multi-tenant, per-user scoping                                            |
| File generation             | `docx` npm package (or python-docx via a small service)               | For tailored resume output files                                          |
| Email integration (stretch) | Gmail API                                                             | Auto-detect interview/rejection language                                  |

---

## 3. High-Level Architecture

```
React UI (Kanban, job detail, settings)
        |
        v
Node/Fastify API  <----->  Postgres (users, resumes, job_postings,
        |                             job_matches, applications, agent_runs)
        v
BullMQ (Redis) — 4 queues:
  scrape-queue -> plan-queue -> tailor-queue -> track-queue
  (chained per-user via BullMQ FlowProducer)
        |
        v
LangGraph orchestrator (per pipeline run)
  Planner Agent -> (conditional) -> Matcher/Tailor Agent -> Tracker Agent
        |
        v
Playwright scraper pool (rate-limited per domain, per-user concurrency caps)
```

Each pipeline run (one per user, once per scrape cycle) is a LangGraph graph with
checkpointing, so a failure mid-pipeline doesn't require re-running completed stages.
Every agent decision is logged to `agent_runs` for auditability and cost tracking.

---

## 4. Database Schema (PostgreSQL)

Design and implement this first — the rest of the system depends on it. Use a migration
tool (e.g. Drizzle ORM or Prisma — pick one and use it consistently; Drizzle is preferred
for its closeness to raw SQL and good TypeScript inference).

```sql
users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  preferences_json JSONB, -- roles, locations, keywords, salary floor, dealbreakers,
                           -- autonomy_threshold (0-1), auto_apply_enabled (bool)
  created_at TIMESTAMPTZ DEFAULT now()
);

resumes (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  raw_text TEXT,
  parsed_sections_json JSONB, -- { summary, skills[], experience[{title, company,
                               --   bullets[], dates}], education[], etc. }
  version INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

job_postings (
  id UUID PRIMARY KEY,
  source TEXT, -- 'greenhouse' | 'lever' | 'ashby' | 'manual'
  url TEXT,
  title TEXT,
  company TEXT,
  description TEXT,
  salary_range TEXT,
  location TEXT,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  raw_html_hash TEXT -- for dedup
);

job_matches (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  job_posting_id UUID REFERENCES job_postings(id),
  match_score FLOAT,
  match_reasoning TEXT,
  fit_highlights JSONB, -- string[]
  red_flags JSONB,      -- string[]
  decision TEXT, -- 'apply' | 'skip' | 'needs_review'
  confidence FLOAT,
  status TEXT, -- 'candidate' | 'rejected' | 'queued_for_tailoring'
  created_at TIMESTAMPTZ DEFAULT now()
);

applications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  job_posting_id UUID REFERENCES job_postings(id),
  tailored_resume_url TEXT,
  cover_letter_text TEXT,
  status TEXT, -- 'pending' | 'tailoring' | 'ready_for_review' | 'applied'
               -- | 'interview' | 'rejected' | 'offer'
  applied_at TIMESTAMPTZ,
  human_overridden BOOLEAN DEFAULT false, -- true if user changed the agent's decision
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

agent_runs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  agent_type TEXT, -- 'planner' | 'matcher' | 'tailor_resume' | 'tailor_cover_letter' | 'tracker'
  job_posting_id UUID REFERENCES job_postings(id),
  input_json JSONB,
  output_json JSONB,
  tokens_used INT,
  cost_usd NUMERIC,
  status TEXT, -- 'success' | 'error'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Index `job_postings(raw_html_hash)`, `job_matches(user_id, status)`,
`applications(user_id, status)`, `agent_runs(user_id, created_at)`.

All tables scoped by `user_id` — use Postgres Row-Level Security if time permits, otherwise
enforce scoping consistently at the query layer.

---

## 5. Agent Pipeline — Implementation Detail

### 5.1 Orchestration choice: LangGraph over CrewAI

Use LangGraph, not CrewAI. Rationale to encode in the README: this pipeline needs explicit
conditional routing (planner's apply/skip decision branches the graph), stateful execution,
and checkpointing so a failed run can resume mid-pipeline rather than restarting from
scratch. LangGraph's explicit graph/state-machine model fits this better than CrewAI's more
free-form conversational multi-agent framing.

### 5.2 Scraper stage (not an LLM agent — a controlled tool call)

- Prefer structured ATS APIs over generic scraping: Greenhouse, Lever, and Ashby all expose
  documented (or reverse-engineerable) JSON job-board endpoints for companies that use them.
  Start with these before attempting LinkedIn/Indeed, which have aggressive anti-bot
  measures and ToS restrictions on automation.
- Playwright is the fallback for sources without a structured API.
- Rate limiting: BullMQ queue-level concurrency limits per domain
  (`limiter: { max: 5, duration: 1000 }`), plus a Redis token bucket keyed by domain so
  multiple users' scrape jobs never exceed a safe per-domain rate.
- Dedup incoming postings via `raw_html_hash` before inserting into `job_postings`.
- Runs on a BullMQ repeatable job, once daily per user, seeded from that user's
  `preferences_json` (roles, locations, keywords).
- Respect `robots.txt` and add reasonable delays — this is a design requirement, not
  optional polish.

### 5.3 Planner Agent (the core "autonomy" feature)

This is the differentiator — implement it with care and make its reasoning inspectable.

**Input:** user's parsed resume + preferences + a batch of newly scraped job postings.

**Task:** for each posting, decide `apply` or `skip` — not just produce a numeric score.
Give the model a decision framework, not just "rate this job 1-10."

**Output schema (enforce via Claude's structured output / tool-use, not free-text parsing):**

```json
{
  "job_id": "uuid",
  "decision": "apply | skip",
  "confidence": 0.0,
  "reasoning": "2-3 sentence explanation",
  "red_flags": ["string"],
  "fit_highlights": ["string"]
}
```

**Human-in-the-loop trust boundary:** the user sets an `autonomy_threshold` in
`preferences_json`. Route in LangGraph as:

- `confidence >= threshold` and `decision == apply` → proceed automatically to Tailor Agent
- `confidence` in a middle band → mark `status = needs_review`, surface in UI, wait for
  human approval before tailoring
- `decision == skip` → log and stop this job's path

This threshold and the resulting human-override rate (tracked via
`applications.human_overridden`) is a key metric to surface on the dashboard — it's the
project's strongest talking point ("the agent has calibrated autonomy, not blind
autonomy").

### 5.4 Matcher stage

Lightweight structured extraction: gap analysis between resume and job requirements
(missing skills, over/under-qualification signals) that feeds the Tailor Agent. This can be
merged into the same LLM call as the Planner (single call, richer output schema) rather
than a separate pipeline stage — implement it as a separate LangGraph node initially for
clarity/observability, and note that merging is a valid later optimization to reduce cost
and latency.

### 5.5 Tailor Agent

Two sub-tasks:

1. **Resume tailoring** — operate on the _structured_ `parsed_sections_json`, not raw text.
   Reword/reorder/re-emphasize existing bullets to mirror the job description's language
   (helps with ATS keyword matching). **Hard constraint: never fabricate or invent
   experience, skills, or credentials that are not in the source resume.** Enforce this
   explicitly in the system prompt and treat any invented content as a bug.
2. **Cover letter generation** — use `fit_highlights` from the Planner, plus scraped
   company "About" text, plus a user-set tone preference. Always generate a _draft_ —
   never auto-submit without a review step (see §7 guardrails).

Generate the tailored resume as an actual `.docx` file (use the `docx` npm package or a
template-based approach), store it (local disk or S3-compatible storage for the MVP), and
save the URL/path to `applications.tailored_resume_url`.

### 5.6 Tracker Agent

Mostly deterministic — updates `applications.status` based on user actions and
(stretch goal) inbound email classification via Gmail API: classify email snippets as
"rejection" / "interview invite" / "other" and auto-update status. This is a good
stretch feature but not required for MVP.

---

## 6. Job Queue Design (BullMQ)

Four queues, chained per-user using BullMQ's `FlowProducer` so the pipeline is a visible
dependency graph and partial failures don't require full re-runs:

1. `scrape-queue` — per-user daily scrape jobs, rate-limited per domain
2. `plan-queue` — one job per newly scraped batch, runs the Planner Agent
3. `tailor-queue` — one job per posting marked `apply` (auto or human-approved)
4. `track-queue` — periodic status-check jobs (email polling, stretch goal)

Per-user concurrency caps on both scraping and LLM calls to keep multi-tenant load fair and
costs predictable. Track `cost_usd` per `agent_runs` row and roll up per-user cost — surface
this on the dashboard.

---

## 7. Guardrails (design in from day one — do not treat as an afterthought)

- **Never auto-submit applications on platforms whose ToS prohibits automated
  applications** (e.g., LinkedIn Easy Apply automation). For those, generate tailored
  materials and stop short of submission — require explicit manual submission by the user.
- **Auto-submit only** where (a) the ATS exposes a documented/legitimate apply endpoint
  (some Greenhouse/Lever/Ashby integrations support this) **and** (b) the user has
  explicitly enabled `auto_apply_enabled` for that confidence band.
- Respect `robots.txt` and rate limits on all scraping.
- Every agent decision must be logged to `agent_runs` — no silent/unaudited agent actions.
- Never fabricate resume content (see §5.5).

---

## 8. Frontend Requirements

- **Kanban board**: columns per `applications.status`, drag-and-drop (dnd-kit) to move
  cards; any manual status change by the user sets `human_overridden = true` and logs it.
- **Job detail panel**: show the Planner Agent's `reasoning`, `fit_highlights`, and
  `red_flags` inline — this transparency is the core feature, not a nice-to-have.
- **Settings page**: resume upload + parsed preview (let the user correct parsing errors),
  preference sliders (`autonomy_threshold`, salary floor, locations, excluded keywords,
  `auto_apply_enabled` toggle).
- **Pipeline status view**: live view of the current BullMQ flow per user (scrape → plan →
  tailor → track) — good demo value, shows the system's agentic nature visually.
- **Metrics view**: per-user cost breakdown (`agent_runs.cost_usd` rollup), human-override
  rate, applications-per-status funnel.

---

## 9. Suggested Build Order (MVP-first, in priority order)

1. **Data model + migrations** (Drizzle/Prisma) for all tables in §4.
2. **Resume upload + parsing** into `parsed_sections_json` — get this solid first since
   every downstream agent depends on structured resume data.
3. **Manual job entry + single-job Tailor Agent** — prove the LLM pipeline (Claude API call,
   structured output, docx generation) works end-to-end on one manually-entered job before
   automating discovery.
4. **Greenhouse/Lever/Ashby scraping** for 2-3 real companies — skip generic
   scraping/anti-bot fights initially.
5. **Planner Agent** with the autonomy-threshold routing logic.
6. **BullMQ queues + LangGraph orchestration**, wired end-to-end with `FlowProducer`.
7. **Kanban dashboard** + agent reasoning transparency UI.
8. **(Stretch)** Email-based auto status tracking via Gmail API.
9. **(Stretch)** Row-Level Security in Postgres for true multi-tenant isolation.

---

## 10. Environment / Setup Notes for Claude Code

- Use TypeScript across frontend and backend.
- `.env` variables needed: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`,
  (optional) `GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET` for the stretch email feature.
- Assume Postgres and Redis are available locally via Docker Compose — include a
  `docker-compose.yml` with `postgres` and `redis` services as part of initial setup.
- Start by scaffolding: `/apps/web` (React/Vite), `/apps/api` (Fastify), `/apps/worker`
  (BullMQ workers + LangGraph orchestration) as a monorepo (pnpm workspaces or Turborepo)
  so agent/queue logic is cleanly separated from the HTTP API.
- Write the Planner Agent's Claude prompt to request structured JSON output matching the
  schema in §5.3 exactly — validate the response against a schema (e.g. zod) before writing
  to `job_matches`, and retry once on validation failure.

---

## 11. What "Done" Looks Like for a Portfolio Demo

A user can: upload a resume → set preferences and an autonomy threshold → trigger a scrape
of a couple of real companies' job boards → watch the pipeline run (scrape → plan → tailor)
with live status → see planner reasoning on each candidate job → see auto-approved jobs
flow into "ready for review" with a generated tailored resume + cover letter → manually
move cards through the Kanban board → view a metrics panel showing cost per application and
human-override rate.
