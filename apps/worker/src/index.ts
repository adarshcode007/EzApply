import 'dotenv/config';
import { Worker, QueueEvents } from 'bullmq';
import { apiBase } from './api-client.js';
import { buildProcessors } from './processors.js';
import { queueNames, createRedisConnection } from '@applypilot/pipeline';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const processors = buildProcessors(redisUrl);

const queueList = [
  processors.queues.scrapeQueue,
  processors.queues.planQueue,
  processors.queues.tailorQueue,
  processors.queues.trackQueue,
];

const workerConnections = {
  scrape: createRedisConnection(redisUrl),
  plan: createRedisConnection(redisUrl),
  tailor: createRedisConnection(redisUrl),
  track: createRedisConnection(redisUrl),
};

const workers = [
  new Worker(queueNames.scrape, processors.scrape, { connection: workerConnections.scrape, concurrency: 2 }),
  new Worker(queueNames.plan, processors.plan, { connection: workerConnections.plan, concurrency: 3 }),
  new Worker(queueNames.tailor, processors.tailor, { connection: workerConnections.tailor, concurrency: 2 }),
  new Worker(queueNames.track, processors.track, { connection: workerConnections.track, concurrency: 2 }),
];

const queueEvents = queueList.map((queue) => {
  const connection = createRedisConnection(redisUrl);
  return {
    name: queue.name,
    connection,
    events: new QueueEvents(queue.name, {
      connection,
    }),
  };
});

for (const worker of workers) {
  worker.on('completed', (job) => {
    console.log(`[${job.queueName}] completed ${job.id}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[${job?.queueName ?? 'unknown'}] failed ${job?.id ?? 'unknown'}`, error);
  });
}

for (const { name, events } of queueEvents) {
  events.on('completed', ({ jobId }) => {
    console.log(`[${name}] job completed ${jobId}`);
  });
  events.on('failed', ({ jobId, failedReason }) => {
    console.error(`[${name}] job failed ${jobId}: ${failedReason}`);
  });
}

const shutdown = async () => {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  await Promise.allSettled(queueEvents.map(({ events, connection }) => Promise.all([events.close(), connection.quit()])));
  await Promise.allSettled(queueList.map((queue) => queue.close()));
  await Promise.allSettled([
    processors.queues.connection.quit(),
    workerConnections.scrape.quit(),
    workerConnections.plan.quit(),
    workerConnections.tailor.quit(),
    workerConnections.track.quit(),
  ]);
  console.log(`Worker shutdown complete (${apiBase})`);
};

process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

console.log('Worker orchestration started', {
  redisUrl,
  apiBase,
  queues: queueList.map((queue) => queue.name),
});
