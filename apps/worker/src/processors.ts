import { queueNames, type PlanJobPayload, type ScrapeJobPayload, type TailorJobPayload, type TrackJobPayload } from '@applypilot/pipeline';
import { apiJson, apiRequest } from './api-client.js';
import { createQueues } from './queue.js';

export const buildProcessors = (redisUrl: string) => {
  const queues = createQueues(redisUrl);

  const scrape = async (job: { data: ScrapeJobPayload }) => {
    const createdJobs: Array<{ jobPosting: { id: string } }> = [];

    for (const jobSpec of job.data.jobs) {
      const created = await apiRequest<{ jobPosting: { id: string } }>(`/jobs/manual`, {
        method: 'POST',
        body: apiJson(jobSpec),
      });
      createdJobs.push(created);
      await queues.planQueue.add(
        queueNames.plan,
        {
          userEmail: job.data.userEmail,
          jobPostingId: created.jobPosting.id,
        },
        {
          attempts: 2,
          removeOnComplete: true,
        },
      );
    }

    return { createdJobsCount: createdJobs.length, createdJobs };
  };

  const plan = async (job: { data: PlanJobPayload }) => {
    const result = await apiRequest<{
      threadId: string;
      state: {
        route?: 'tailor' | 'needs_review' | 'skip';
        plannerDecision?: unknown;
        tailoredResult?: unknown;
        trackResult?: unknown;
      };
    }>(`/jobs/${job.data.jobPostingId}/process`, {
      method: 'POST',
      body: apiJson({ userEmail: job.data.userEmail }),
    });

    return result;
  };

  const tailor = async (job: { data: TailorJobPayload }) => {
    const response = await apiRequest<{
      planner: unknown;
      tailored: {
        tailoredResume: unknown;
        coverLetterText: string;
      };
    }>(`/jobs/${job.data.jobPostingId}/tailor`, {
      method: 'POST',
      body: apiJson({
        userEmail: job.data.userEmail,
        plannerDecision: job.data.plannerDecision,
      }),
    });

    return response;
  };

  const track = async (job: { data: TrackJobPayload }) => {
    const applications = await apiRequest<{ rows: unknown[] }>(`/users/${encodeURIComponent(job.data.userEmail)}/applications`);
    return {
      trackedJobPostingId: job.data.jobPostingId,
      applicationCount: applications.rows.length,
    };
  };

  return { queues, scrape, plan, tailor, track };
};
