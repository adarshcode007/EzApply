import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { agentRuns, jobMatches, jobPostings, resumes, users } from '@applypilot/database';
import {
  parsedResumeSchema,
  plannerDecisionSchema,
  type PlannerDecision,
  type PlannerRoute,
} from '@applypilot/shared';
import { generateStructuredObject, hasOpenAI } from './openai.js';

const stopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'you',
  'your',
  'will',
  'are',
  'have',
  'has',
  'our',
  'was',
  'were',
  'their',
  'they',
  'them',
  'job',
  'role',
  'work',
  'team',
  'teams',
  'skills',
  'experience',
  'about',
  'company',
  'product',
]);

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const normalize = (value: string) => compact(value.toLowerCase());
const keywordSet = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .match(/[a-z][a-z0-9+#.-]{2,}/g)
      ?.map((word) => word.trim())
      .filter((word) => !stopWords.has(word)) ?? [],
  );

const heuristicPlanner = (resume: ReturnType<typeof parsedResumeSchema.parse>, description: string) => {
  const jobKeywords = keywordSet(description);
  const resumeSkills = resume.skills.map(normalize);
  const experienceBullets = resume.experience.flatMap((exp) => exp.bullets ?? []).map(normalize);

  const matchedSkills = resume.skills.filter((skill) => jobKeywords.has(normalize(skill)));
  const matchedBullets = resume.experience
    .flatMap((exp) => exp.bullets ?? [])
    .filter((bullet) => {
      const normalizedBullet = normalize(bullet);
      return Array.from(jobKeywords).some((keyword) => normalizedBullet.includes(keyword));
    });

  const fitHighlights = [
    ...(matchedSkills.length ? [`Matched skills: ${[...new Set(matchedSkills)].slice(0, 4).join(', ')}`] : []),
    ...(matchedBullets.length ? [`Relevant experience: ${matchedBullets[0]}`] : []),
  ];

  const missingKeywords = Array.from(jobKeywords)
    .filter(
      (keyword) =>
        !resumeSkills.includes(keyword) && !experienceBullets.some((bullet) => bullet.includes(keyword)),
    )
    .slice(0, 3);

  const redFlags = missingKeywords.map((keyword) => `No clear evidence for ${keyword}`);
  const rawScore = Math.min(
    1,
    matchedSkills.length * 0.22 + matchedBullets.length * 0.12 + fitHighlights.length * 0.08,
  );
  const confidence = Number(Math.min(0.99, Math.max(0.08, rawScore + 0.18)).toFixed(2));
  const decision = matchedSkills.length >= 1 || matchedBullets.length >= 2 ? 'apply' : 'skip';
  const reasoning =
    decision === 'apply'
      ? `The parsed resume shows direct overlap with the posting, especially ${fitHighlights.join('; ')}.`
      : `The parsed resume does not show enough direct overlap with the job description to recommend applying automatically.`;

  return {
    decision,
    confidence,
    reasoning,
    red_flags: redFlags,
    fit_highlights: fitHighlights,
    tokensUsed: 0,
  };
};

const buildPlannerPrompt = (input: {
  userEmail: string;
  preferences: unknown;
  resume: unknown;
  jobPosting: unknown;
}) => {
  return [
    'Evaluate whether this user should apply to the job posting.',
    'You must decide apply or skip.',
    'Confidence must be between 0 and 1.',
    'Reasoning must be concise and based only on the provided resume and job posting.',
    'Red flags should be real concerns or missing evidence from the resume.',
    'Fit highlights should be concrete strengths from the resume that align with the role.',
    'Do not invent facts that are not present in the resume.',
    '',
    `User email: ${input.userEmail}`,
    `Preferences JSON: ${JSON.stringify(input.preferences, null, 2)}`,
    `Parsed resume JSON: ${JSON.stringify(input.resume, null, 2)}`,
    `Job posting JSON: ${JSON.stringify(input.jobPosting, null, 2)}`,
  ].join('\n');
};

const buildPlannerSystem = () =>
  [
    'You are ApplyPilot’s planner agent.',
    'Return structured data only.',
    'Choose apply only when the resume shows credible alignment with the role.',
    'Choose skip when alignment is weak, risky, or not supported by the resume.',
    'Be conservative and honest.',
  ].join(' ');

export const planSingleJob = async (input: { userEmail: string; jobPostingId: string }) => {
  const [user] = await db.select().from(users).where(eq(users.email, input.userEmail)).limit(1);
  if (!user) throw new Error('User not found. Upload a resume first.');

  const [jobPosting] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, input.jobPostingId))
    .limit(1);
  if (!jobPosting) throw new Error('Job posting not found');

  const [resumeRow] = await db
    .select()
    .from(resumes)
    .where(eq(resumes.userId, user.id))
    .orderBy(desc(resumes.version))
    .limit(1);
  if (!resumeRow) throw new Error('No resume found for this user');

  const resume = parsedResumeSchema.parse(resumeRow.parsedSectionsJson);
  const autonomyThreshold = Number(
    (user.preferencesJson as { autonomyThreshold?: number } | null | undefined)?.autonomyThreshold ?? 0.7,
  );

  const llmOutput = hasOpenAI
    ? await generateStructuredObject({
        schemaName: 'planner_decision',
        schema: plannerDecisionSchema,
        system: buildPlannerSystem(),
        prompt: buildPlannerPrompt({
          userEmail: user.email,
          preferences: user.preferencesJson,
          resume,
          jobPosting,
        }),
        temperature: 0.1,
        maxTokens: 900,
        retries: 1,
      })
    : {
        data: plannerDecisionSchema.parse({
          job_id: jobPosting.id,
          ...heuristicPlanner(resume, jobPosting.description),
        }),
        tokensUsed: 0,
        model: 'heuristic-fallback',
      };

  const plannerDecision: PlannerDecision = plannerDecisionSchema.parse({
    ...llmOutput.data,
    job_id: jobPosting.id,
  });

  const route: PlannerRoute =
    plannerDecision.decision === 'skip'
      ? 'skip'
      : plannerDecision.confidence >= autonomyThreshold
        ? 'tailor'
        : 'needs_review';

  const [jobMatch] = await db
    .insert(jobMatches)
    .values({
      userId: user.id,
      jobPostingId: jobPosting.id,
      matchScore: Math.round(plannerDecision.confidence * 10000) / 100,
      matchReasoning: plannerDecision.reasoning,
      fitHighlights: plannerDecision.fit_highlights,
      redFlags: plannerDecision.red_flags,
      decision: plannerDecision.decision,
      confidence: plannerDecision.confidence,
      status:
        route === 'tailor' ? 'queued_for_tailoring' : route === 'needs_review' ? 'needs_review' : 'rejected',
    })
    .onConflictDoUpdate({
      target: [jobMatches.userId, jobMatches.jobPostingId],
      set: {
        matchScore: Math.round(plannerDecision.confidence * 10000) / 100,
        matchReasoning: plannerDecision.reasoning,
        fitHighlights: plannerDecision.fit_highlights,
        redFlags: plannerDecision.red_flags,
        decision: plannerDecision.decision,
        confidence: plannerDecision.confidence,
        status:
          route === 'tailor'
            ? 'queued_for_tailoring'
            : route === 'needs_review'
              ? 'needs_review'
              : 'rejected',
      },
    })
    .returning();

  await db.insert(agentRuns).values({
    userId: user.id,
    agentType: 'planner',
    jobPostingId: jobPosting.id,
    inputJson: {
      userEmail: user.email,
      resume: resumeRow.parsedSectionsJson,
      jobPosting,
      preferences: user.preferencesJson,
      autonomyThreshold,
    },
    outputJson: {
      plannerDecision,
      route,
      jobMatch,
      model: llmOutput.model,
    },
    tokensUsed: llmOutput.tokensUsed,
    costUsd: '0.0000',
    status: 'success',
  });

  return {
    user,
    jobPosting,
    resume,
    autonomyThreshold,
    plannerDecision,
    route,
    jobMatch,
  };
};
