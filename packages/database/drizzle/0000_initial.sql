CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
 CREATE TYPE "job_posting_source" AS ENUM ('greenhouse', 'lever', 'ashby', 'manual');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "job_decision" AS ENUM ('apply', 'skip', 'needs_review');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "job_match_status" AS ENUM ('candidate', 'rejected', 'queued_for_tailoring');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "application_status" AS ENUM ('pending', 'tailoring', 'ready_for_review', 'applied', 'interview', 'rejected', 'offer');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "agent_type" AS ENUM ('planner', 'matcher', 'tailor_resume', 'tailor_cover_letter', 'tracker');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 CREATE TYPE "agent_run_status" AS ENUM ('success', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL UNIQUE,
  "preferences_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "resumes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "raw_text" text,
  "parsed_sections_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "job_postings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" "job_posting_source" NOT NULL,
  "url" text NOT NULL,
  "title" text NOT NULL,
  "company" text NOT NULL,
  "description" text NOT NULL,
  "salary_range" text,
  "location" text,
  "posted_at" timestamptz,
  "scraped_at" timestamptz DEFAULT now() NOT NULL,
  "raw_html_hash" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_postings_raw_html_hash_idx" ON "job_postings" ("raw_html_hash");

CREATE TABLE IF NOT EXISTS "job_matches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "job_posting_id" uuid NOT NULL REFERENCES "job_postings"("id") ON DELETE cascade,
  "match_score" double precision NOT NULL,
  "match_reasoning" text NOT NULL,
  "fit_highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "red_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "decision" "job_decision" NOT NULL,
  "confidence" double precision NOT NULL,
  "status" "job_match_status" DEFAULT 'candidate' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "job_matches_user_id_status_idx" ON "job_matches" ("user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "job_matches_user_id_job_posting_id_idx" ON "job_matches" ("user_id", "job_posting_id");

CREATE TABLE IF NOT EXISTS "applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "job_posting_id" uuid NOT NULL REFERENCES "job_postings"("id") ON DELETE cascade,
  "tailored_resume_url" text,
  "cover_letter_text" text,
  "status" "application_status" DEFAULT 'pending' NOT NULL,
  "applied_at" timestamptz,
  "human_overridden" boolean DEFAULT false NOT NULL,
  "notes" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "applications_user_id_status_idx" ON "applications" ("user_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "applications_user_id_job_posting_id_idx" ON "applications" ("user_id", "job_posting_id");

CREATE TABLE IF NOT EXISTS "agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "agent_type" "agent_type" NOT NULL,
  "job_posting_id" uuid REFERENCES "job_postings"("id") ON DELETE set null,
  "input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "output_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tokens_used" integer,
  "cost_usd" numeric(12, 4),
  "status" "agent_run_status" NOT NULL,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_runs_user_id_created_at_idx" ON "agent_runs" ("user_id", "created_at");
