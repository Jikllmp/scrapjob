import ExcelJS from 'exceljs';
import { slugify } from '@scrapjob/core';
import type { ContactRowDto } from '@scrapjob/schema/api';

export const CONTACT_COLUMNS = [
  'First Name',
  'Last Name',
  'Full Name',
  'Title',
  'Department',
  'Role Tier',
  'Company',
  'Industry',
  'Company City',
  'Company Country',
  'Company Website',
  'Email',
  'Email Confidence',
  'Phone',
  'Profile URL',
  'Job Posting URL',
  'Relevance Score',
  'Relevance Reasons',
  'Overall Confidence',
  'Sources',
  'Primary Source URL',
  'Collected At',
  'Notes',
] as const;

const urlColumns = new Set(['Company Website', 'Profile URL', 'Job Posting URL', 'Primary Source URL']);
const MAX_WIDTH = 60;

export interface WorkbookInput {
  location: string;
  position: string;
  rows: ContactRowDto[];
  retentionDays: number;
  generatedAt: Date;
}

/** `contacts_<location>_<position>_<YYYY-MM-DD>.xlsx`, ASCII-only and free of path separators. */
export function exportFilename(location: string, position: string, date: Date): string {
  return `contacts_${slugify(location)}_${slugify(position)}_${date.toISOString().slice(0, 10)}.xlsx`;
}

function notesFor(row: ContactRowDto): string {
  const notes: string[] = [];
  if (row.lead) notes.push('Unconfirmed lead: seen only in search results, confirm before writing.');
  if (row.company?.isAgency) notes.push('Works for a recruitment agency.');
  if (row.possibleDuplicateOf) notes.push('Possibly the same person as another row.');
  if (row.notes) notes.push(row.notes);
  return notes.join(' ');
}

function cellsFor(row: ContactRowDto): Record<(typeof CONTACT_COLUMNS)[number], string | number | null> {
  return {
    'First Name': row.firstName,
    'Last Name': row.lastName,
    'Full Name': row.fullName,
    Title: row.title,
    Department: row.department,
    'Role Tier': row.roleTier,
    Company: row.company?.name ?? null,
    Industry: row.company?.industry ?? null,
    'Company City': row.company?.city ?? null,
    'Company Country': row.company?.country ?? null,
    'Company Website': row.company?.website ?? null,
    Email: row.email,
    'Email Confidence': row.email ? (row.fieldConfidence.email ?? null) : null,
    Phone: row.phone,
    'Profile URL': row.profileUrl,
    'Job Posting URL': row.jobPostingUrl,
    'Relevance Score': row.relevanceScore,
    'Relevance Reasons': row.relevanceReasons.join('; '),
    'Overall Confidence': row.confidence,
    Sources: row.sources.join(', '),
    'Primary Source URL': row.primarySourceUrl,
    'Collected At': row.collectedAt,
    Notes: notesFor(row) || null,
  };
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const text = `${u.hostname.replace(/^www\./, '')}${path}`;
    return text.length > 50 ? `${text.slice(0, 49)}…` : text;
  } catch {
    return url;
  }
}

/** Builds the two-sheet workbook of spec §8.1: README first, then one row per person. */
export function buildWorkbook(input: WorkbookInput): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ScrapJob';
  wb.created = input.generatedAt;

  const retention = new Date(input.generatedAt.getTime() + input.retentionDays * 24 * 3600 * 1000);
  const readme = wb.addWorksheet('README');
  readme.columns = [{ width: 110 }];
  for (const line of [
    'ScrapJob export',
    `Search: "${input.position}" in ${input.location}. Generated ${input.generatedAt.toISOString().slice(0, 10)}. ${input.rows.length} contacts.`,
    '',
    'Purpose: this data is for your own job search only. Do not resell, publish or use it for marketing.',
    'Lawful basis: legitimate interest (job-search outreach). Only professional information that the person or their employer published is included.',
    'Every value comes from a source; see "Primary Source URL" and "Sources". Empty cells mean nothing was published: nothing is guessed.',
    '"Unconfirmed lead" rows were seen only in search results; confirm them before writing.',
    `Retention: delete this file by ${retention.toISOString().slice(0, 10)} (${input.retentionDays} days).`,
    'When you first write to someone, tell them where you found their details and that they can ask you to delete them.',
  ]) {
    readme.addRow([line]);
  }
  readme.getRow(1).font = { bold: true, size: 14 };

  const sheet = wb.addWorksheet('Contacts', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow([...CONTACT_COLUMNS]);
  sheet.getRow(1).font = { bold: true };
  const widths = CONTACT_COLUMNS.map((c) => c.length);

  for (const row of input.rows) {
    const cells = cellsFor(row);
    const added = sheet.addRow(CONTACT_COLUMNS.map((c) => cells[c] ?? null));
    CONTACT_COLUMNS.forEach((column, i) => {
      const value = cells[column];
      const cell = added.getCell(i + 1);
      if (urlColumns.has(column) && typeof value === 'string') {
        const text = displayUrl(value);
        cell.value = { text, hyperlink: value };
        cell.font = { color: { argb: 'FF1F4E9E' }, underline: true };
        widths[i] = Math.max(widths[i]!, text.length);
      } else if (value !== null && value !== undefined) {
        widths[i] = Math.max(widths[i]!, String(value).length);
      }
    });
  }
  sheet.columns.forEach((col, i) => {
    col.width = Math.min(MAX_WIDTH, (widths[i] ?? 10) + 2);
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CONTACT_COLUMNS.length } };
  return wb;
}
