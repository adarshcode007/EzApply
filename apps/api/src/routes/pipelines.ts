import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { enqueueScrapeRun, pipelineRunRequestSchema } from '@applypilot/pipeline';

export const pipelineRoutes: FastifyPluginAsync = async (app) => {
  app.post('/pipelines/run', async (request, reply) => {
    const body = pipelineRunRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid pipeline payload', details: body.error.flatten() });
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      return reply.status(500).send({ error: 'REDIS_URL is required' });
    }

    const run = await enqueueScrapeRun({ redisUrl, payload: body.data });
    return reply.status(202).send({ enqueued: true, flow: run });
  });

  app.get('/pipelines/validate', async (request, reply) => {
    const body = z.object({ userEmail: z.string().email() }).safeParse(request.query);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid query' });
    }
    return reply.send({ ok: true, userEmail: body.data.userEmail });
  });
};
