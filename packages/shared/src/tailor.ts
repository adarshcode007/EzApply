import { z } from 'zod';
import { parsedResumeSchema } from './resume.js';

export const tailoredResumeSchema = parsedResumeSchema.extend({
  summary: z.string().optional(),
  skills: z.array(z.string()).default([]),
  experience: z
    .array(
      z.object({
        title: z.string().optional(),
        company: z.string().optional(),
        bullets: z.array(z.string()).default([]),
        dates: z.string().optional(),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().optional(),
        degree: z.string().optional(),
        dates: z.string().optional(),
      }),
    )
    .default([]),
});

export const tailorOutputSchema = z.object({
  resume: tailoredResumeSchema,
  coverLetterText: z.string().min(1),
  fitHighlights: z.array(z.string()).default([]),
  complianceNotes: z.array(z.string()).default([]),
});

export type TailoredResume = z.infer<typeof tailoredResumeSchema>;
export type TailorOutput = z.infer<typeof tailorOutputSchema>;
