export const queueNames = {
  scrape: 'scrape-queue',
  plan: 'plan-queue',
  tailor: 'tailor-queue',
  track: 'track-queue',
} as const;

export type QueueName = (typeof queueNames)[keyof typeof queueNames];
