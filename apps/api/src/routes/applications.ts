import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { agentRuns, applications } from '@applypilot/database';

const applicationStatusSchema = z.enum([
  'pending',
  'tailoring',
  'ready_for_review',
  'applied',
  'interview',
  'rejected',
  'offer',
]);

const updateStatusSchema = z.object({
  status: applicationStatusSchema,
  notes: z.string().optional(),
});

export const applicationRoutes: FastifyPluginAsync = async (app) => {
  app.patch('/applications/:applicationId/status', async (request, reply) => {
    const params = z.object({ applicationId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid applicationId' });

    const body = updateStatusSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid status payload', details: body.error.flatten() });
    }

    const [current] = await db.select().from(applications).where(eq(applications.id, params.data.applicationId)).limit(1);
    if (!current) return reply.status(404).send({ error: 'Application not found' });

    const [updated] = await db
      .update(applications)
      .set({
        status: body.data.status,
        humanOverridden: true,
        notes: body.data.notes ?? current.notes,
        appliedAt: body.data.status === 'applied' ? current.appliedAt ?? new Date() : current.appliedAt,
      })
      .where(eq(applications.id, params.data.applicationId))
      .returning();

    await db.insert(agentRuns).values({
      userId: current.userId,
      agentType: 'tracker',
      jobPostingId: current.jobPostingId,
      inputJson: {
        applicationId: current.id,
        previousStatus: current.status,
        nextStatus: body.data.status,
        notes: body.data.notes,
      },
      outputJson: {
        application: updated,
      },
      tokensUsed: 0,
      costUsd: '0.0000',
      status: 'success',
    });

    return reply.send({ application: updated });
  });
};
