export * from './resume.js';

export type JobDecision = 'apply' | 'skip' | 'needs_review';
export type ApplicationStatus =
  | 'pending'
  | 'tailoring'
  | 'ready_for_review'
  | 'applied'
  | 'interview'
  | 'rejected'
  | 'offer';
export type QueueName = 'scrape-queue' | 'plan-queue' | 'tailor-queue' | 'track-queue';

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'pending',
  'tailoring',
  'ready_for_review',
  'applied',
  'interview',
  'rejected',
  'offer',
];
