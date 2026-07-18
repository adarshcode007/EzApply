import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createManualJob, tailorSingleJob } from '../services/tailor.js';
import { db } from '../lib/db.js';
import { applications, jobMatches, jobPostings, users } from '@applypilot/database';
import { and, desc, eq } from 'drizzle-orm';

const manualJobSchema = z.object({
  title: z.string().min(2),
  company: z.string().min(2),
  description: z.string().min(20),
  url: z.string().url().optional(),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  postedAt: z.string().datetime().optional(),
});

const tailorSchema = z.object({
  userEmail: z.string().email(),
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

  app.post('/jobs/:jobPostingId/tailor', async (request, reply) => {
    const params = z.object({ jobPostingId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid jobPostingId' });

    const body = tailorSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid tailor payload', details: body.error.flatten() });
    }

    try {
      const result = await tailorSingleJob({
        userEmail: body.data.userEmail,
        jobPostingId: params.data.jobPostingId,
      });
      return reply.send(result);
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
