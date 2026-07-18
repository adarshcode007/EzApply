import { FlowProducer } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import { plannerDecisionSchema } from '@applypilot/shared';

export const queueNames = {
  scrape: 'scrape-queue',
  plan: 'plan-queue',
  tailor: 'tailor-queue',
  track: 'track-queue',
} as const;

export const manualJobSchema = z.object({
  title: z.string().min(2),
  company: z.string().min(2),
  description: z.string().min(20),
  url: z.string().url().optional(),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  postedAt: z.string().datetime().optional(),
});

export const pipelineRunRequestSchema = z.object({
  userEmail: z.string().email(),
  jobs: z.array(manualJobSchema).min(1),
});

export const scrapeJobPayloadSchema = pipelineRunRequestSchema;
export const planJobPayloadSchema = z.object({
  userEmail: z.string().email(),
  jobPostingId: z.string().uuid(),
});
export const tailorJobPayloadSchema = z.object({
  userEmail: z.string().email(),
  jobPostingId: z.string().uuid(),
  plannerDecision: plannerDecisionSchema.optional(),
});
export const trackJobPayloadSchema = z.object({
  userEmail: z.string().email(),
  jobPostingId: z.string().uuid(),
});

export type ManualJobInput = z.infer<typeof manualJobSchema>;
export type PipelineRunRequest = z.infer<typeof pipelineRunRequestSchema>;
export type ScrapeJobPayload = z.infer<typeof scrapeJobPayloadSchema>;
export type PlanJobPayload = z.infer<typeof planJobPayloadSchema>;
export type TailorJobPayload = z.infer<typeof tailorJobPayloadSchema>;
export type TrackJobPayload = z.infer<typeof trackJobPayloadSchema>;

export const createRedisConnection = (redisUrl: string) =>
  new IORedis(redisUrl, { maxRetriesPerRequest: null });

export const createFlowProducer = (redisUrl: string) => {
  const connection = createRedisConnection(redisUrl);
  return new FlowProducer({ connection });
};

export const enqueueScrapeRun = async (input: { redisUrl: string; payload: ScrapeJobPayload }) => {
  const connection = createRedisConnection(input.redisUrl);
  const flow = new FlowProducer({ connection });
  try {
    const root = await flow.add({
      name: queueNames.scrape,
      queueName: queueNames.scrape,
      data: input.payload,
      opts: {
        attempts: 2,
        removeOnComplete: true,
      },
    });

    return {
      rootJobId: root.job.id,
      queueName: root.job.queueName,
    };
  } finally {
    await flow.close();
    await connection.quit();
  }
};
