import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { ensureStorageDir, getPublicFileUrl } from '../lib/storage.js';
import { agentRuns, applications, jobMatches, jobPostings, resumes, users } from '@applypilot/database';
import { parsedResumeSchema } from '@applypilot/shared';

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

const buildCoverLetter = (params: {
  userEmail: string;
  company: string;
  title: string;
  fitHighlights: string[];
  summary?: string;
}) => {
  const opener = `Dear Hiring Team at ${params.company},`;
  const intro =
    `I'm excited to apply for the ${params.title} role. ` +
    (params.summary ? `My background aligns well with this position: ${params.summary}.` : 'I bring a strong track record of delivering practical, high-quality work.');
  const middle = params.fitHighlights.length
    ? `A few reasons I am a strong fit: ${params.fitHighlights.join('; ')}.`
    : `My experience suggests a strong match with the role requirements and team needs.`;
  const close = `I'd welcome the chance to discuss how I can contribute to ${params.company}. Thank you for your time and consideration.`;

  return [opener, '', intro, '', middle, '', close, '', `Sincerely,`, params.userEmail.split('@')[0]].join('\n');
};

const buildResumeDocx = async (params: {
  userEmail: string;
  jobTitle: string;
  company: string;
  resume: ReturnType<typeof parsedResumeSchema.parse>;
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
            children: [
              new TextRun({ text: `${params.jobTitle} at ${params.company}`, bold: true }),
            ],
          }),
          params.resume.summary
            ? new Paragraph({
                text: `Summary: ${params.resume.summary}`,
              })
            : new Paragraph({ text: 'Summary: Tailored from structured resume data.' }),
          new Paragraph({ text: 'Skills', heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: params.resume.skills.join(', ') || 'No skills parsed yet.' }),
          new Paragraph({ text: 'Experience', heading: HeadingLevel.HEADING_1 }),
          ...params.resume.experience.flatMap((item) => [
            new Paragraph({
              children: [
                new TextRun({ text: `${item.title ?? 'Role'}${item.company ? ` — ${item.company}` : ''}`, bold: true }),
              ],
            }),
            ...(item.bullets ?? []).slice(0, 4).map(
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
  const rawHtmlHash = createHash('sha256')
    .update(JSON.stringify({ ...input, url }))
    .digest('hex');

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

export const tailorSingleJob = async (input: { userEmail: string; jobPostingId: string }) => {
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
  const fitHighlights = extractHighlights(resume.skills, jobPosting.description);
  const relevantExperienceBullets = resume.experience.flatMap((experience) =>
    selectRelevantBullets(experience.bullets ?? [], jobPosting.description),
  );

  const scoreBase = Math.min(1, (fitHighlights.length + relevantExperienceBullets.length) / 8);
  const confidence = Number((0.55 + scoreBase * 0.4).toFixed(2));
  const matchScore = Number((scoreBase * 100).toFixed(2));
  const reasoning =
    fitHighlights.length > 0
      ? `The resume has direct overlap with the job requirements, especially ${fitHighlights.join(', ')}.`
      : 'The resume is structurally suitable, but keyword overlap with the job description is limited.';

  const [jobMatch] = await db
    .insert(jobMatches)
    .values({
      userId: user.id,
      jobPostingId: jobPosting.id,
      matchScore,
      matchReasoning: reasoning,
      fitHighlights,
      redFlags: relevantExperienceBullets.length ? [] : ['Limited direct keyword overlap in resume bullets'],
      decision: 'apply',
      confidence,
      status: 'queued_for_tailoring',
    })
    .onConflictDoUpdate({
      target: [jobMatches.userId, jobMatches.jobPostingId],
      set: {
        matchScore,
        matchReasoning: reasoning,
        fitHighlights,
        redFlags: relevantExperienceBullets.length ? [] : ['Limited direct keyword overlap in resume bullets'],
        decision: 'apply',
        confidence,
        status: 'queued_for_tailoring',
      },
    })
    .returning();

  const coverLetterText = buildCoverLetter({
    userEmail: user.email,
    company: jobPosting.company,
    title: jobPosting.title,
    fitHighlights,
    summary: resume.summary,
  });

  const docx = await buildResumeDocx({
    userEmail: user.email,
    jobTitle: jobPosting.title,
    company: jobPosting.company,
    resume,
  });

  const [application] = await db
    .insert(applications)
    .values({
      userId: user.id,
      jobPostingId: jobPosting.id,
      tailoredResumeUrl: docx.url,
      coverLetterText,
      status: 'ready_for_review',
      humanOverridden: false,
    })
    .onConflictDoUpdate({
      target: [applications.userId, applications.jobPostingId],
      set: {
        tailoredResumeUrl: docx.url,
        coverLetterText,
        status: 'ready_for_review',
        humanOverridden: false,
      },
    })
    .returning();

  await db.insert(agentRuns).values([
    {
      userId: user.id,
      agentType: 'matcher',
      jobPostingId: jobPosting.id,
      inputJson: {
        jobPosting,
        resume: resumeRow.parsedSectionsJson,
      },
      outputJson: {
        jobMatch,
      },
      tokensUsed: 0,
      costUsd: '0.0000',
      status: 'success',
    },
    {
      userId: user.id,
      agentType: 'tailor_resume',
      jobPostingId: jobPosting.id,
      inputJson: {
        resume: resumeRow.parsedSectionsJson,
        jobDescription: jobPosting.description,
      },
      outputJson: {
        tailoredResumeUrl: docx.url,
        relevantExperienceBullets,
      },
      tokensUsed: 0,
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
        coverLetterText,
      },
      tokensUsed: 0,
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
    },
    coverLetterText,
    fitHighlights,
    relevantExperienceBullets,
  };
};
