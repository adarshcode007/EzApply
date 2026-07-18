import 'dotenv/config';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';
import { queueNames } from './queues.js';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const queues = Object.values(queueNames).map(
  (name) => new Queue(name, { connection }),
);

console.log('Worker scaffold ready', {
  redisUrl,
  queues: queues.map((queue) => queue.name),
});
