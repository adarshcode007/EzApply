import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { ensureStorageDir, getPublicFileUrl } from '../lib/storage.js';
import { agentRuns, applications, jobMatches, jobPostings, resumes, users } from '@applypilot/database';
import {
  parsedResumeSchema,
  tailorOutputSchema,
  type PlannerDecision,
  type TailoredResume,
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
]);

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
const normalize = (value: string) => compact(value.toLowerCase());

const keywordSet = (text: string) => {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? [];
  return new Set(matches.map((word) => word.trim()).filter((word) => !stopWords.has(word)));
};

const extractHighlights = (resumeSkills: string[], jobDescription: string) => {
  const jobKeywords = keywordSet(jobDescription);
  const skillMatches = resumeSkills.filter((skill) => jobKeywords.has(normalize(skill)));
  return [...new Set(skillMatches)].slice(0, 6);
};

const selectRelevantBullets = (bullets: string[], jobDescription: string) => {
  const keywords = Array.from(keywordSet(jobDescription));
  const scored = bullets
    .map((bullet) => {
      const normalizedBullet = normalize(bullet);
      const score = keywords.reduce(
        (acc, keyword) => acc + (normalizedBullet.includes(keyword) ? 1 : 0),
        0,
      );
      return { bullet, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((item) => item.bullet);
};

const mergeTailoredResume = (
  original: ReturnType<typeof parsedResumeSchema.parse>,
  tailored: TailoredResume,
): TailoredResume => ({
  summary: tailored.summary ?? original.summary,
  skills: tailored.skills.length ? tailored.skills : original.skills,
  experience: tailored.experience.length ? tailored.experience : original.experience,
  education: tailored.education.length ? tailored.education : original.education,
  projects: tailored.projects.length ? tailored.projects : original.projects,
  certifications: tailored.certifications.length ? tailored.certifications : original.certifications,
  languages: tailored.languages.length ? tailored.languages : original.languages,
});

const buildFallbackCoverLetter = (params: {
  userEmail: string;
  company: string;
  title: string;
  fitHighlights: string[];
  summary?: string;
}) => {
  const opener = `Dear Hiring Team at ${params.company},`;
  const intro =
    `I'm excited to apply for the ${params.title} role. ` +
    (params.summary
      ? `My background aligns well with this position: ${params.summary}.`
      : 'I bring a strong track record of delivering practical, high-quality work.');
  const middle = params.fitHighlights.length
    ? `A few reasons I am a strong fit: ${params.fitHighlights.join('; ')}.`
    : `My experience suggests a strong match with the role requirements and team needs.`;
  const close = `I'd welcome the chance to discuss how I can contribute to ${params.company}. Thank you for your time and consideration.`;

  return [opener, '', intro, '', middle, '', close, '', `Sincerely,`, params.userEmail.split('@')[0]].join(
    '\n',
  );
};

const buildResumeDocx = async (params: {
  userEmail: string;
  jobTitle: string;
  company: string;
  resume: TailoredResume;
}) => {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: `${params.userEmail} | Tailored Resume`,
            heading: HeadingLevel.TITLE,
          }),
          new Paragraph({
            children: [new TextRun({ text: `${params.jobTitle} at ${params.company}`, bold: true })],
          }),
          params.resume.summary
            ? new Paragraph({ text: `Summary: ${params.resume.summary}` })
            : new Paragraph({ text: 'Summary: Tailored from structured resume data.' }),
          new Paragraph({ text: 'Skills', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: params.resume.skills.join(', ') || 'No skills parsed yet.' }),
          new Paragraph({ text: 'Experience', heading: HeadingLevel.HEADING_1 }),
          ...params.resume.experience.flatMap((item) => [
            new Paragraph({
              children: [
                new TextRun({
                  text: `${item.title ?? 'Role'}${item.company ? ` — ${item.company}` : ''}`,
                  bold: true,
                }),
              ],
            }),
            ...(item.bullets ?? []).slice(0, 5).map(
              (bullet) =>
                new Paragraph({
                  text: bullet,
                  bullet: { level: 0 },
                }),
            ),
          ]),
          new Paragraph({ text: 'Education', heading: HeadingLevel.HEADING_1 }),
          ...params.resume.education.map(
            (item) =>
              new Paragraph({
                text: `${item.school ?? 'School'}${item.degree ? ` — ${item.degree}` : ''}${item.dates ? ` (${item.dates})` : ''}`,
              }),
          ),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const safeName = `${params.jobTitle}-${params.company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const fileName = `${safeName || 'tailored-resume'}-${Date.now()}.docx`;
  const relativePath = join('tailored-resumes', fileName);
  const fullPath = ensureStorageDir(relativePath);
  await writeFile(fullPath, buffer);

  return {
    fileName,
    relativePath,
    url: getPublicFileUrl(relativePath),
  };
};

const buildTailorSystem = () =>
  [
    'You are ApplyPilot’s tailoring agent.',
    'You may only use facts already present in the source resume.',
    'Do not invent experience, skills, credentials, education, dates, or achievements.',
    'Optimize phrasing and emphasis for ATS alignment while preserving truthfulness.',
    'Return structured data only.',
  ].join(' ');

const buildTailorPrompt = (input: {
  userEmail: string;
  plannerDecision: PlannerDecision;
  resume: unknown;
  jobPosting: unknown;
  tone?: unknown;
}) =>
  [
    'Tailor the resume and cover letter for this job posting.',
    'Reword and reorder only within the boundaries of the source resume facts.',
    'If something is missing from the resume, do not add it.',
    'Create a concise, professional cover letter draft.',
    '',
    `User email: ${input.userEmail}`,
    `Preferred tone: ${JSON.stringify(input.tone)}`,
    `Planner decision JSON: ${JSON.stringify(input.plannerDecision, null, 2)}`,
    `Parsed resume JSON: ${JSON.stringify(input.resume, null, 2)}`,
    `Job posting JSON: ${JSON.stringify(input.jobPosting, null, 2)}`,
  ].join('\n');

export const createManualJob = async (input: {
  source?: 'manual';
  title: string;
  company: string;
  description: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  postedAt?: string;
}) => {
  const url = input.url?.trim() || `manual://${encodeURIComponent(input.company)}/${encodeURIComponent(input.title)}`;
  const rawHtmlHash = createHash('sha256').update(JSON.stringify({ ...input, url })).digest('hex');

  const [jobPosting] = await db
    .insert(jobPostings)
    .values({
      source: 'manual',
      url,
      title: input.title,
      company: input.company,
      description: input.description,
      salaryRange: input.salaryRange,
      location: input.location,
      postedAt: input.postedAt ? new Date(input.postedAt) : null,
      rawHtmlHash,
    })
    .onConflictDoNothing()
    .returning();

  if (jobPosting) return jobPosting;

  const [existing] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.rawHtmlHash, rawHtmlHash))
    .limit(1);

  if (!existing) throw new Error('Failed to create or fetch manual job posting');
  return existing;
};

export const tailorSingleJob = async (input: {
  userEmail: string;
  jobPostingId: string;
  plannerDecision?: PlannerDecision;
}) => {
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

  const sourceResume = parsedResumeSchema.parse(resumeRow.parsedSectionsJson);
  const fallbackFitHighlights = extractHighlights(sourceResume.skills, jobPosting.description);
  const relevantExperienceBullets = sourceResume.experience.flatMap((experience) =>
    selectRelevantBullets(experience.bullets ?? [], jobPosting.description),
  );

  const fallbackPlannerDecision: PlannerDecision = input.plannerDecision ?? {
    job_id: jobPosting.id,
    decision: fallbackFitHighlights.length > 0 ? 'apply' : 'skip',
    confidence: Number((0.55 + Math.min(1, (fallbackFitHighlights.length + relevantExperienceBullets.length) / 8) * 0.4).toFixed(2)),
    reasoning:
      fallbackFitHighlights.length > 0
        ? `The resume has direct overlap with the job requirements, especially ${fallbackFitHighlights.join(', ')}.`
        : 'The resume is structurally suitable, but keyword overlap with the job description is limited.',
    red_flags: relevantExperienceBullets.length ? [] : ['Limited direct keyword overlap in resume bullets'],
    fit_highlights: fallbackFitHighlights,
  };

  const llmOutput = hasOpenAI
    ? await generateStructuredObject({
        schemaName: 'tailor_output',
        schema: tailorOutputSchema,
        system: buildTailorSystem(),
        prompt: buildTailorPrompt({
          userEmail: user.email,
          plannerDecision: fallbackPlannerDecision,
          resume: sourceResume,
          jobPosting,
          tone: (user.preferencesJson as { tone?: string } | null | undefined)?.tone,
        }),
        temperature: 0.2,
        maxTokens: 1600,
        retries: 1,
      })
    : {
        data: tailorOutputSchema.parse({
          resume: {
            ...sourceResume,
            summary: sourceResume.summary,
            skills: sourceResume.skills,
            experience: sourceResume.experience.map((item) => ({
              ...item,
              bullets: item.bullets?.length ? item.bullets : relevantExperienceBullets,
            })),
          },
          coverLetterText: buildFallbackCoverLetter({
            userEmail: user.email,
            company: jobPosting.company,
            title: jobPosting.title,
            fitHighlights: fallbackPlannerDecision.fit_highlights,
            summary: sourceResume.summary,
          }),
          fitHighlights: fallbackPlannerDecision.fit_highlights,
          complianceNotes: ['Heuristic fallback used because OPENAI_API_KEY is missing.'],
        }),
        tokensUsed: 0,
        model: 'heuristic-fallback',
      };

  const tailoredResume = mergeTailoredResume(sourceResume, llmOutput.data.resume);
  const fitHighlights = llmOutput.data.fitHighlights.length
    ? llmOutput.data.fitHighlights
    : fallbackPlannerDecision.fit_highlights;
  const redFlags = fallbackPlannerDecision.red_flags;
  const plannerConfidence = fallbackPlannerDecision.confidence;

  const [jobMatch] = await db
    .insert(jobMatches)
    .values({
      userId: user.id,
      jobPostingId: jobPosting.id,
      matchScore: Math.round(plannerConfidence * 10000) / 100,
      matchReasoning: fallbackPlannerDecision.reasoning,
      fitHighlights,
      redFlags,
      decision: fallbackPlannerDecision.decision,
      confidence: plannerConfidence,
      status: 'queued_for_tailoring',
    })
    .onConflictDoUpdate({
      target: [jobMatches.userId, jobMatches.jobPostingId],
      set: {
        matchScore: Math.round(plannerConfidence * 10000) / 100,
        matchReasoning: fallbackPlannerDecision.reasoning,
        fitHighlights,
        redFlags,
        decision: fallbackPlannerDecision.decision,
        confidence: plannerConfidence,
        status: 'queued_for_tailoring',
      },
    })
    .returning();

  const docx = await buildResumeDocx({
    userEmail: user.email,
    jobTitle: jobPosting.title,
    company: jobPosting.company,
    resume: tailoredResume,
  });

  const [application] = await db
    .insert(applications)
    .values({
      userId: user.id,
      jobPostingId: jobPosting.id,
      tailoredResumeUrl: docx.url,
      coverLetterText: llmOutput.data.coverLetterText,
      status: 'ready_for_review',
      humanOverridden: false,
    })
    .onConflictDoUpdate({
      target: [applications.userId, applications.jobPostingId],
      set: {
        tailoredResumeUrl: docx.url,
        coverLetterText: llmOutput.data.coverLetterText,
        status: 'ready_for_review',
        humanOverridden: false,
      },
    })
    .returning();

  await db.insert(agentRuns).values([
    {
      userId: user.id,
      agentType: 'tailor_resume',
      jobPostingId: jobPosting.id,
      inputJson: {
        resume: resumeRow.parsedSectionsJson,
        jobDescription: jobPosting.description,
        plannerDecision: fallbackPlannerDecision,
      },
      outputJson: {
        tailoredResume,
        tailoredResumeUrl: docx.url,
        complianceNotes: llmOutput.data.complianceNotes,
        model: llmOutput.model,
      },
      tokensUsed: llmOutput.tokensUsed,
      costUsd: '0.0000',
      status: 'success',
    },
    {
      userId: user.id,
      agentType: 'tailor_cover_letter',
      jobPostingId: jobPosting.id,
      inputJson: {
        fitHighlights,
        company: jobPosting.company,
      },
      outputJson: {
        coverLetterText: llmOutput.data.coverLetterText,
      },
      tokensUsed: llmOutput.tokensUsed,
      costUsd: '0.0000',
      status: 'success',
    },
  ]);

  return {
    user,
    jobPosting,
    jobMatch,
    application,
    tailoredResume: {
      ...docx,
      fileName: basename(docx.fileName),
      parsedSections: tailoredResume,
    },
    coverLetterText: llmOutput.data.coverLetterText,
    fitHighlights,
    relevantExperienceBullets,
    complianceNotes: llmOutput.data.complianceNotes,
  };
};
