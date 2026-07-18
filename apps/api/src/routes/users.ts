import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { users } from '@applypilot/database';

const preferencesSchema = z.object({
  roles: z.array(z.string()).optional(),
  locations: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  salaryFloor: z.number().optional(),
  dealbreakers: z.array(z.string()).optional(),
  autonomyThreshold: z.number().min(0).max(1).optional(),
  autoApplyEnabled: z.boolean().optional(),
  tone: z.enum(['formal', 'friendly', 'confident', 'concise']).optional(),
});

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.put('/users/:email/preferences', async (request, reply) => {
    const params = z.object({ email: z.string().email() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid email' });

    const body = preferencesSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid preferences', details: body.error.flatten() });
    }

    const existing = await db.select().from(users).where(eq(users.email, params.data.email)).limit(1);
    const currentPreferences = (existing[0]?.preferencesJson ?? {}) as Record<string, unknown>;
    const nextPreferences = { ...currentPreferences, ...body.data };

    const [user] = await db
      .insert(users)
      .values({
        email: params.data.email,
        preferencesJson: nextPreferences,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { preferencesJson: nextPreferences },
      })
      .returning();

    return reply.send({ user });
  });
};
