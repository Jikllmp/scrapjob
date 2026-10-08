import type { Taxonomy } from '../taxonomy';
import { classifyTitle } from '../contacts/roles';
import { looksLikePersonName } from './names';

export interface LinkedInLead {
  fullName: string;
  title: string | null;
  companyName: string | null;
}

const separators = /\s+[-–—|]\s+/;
const atCompany = /\s+(?:chez|at|bij|@)\s+(.+)$/i;

/**
 * Reads a LinkedIn search result title as returned by the search API, e.g.
 * "Marie Dupont - Talent Acquisition - Acme | LinkedIn". Never fetches LinkedIn.
 * Only public profile URLs (`/in/…`) are accepted.
 */
export function parseLinkedInResult(url: string, title: string, taxonomy: Taxonomy): LinkedInLead | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/.test(parsed.hostname) || !/^\/in\/[^/]+\/?$/.test(parsed.pathname)) return null;

  const clean = title.replace(/\s*[|–-]\s*LinkedIn\s*$/i, '').replace(/\.\.\.$|…$/, '').trim();
  const parts = clean.split(separators).map((p) => p.trim()).filter(Boolean);
  const name = parts[0];
  if (!name || !looksLikePersonName(name)) return null;

  let headline: string | null = null;
  let company: string | null = null;
  if (parts.length >= 3) {
    headline = parts[1]!;
    company = parts[2]!;
  } else if (parts.length === 2) {
    if (classifyTitle(parts[1]!, taxonomy)) headline = parts[1]!;
    else company = parts[1]!;
  }
  if (headline && !company) {
    const m = headline.match(atCompany);
    if (m?.[1]) {
      company = m[1].trim();
      headline = headline.slice(0, m.index).trim();
    }
  }
  return { fullName: name, title: headline, companyName: company };
}
