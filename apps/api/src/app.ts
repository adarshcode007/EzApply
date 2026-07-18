import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resumeRoutes } from './routes/resumes.js';
import { jobRoutes } from './routes/jobs.js';
import { storagePaths } from './lib/storage.js';

export const buildApp = () => {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });
  app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
    },
  });
  app.register(fastifyStatic, {
    root: storagePaths.root,
    prefix: '/files/',
  });
  app.register(resumeRoutes);
  app.register(jobRoutes);

  app.get('/health', async () => ({
    ok: true,
    service: 'api',
    timestamp: new Date().toISOString(),
  }));

  return app;
};
