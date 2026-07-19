import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createManualJob, tailorSingleJob } from '../services/tailor.js';
import { planSingleJob } from '../services/planner.js';
import { getJobGraphState, processSingleJobGraph, resumeSingleJobGraph } from '../services/job-graph.js';
import { db } from '../lib/db.js';
import { applications, jobMatches, jobPostings, users } from '@applypilot/database';
import { plannerDecisionSchema } from '@applypilot/shared';

const manualJobSchema = z.object({
  title: z.string().min(2),
  company: z.string().min(2),
  description: z.string().min(20),
  url: z.string().url().optional(),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  postedAt: z.string().datetime().optional(),
});

const userEmailSchema = z.object({
  userEmail: z.string().email(),
});

const plannerDecisionInputSchema = plannerDecisionSchema.extend({
  job_id: z.string().uuid().optional(),
});

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.post('/jobs/manual', async (request, reply) => {
    const body = manualJobSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid job payload', details: body.error.flatten() });
    }

    const jobPosting = await createManualJob({ source: 'manual', ...body.data });
    return reply.status(201).send({ jobPosting });
  });

  app.get('/jobs', async () => {
    const rows = await db.select().from(jobPostings).orderBy(desc(jobPostings.scrapedAt)).limit(50);
    return { jobs: rows };
  });

  app.get('/jobs/:jobPostingId', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const [jobPosting] = await db
      .select()
      .from(jobPostings)
      .where(eq(jobPostings.id, params.data.jobPostingId))
      .limit(1);

    if (!jobPosting) return reply.status(404).send({ error: 'Job posting not found' });
    return { jobPosting };
  });

  app.post('/jobs/:jobPostingId/plan', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const body = userEmailSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid planner payload', details: body.error.flatten() });
    }

    try {
      const result = await planSingleJob({
        userEmail: body.data.userEmail,
        jobPostingId: params.data.jobPostingId,
      });
      return reply.send(result);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to plan job',
      });
    }
  });

  app.post('/jobs/:jobPostingId/process', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const body = userEmailSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid process payload', details: body.error.flatten() });
    }

    try {
      const result = await processSingleJobGraph({
        userEmail: body.data.userEmail,
        jobPostingId: params.data.jobPostingId,
      });
      return reply.send(result);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to process job graph',
      });
    }
  });

  app.post('/jobs/:jobPostingId/resume', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const body = userEmailSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid resume payload', details: body.error.flatten() });
    }

    try {
      const result = await resumeSingleJobGraph({
        userEmail: body.data.userEmail,
        jobPostingId: params.data.jobPostingId,
      });
      return reply.send(result);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to resume job graph',
      });
    }
  });

  app.get('/jobs/:jobPostingId/graph-state', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const query = z.object({ userEmail: z.string().email() }).safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid graph-state query', details: query.error.flatten() });
    }

    try {
      const result = await getJobGraphState({
        userEmail: query.data.userEmail,
        jobPostingId: params.data.jobPostingId,
      });
      return reply.send(result);
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to fetch job graph state',
      });
    }
  });

  app.post('/jobs/:jobPostingId/tailor', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const body = z
      .object({
        userEmail: z.string().email(),
        plannerDecision: plannerDecisionInputSchema.optional(),
      })
      .safeParse(request.body);

    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid tailor payload', details: body.error.flatten() });
    }

    try {
      const planner = body.data.plannerDecision
        ? {
            plannerDecision: plannerDecisionSchema.parse(body.data.plannerDecision),
            route: body.data.plannerDecision.decision === 'skip' ? 'skip' : 'tailor',
          }
        : await planSingleJob({
            userEmail: body.data.userEmail,
            jobPostingId: params.data.jobPostingId,
          });

      if (planner.route !== 'tailor') {
        return reply.send({ planner });
      }

      const tailored = await tailorSingleJob({
        userEmail: body.data.userEmail,
        jobPostingId: params.data.jobPostingId,
        plannerDecision: planner.plannerDecision,
      });

      return reply.send({ planner, tailored });
    } catch (error) {
      return reply.status(400).send({
        error: error instanceof Error ? error.message : 'Failed to tailor job',
      });
    }
  });

  app.get('/users/:email/applications', async (request, reply) => {
    const params = z.object({ email: z.string().email() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid email' });

    const [user] = await db.select().from(users).where(eq(users.email, params.data.email)).limit(1);
    if (!user) return reply.send({ rows: [] });

    const rows = await db
      .select({
        application: applications,
        jobPosting: jobPostings,
        jobMatch: jobMatches,
      })
      .from(applications)
      .leftJoin(jobPostings, eq(applications.jobPostingId, jobPostings.id))
      .leftJoin(
        jobMatches,
        and(eq(applications.jobPostingId, jobMatches.jobPostingId), eq(jobMatches.userId, user.id)),
      )
      .where(eq(applications.userId, user.id))
      .orderBy(desc(applications.createdAt));

    return reply.send({ rows });
  });
};
