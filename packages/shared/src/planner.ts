import { z } from 'zod';

export const plannerDecisionSchema = z.object({
  job_id: z.string().uuid(),
  decision: z.enum(['apply', 'skip']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  red_flags: z.array(z.string()),
  fit_highlights: z.array(z.string()),
});

export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;

export const plannerRouteSchema = z.enum(['tailor', 'needs_review', 'skip']);
export type PlannerRoute = z.infer<typeof plannerRouteSchema>;
