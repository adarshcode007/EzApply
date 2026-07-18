import { Queue, type QueueOptions } from 'bullmq';
import { queueNames } from '@applypilot/pipeline';
import { createRedisConnection } from '@applypilot/pipeline';

export const createQueues = (redisUrl: string) => {
  const connection = createRedisConnection(redisUrl);
  const options: QueueOptions = { connection };

  return {
    connection,
    scrapeQueue: new Queue(queueNames.scrape, options),
    planQueue: new Queue(queueNames.plan, options),
    tailorQueue: new Queue(queueNames.tailor, options),
    trackQueue: new Queue(queueNames.track, options),
  };
};
