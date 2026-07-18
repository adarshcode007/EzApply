import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { agentRuns, jobMatches, jobPostings, resumes, users } from '@applypilot/database';
import { parsedResumeSchema, plannerDecisionSchema, type PlannerDecision, type PlannerRoute } from '@applypilot/shared';

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

const scoreJob = (resume: ReturnType<typeof parsedResumeSchema.parse>, description: string) => {
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
    .filter((keyword) => !resumeSkills.includes(keyword) && !experienceBullets.some((bullet) => bullet.includes(keyword)))
    .slice(0, 3);

  const redFlags = missingKeywords.map((keyword) => `No clear evidence for ${keyword}`);
  const rawScore = Math.min(1, matchedSkills.length * 0.22 + matchedBullets.length * 0.12 + fitHighlights.length * 0.08);
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
    redFlags,
    fitHighlights,
  };
};

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
  const scored = scoreJob(resume, jobPosting.description);
  const autonomyThreshold = Number(
    (user.preferencesJson as { autonomyThreshold?: number } | null | undefined)?.autonomyThreshold ?? 0.7,
  );
  const plannerDecision: PlannerDecision = plannerDecisionSchema.parse({
    job_id: jobPosting.id,
    decision: scored.decision,
    confidence: scored.confidence,
    reasoning: scored.reasoning,
    red_flags: scored.redFlags,
    fit_highlights: scored.fitHighlights,
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
      status: route === 'tailor' ? 'queued_for_tailoring' : route === 'needs_review' ? 'needs_review' : 'rejected',
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
        status: route === 'tailor' ? 'queued_for_tailoring' : route === 'needs_review' ? 'needs_review' : 'rejected',
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
      autonomyThreshold,
    },
    outputJson: {
      plannerDecision,
      route,
      jobMatch,
    },
    tokensUsed: 0,
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
