import type { FastifyPluginAsync } from 'fastify';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { parseResumeText, parsedResumeSchema } from '@applypilot/shared';
import { resumes, users } from '@applypilot/database';
import { eq, desc } from 'drizzle-orm';

const formFieldSchema = z.object({
  email: z.string().email(),
  rawText: z.string().optional(),
});

const updateParsedSectionsSchema = z.object({
  parsedSectionsJson: parsedResumeSchema,
});

const fileToText = async (buffer: Buffer, filename = '', mimetype = '') => {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimetype.toLowerCase();

  if (lowerName.endsWith('.docx') || lowerMime.includes('wordprocessingml')) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (lowerName.endsWith('.pdf') || lowerMime.includes('pdf')) {
    const result = await pdfParse(buffer);
    return result.text;
  }

  return buffer.toString('utf8');
};

export const resumeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/resumes/upload', async (request, reply) => {
    const fields: Record<string, string> = {};
    let uploadedFile: { buffer: Buffer; filename: string; mimetype: string } | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        uploadedFile = {
          buffer,
          filename: part.filename,
          mimetype: part.mimetype,
        };
      } else {
        fields[part.fieldname] = String(part.value ?? '');
      }
    }

    const parsedFields = formFieldSchema.safeParse(fields);
    if (!parsedFields.success) {
      return reply.status(400).send({ error: 'Invalid form fields', details: parsedFields.error.flatten() });
    }

    const rawTextFromFile = uploadedFile
      ? await fileToText(uploadedFile.buffer, uploadedFile.filename, uploadedFile.mimetype)
      : undefined;

    const rawText = parsedFields.data.rawText ?? rawTextFromFile;
    if (!rawText) {
      return reply.status(400).send({ error: 'Provide a resume file or rawText field' });
    }

    const parsedSections = parseResumeText(rawText);

    const [user] = await db
      .insert(users)
      .values({
        email: parsedFields.data.email,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { email: parsedFields.data.email },
      })
      .returning();

    if (!user) {
      return reply.status(500).send({ error: 'Failed to create or fetch user' });
    }

    const [lastResume] = await db
      .select({ version: resumes.version })
      .from(resumes)
      .where(eq(resumes.userId, user.id))
      .orderBy(desc(resumes.version))
      .limit(1);

    const nextVersion = (lastResume?.version ?? 0) + 1;

    const [resume] = await db
      .insert(resumes)
      .values({
        userId: user.id,
        rawText,
        parsedSectionsJson: parsedSections,
        version: nextVersion,
      })
      .returning();

    return reply.send({
      user,
      resume,
      parsedSections,
    });
  });

  app.get('/resumes/:resumeId', async (request, reply) => {
    const params = z.object({ resumeId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid resumeId' });

    const [resume] = await db
      .select()
      .from(resumes)
      .where(eq(resumes.id, params.data.resumeId))
      .limit(1);

    if (!resume) return reply.status(404).send({ error: 'Resume not found' });
    return reply.send({ resume });
  });

  app.put('/resumes/:resumeId/parsed-sections', async (request, reply) => {
    const params = z.object({ resumeId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'Invalid resumeId' });

    const body = updateParsedSectionsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid parsedSectionsJson', details: body.error.flatten() });
    }

    const [updated] = await db
      .update(resumes)
      .set({ parsedSectionsJson: body.data.parsedSectionsJson })
      .where(eq(resumes.id, params.data.resumeId))
      .returning();

    if (!updated) return reply.status(404).send({ error: 'Resume not found' });
    return reply.send({ resume: updated });
  });
};
