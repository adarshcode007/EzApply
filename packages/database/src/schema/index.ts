import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type UserPreferences = {
  roles?: string[];
  locations?: string[];
  keywords?: string[];
  salaryFloor?: number;
  dealbreakers?: string[];
  autonomyThreshold?: number;
  autoApplyEnabled?: boolean;
  tone?: 'formal' | 'friendly' | 'confident' | 'concise';
};

export type ParsedResumeSections = {
  summary?: string;
  skills?: string[];
  experience?: Array<{
    title?: string;
    company?: string;
    bullets?: string[];
    dates?: string;
  }>;
  education?: Array<{
    school?: string;
    degree?: string;
    dates?: string;
  }>;
  projects?: Array<{
    name?: string;
    bullets?: string[];
  }>;
  certifications?: string[];
  languages?: string[];
};

export const jobPostingSourceEnum = pgEnum('job_posting_source', [
  'greenhouse',
  'lever',
  'ashby',
  'manual',
]);

export const jobDecisionEnum = pgEnum('job_decision', ['apply', 'skip', 'needs_review']);

export const jobMatchStatusEnum = pgEnum('job_match_status', [
  'candidate',
  'rejected',
  'queued_for_tailoring',
]);

export const applicationStatusEnum = pgEnum('application_status', [
  'pending',
  'tailoring',
  'ready_for_review',
  'applied',
  'interview',
  'rejected',
  'offer',
]);

export const agentTypeEnum = pgEnum('agent_type', [
  'planner',
  'matcher',
  'tailor_resume',
  'tailor_cover_letter',
  'tracker',
]);

export const agentRunStatusEnum = pgEnum('agent_run_status', ['success', 'error']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  preferencesJson: jsonb('preferences_json')
    .$type<UserPreferences>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const resumes = pgTable('resumes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rawText: text('raw_text'),
  parsedSectionsJson: jsonb('parsed_sections_json')
    .$type<ParsedResumeSections>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const jobPostings = pgTable(
  'job_postings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    source: jobPostingSourceEnum('source').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    company: text('company').notNull(),
    description: text('description').notNull(),
    salaryRange: text('salary_range'),
    location: text('location'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    scrapedAt: timestamp('scraped_at', { withTimezone: true }).notNull().defaultNow(),
    rawHtmlHash: text('raw_html_hash').notNull(),
  },
  (table) => ({
    rawHtmlHashIdx: uniqueIndex('job_postings_raw_html_hash_idx').on(table.rawHtmlHash),
  }),
);

export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobPostingId: uuid('job_posting_id')
      .notNull()
      .references(() => jobPostings.id, { onDelete: 'cascade' }),
    matchScore: doublePrecision('match_score').notNull(),
    matchReasoning: text('match_reasoning').notNull(),
    fitHighlights: jsonb('fit_highlights').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    redFlags: jsonb('red_flags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    decision: jobDecisionEnum('decision').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    status: jobMatchStatusEnum('status').notNull().default('candidate'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userStatusIdx: index('job_matches_user_id_status_idx').on(table.userId, table.status),
    userJobUniqueIdx: uniqueIndex('job_matches_user_id_job_posting_id_idx').on(
      table.userId,
      table.jobPostingId,
    ),
  }),
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobPostingId: uuid('job_posting_id')
      .notNull()
      .references(() => jobPostings.id, { onDelete: 'cascade' }),
    tailoredResumeUrl: text('tailored_resume_url'),
    coverLetterText: text('cover_letter_text'),
    status: applicationStatusEnum('status').notNull().default('pending'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    humanOverridden: boolean('human_overridden').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userStatusIdx: index('applications_user_id_status_idx').on(table.userId, table.status),
    userJobUniqueIdx: uniqueIndex('applications_user_id_job_posting_id_idx').on(
      table.userId,
      table.jobPostingId,
    ),
  }),
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentType: agentTypeEnum('agent_type').notNull(),
    jobPostingId: uuid('job_posting_id').references(() => jobPostings.id, {
      onDelete: 'set null',
    }),
    inputJson: jsonb('input_json').notNull().default(sql`'{}'::jsonb`),
    outputJson: jsonb('output_json').notNull().default(sql`'{}'::jsonb`),
    tokensUsed: integer('tokens_used'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 4 }),
    status: agentRunStatusEnum('status').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedAtIdx: index('agent_runs_user_id_created_at_idx').on(table.userId, table.createdAt),
  }),
);

export const schema = {
  users,
  resumes,
  jobPostings,
  jobMatches,
  applications,
  agentRuns,
} as const;
