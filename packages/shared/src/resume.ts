import { z } from 'zod';

export const resumeExperienceSchema = z.object({
  title: z.string().optional(),
  company: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  dates: z.string().optional(),
});

export const resumeEducationSchema = z.object({
  school: z.string().optional(),
  degree: z.string().optional(),
  dates: z.string().optional(),
});

export const resumeProjectSchema = z.object({
  name: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});

export const parsedResumeSchema = z.object({
  summary: z.string().optional(),
  skills: z.array(z.string()).default([]),
  experience: z.array(resumeExperienceSchema).default([]),
  education: z.array(resumeEducationSchema).default([]),
  projects: z.array(resumeProjectSchema).default([]),
  certifications: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
});

export type ParsedResumeSections = z.infer<typeof parsedResumeSchema>;

const headingMatchers: Array<{ section: keyof ParsedResumeSections; pattern: RegExp }> = [
  { section: 'summary', pattern: /^(summary|professional summary|profile|about me)\b[:\-\s]*$/i },
  { section: 'skills', pattern: /^(skills|core competencies|technical skills|technologies)\b[:\-\s]*$/i },
  { section: 'experience', pattern: /^(experience|work experience|professional experience|employment history)\b[:\-\s]*$/i },
  { section: 'education', pattern: /^(education|academic background)\b[:\-\s]*$/i },
  { section: 'projects', pattern: /^(projects|selected projects)\b[:\-\s]*$/i },
  { section: 'certifications', pattern: /^(certifications|licenses)\b[:\-\s]*$/i },
  { section: 'languages', pattern: /^(languages)\b[:\-\s]*$/i },
];

const bulletTrim = (value: string) => value.replace(/^[\s>*•\-–—]+/, '').trim();
const compact = (value: string) => value.replace(/\s+/g, ' ').trim();

const splitItems = (line: string) =>
  line
    .split(/[,;|]/g)
    .map((part) => compact(bulletTrim(part)))
    .filter(Boolean);

const isHeading = (line: string) =>
  headingMatchers.some(({ pattern }) => pattern.test(line.trim()));

const detectSection = (line: string): keyof ParsedResumeSections | undefined => {
  const match = headingMatchers.find(({ pattern }) => pattern.test(line.trim()));
  return match?.section;
};

const splitBlocks = (lines: string[]) => {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }

    current.push(line);
  }

  if (current.length) blocks.push(current);
  return blocks;
};

const parseExperienceBlock = (block: string[]) => {
  const [header = '', ...rest] = block.map(compact).filter(Boolean);
  const cleanedHeader = compact(header);

  const datesMatch = cleanedHeader.match(/(?<dates>(19|20)\d{2}\s*[-–—]\s*(present|(19|20)\d{2}))|\((?<paren>[^)]+)\)$/i);
  const dates = datesMatch?.groups?.dates ?? datesMatch?.groups?.paren;

  const headerWithoutDates = dates
    ? compact(cleanedHeader.replace(datesMatch?.[0] ?? '', ''))
    : cleanedHeader;

  let title: string | undefined;
  let company: string | undefined;

  const atSplit = headerWithoutDates.split(/\s+at\s+/i);
  if (atSplit.length === 2) {
    [title, company] = atSplit.map(compact);
  } else if (headerWithoutDates.includes(' | ')) {
    const [left, right] = headerWithoutDates.split(' | ').map(compact);
    title = left;
    company = right;
  } else if (headerWithoutDates.includes(' - ')) {
    const [left, right] = headerWithoutDates.split(' - ').map(compact);
    title = left;
    company = right;
  } else {
    title = headerWithoutDates || undefined;
  }

  const bullets = rest.flatMap((line) =>
    line
      .split(/(?<=\.)\s+(?=[A-Z])/g)
      .map((part) => compact(bulletTrim(part)))
      .filter(Boolean),
  );

  return { title, company, dates, bullets };
};

const parseEducationBlock = (block: string[]) => {
  const [header = '', ...rest] = block.map(compact).filter(Boolean);
  const datesMatch = header.match(/(?<dates>(19|20)\d{2}\s*[-–—]\s*(present|(19|20)\d{2}))|\((?<paren>[^)]+)\)$/i);
  const dates = datesMatch?.groups?.dates ?? datesMatch?.groups?.paren;
  const headerWithoutDates = dates
    ? compact(header.replace(datesMatch?.[0] ?? '', ''))
    : header;

  let school: string | undefined;
  let degree: string | undefined;

  const separators = [' | ', ' - ', ','];
  for (const separator of separators) {
    if (headerWithoutDates.includes(separator)) {
      const [left, right] = headerWithoutDates.split(separator).map(compact);
      school = left;
      degree = right;
      break;
    }
  }

  if (!school) school = headerWithoutDates || undefined;

  const bullets = rest.filter(Boolean).map((item) => compact(bulletTrim(item)));
  return { school, degree, dates, bullets };
};

const extractItems = (text: string) =>
  splitItems(text)
    .map((item) => compact(item.replace(/^\d+[.)]\s*/, '')))
    .filter(Boolean);

export const parseResumeText = (input: string): ParsedResumeSections => {
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').map((line) => line.trimEnd());

  const sections: ParsedResumeSections = {
    skills: [],
    experience: [],
    education: [],
    projects: [],
    certifications: [],
    languages: [],
  };

  let currentSection: keyof ParsedResumeSections | undefined;
  const sectionLines: Partial<Record<keyof ParsedResumeSections, string[]>> = {};

  for (const line of lines) {
    if (isHeading(line)) {
      currentSection = detectSection(line);
      if (currentSection && !sectionLines[currentSection]) {
        sectionLines[currentSection] = [];
      }
      continue;
    }

    if (currentSection) {
      (sectionLines[currentSection] ??= []).push(line);
    }
  }

  const summaryLines = sectionLines.summary?.map(compact).filter(Boolean) ?? [];
  if (summaryLines.length) {
    sections.summary = summaryLines.join(' ');
  }

  const skillLines = sectionLines.skills ?? [];
  sections.skills = Array.from(
    new Set(skillLines.flatMap((line) => extractItems(line)).filter(Boolean)),
  );

  const expBlocks = splitBlocks(sectionLines.experience ?? []);
  sections.experience = expBlocks.map(parseExperienceBlock).map((entry) => ({
    title: entry.title,
    company: entry.company,
    dates: entry.dates,
    bullets: entry.bullets,
  }));

  const eduBlocks = splitBlocks(sectionLines.education ?? []);
  sections.education = eduBlocks.map(parseEducationBlock).map((entry) => ({
    school: entry.school,
    degree: entry.degree,
    dates: entry.dates,
  }));

  const projectBlocks = splitBlocks(sectionLines.projects ?? []);
  sections.projects = projectBlocks.map((block) => {
    const [name = '', ...rest] = block.map(compact).filter(Boolean);
    return { name: name || undefined, bullets: rest.map((item) => compact(bulletTrim(item))) };
  });

  sections.certifications = Array.from(
    new Set((sectionLines.certifications ?? []).flatMap((line) => extractItems(line))),
  );

  sections.languages = Array.from(
    new Set((sectionLines.languages ?? []).flatMap((line) => extractItems(line))),
  );

  const bodyOnly = lines.filter((line) => line.trim());
  if (!sections.summary && bodyOnly.length) {
    const firstParagraph = bodyOnly.slice(0, Math.min(6, bodyOnly.length)).join(' ');
    sections.summary = compact(firstParagraph);
  }

  return parsedResumeSchema.parse(sections);
};
