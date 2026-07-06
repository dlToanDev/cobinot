export const COURSE_ABBREVIATION_MAP: Record<string, string> = {
  'co ban': 'CB',
  'nang cao': 'NC',
  'luyen de': 'LD',
  'cap toc': 'CT',
  'giao tiep': 'GT',
  'mat goc': 'MG',
  'theo tuan': 'WEEKLY',
};

export type GenerateClassCodeOptions = {
  courseCode?: string | null;
  courseShortCode?: string | null;
  courseTitle?: string | null;
  classTitle?: string | null;
  classType?: string | null;
  includeClassType?: boolean;
  keepLopPrefix?: boolean;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeVietnameseAscii(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizedWords(value: string) {
  return normalizeVietnameseAscii(value)
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function applyCourseAbbreviations(value: string) {
  let result = ` ${value} `;
  const phrases = Object.keys(COURSE_ABBREVIATION_MAP).sort(
    (a, b) => b.length - a.length,
  );

  for (const phrase of phrases) {
    result = result.replace(
      new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'g'),
      ` ${COURSE_ABBREVIATION_MAP[phrase]} `,
    );
  }

  return result.trim().replace(/\s+/g, ' ');
}

export function normalizeGeneratedCode(value: string) {
  return normalizeVietnameseAscii(value)
    .toLocaleUpperCase('vi-VN')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function generateCourseCode(title: string) {
  const normalized = normalizedWords(title);
  if (!normalized) return '';

  const toeic = normalized.match(/\btoeic\s*(\d{3,4})\+?\b/);
  if (toeic) return `T${toeic[1]}`;

  const ielts = normalized.match(/\bielts\s*(\d)(?:[.,](\d))?\b/);
  if (ielts) return `I${ielts[1]}${ielts[2] ?? '0'}`;

  return applyCourseAbbreviations(normalized)
    .split(/\s+/)
    .map((part) => normalizeGeneratedCode(part))
    .filter(Boolean)
    .join('_');
}

export function generateCourseShortCode(titleOrCode: string) {
  const code = generateCourseCode(titleOrCode) || normalizeGeneratedCode(titleOrCode);
  const parts = code.split('_').filter(Boolean);

  if (parts.length <= 1) return code;

  return parts
    .map((part) => (/^[A-Z0-9]{1,3}$/.test(part) ? part : part.charAt(0)))
    .join('');
}

function stripClassIndex(value: string) {
  return value.replace(/(?:^|\s+)(\d+)\s*$/, '').trim();
}

export function getClassIndex(classTitle: string) {
  const match = normalizedWords(classTitle).match(/(?:^|\s)(\d+)$/);
  return match ? Number(match[1]) : 1;
}

function getExplicitClassIndex(classTitle: string) {
  const match = normalizedWords(classTitle).match(/(?:^|\s)(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

export function generateClassSubjectCode(
  classTitle: string,
  options: { keepLopPrefix?: boolean } = {},
) {
  let subject = normalizedWords(stripClassIndex(classTitle));
  if (!options.keepLopPrefix) {
    subject = subject.replace(/^(?:lop hoc|lop|class)\s+/, '');
  }

  return (
    applyCourseAbbreviations(subject)
      .split(/\s+/)
      .map((part) => normalizeGeneratedCode(part))
      .filter(Boolean)
      .join('_') || 'CLASS'
  );
}

export function generateClassCode(options: GenerateClassCodeOptions) {
  const coursePrefix =
    normalizeGeneratedCode(String(options.courseCode || '')) ||
    normalizeGeneratedCode(String(options.courseShortCode || '')) ||
    generateCourseCode(String(options.courseTitle || '')) ||
    'COURSE';
  const classTitle = String(options.classTitle || '');
  const subjectCode = generateClassSubjectCode(classTitle, {
    keepLopPrefix: options.keepLopPrefix,
  });
  const shouldIncludeClassType =
    options.includeClassType ?? Boolean(options.classType);
  const typeCode =
    shouldIncludeClassType && options.classType
      ? normalizeGeneratedCode(String(options.classType))
      : '';
  const index = getExplicitClassIndex(classTitle);

  return [coursePrefix, subjectCode, typeCode, index ? String(index) : '']
    .filter(Boolean)
    .join('_');
}
