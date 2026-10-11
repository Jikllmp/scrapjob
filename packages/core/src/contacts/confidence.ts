import type { Confidence } from '@scrapjob/schema';
import type { Taxonomy } from '../taxonomy';
import { foldText, normaliseCompanyName, registrableDomain, slugify } from '../text/normalise';
import { lowestConfidence, type AttributedEvidence, type CompanyRef, type ContactDraft, type ContactField } from './fields';

const STALE_MS = 730 * 24 * 3600 * 1000;

export interface ConfidenceContext {
  taxonomy: Taxonomy;
  now: Date;
}

export function isStale(e: Pick<AttributedEvidence, 'publishedAt'>, now: Date): boolean {
  return e.publishedAt !== undefined && now.getTime() - new Date(e.publishedAt).getTime() > STALE_MS;
}

/** The employer published it: its own domain, or an ATS account named after it (ANALYSIS A7). */
export function isEmployerSource(url: string, company: CompanyRef | null, taxonomy: Taxonomy): boolean {
  if (!company) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const domain = registrableDomain(host);
  if (company.domain && domain === registrableDomain(company.domain)) return true;
  if (taxonomy.hosts.ats.includes(domain)) {
    const slug = slugify(normaliseCompanyName(company.name)).replace(/-/g, '');
    const label = host.slice(0, host.length - domain.length).replace(/\.$/, '').replace(/[^a-z0-9]/g, '');
    const path = new URL(url).pathname.toLowerCase().replace(/[^a-z0-9/]/g, '');
    return slug.length >= 3 && (label.includes(slug) || path.split('/').includes(slug));
  }
  return false;
}

function isAggregator(url: string, taxonomy: Taxonomy): boolean {
  return taxonomy.hosts.aggregators.includes(registrableDomain(url));
}

/**
 * Field confidence from its evidence (spec §4.2). Only evidence agreeing with
 * `value` counts; disagreeing evidence makes the field contradicted.
 */
export function fieldConfidence(
  value: string,
  evidence: AttributedEvidence[],
  company: CompanyRef | null,
  flags: string[],
  ctx: ConfidenceContext,
): Confidence {
  if (flags.includes('contradicted')) return 'UNKNOWN';
  const key = foldText(value);
  const agreeing = evidence.filter((e) => foldText(e.value) === key && !isStale(e, ctx.now));
  if (agreeing.length === 0) return 'UNKNOWN';
  if (agreeing.some((e) => e.sourceKind === 'page' && isEmployerSource(e.sourceUrl, company, ctx.taxonomy))) {
    return 'VERIFIED';
  }
  const independent = new Set(agreeing.map((e) => registrableDomain(e.sourceUrl)));
  if (independent.size >= 2) return 'HIGH';
  if (agreeing.some((e) => e.sourceKind === 'page' && !isAggregator(e.sourceUrl, ctx.taxonomy))) return 'MEDIUM';
  // The user read the profile and typed it in: one source, but a person checked it.
  if (agreeing.some((e) => e.sourceKind === 'user')) return 'MEDIUM';
  return 'LOW';
}

export function draftFieldConfidence(draft: ContactDraft, field: ContactField, ctx: ConfidenceContext): Confidence {
  const value = draft.fields[field];
  if (value === undefined) return 'UNKNOWN';
  return fieldConfidence(
    value,
    draft.evidence.filter((e) => e.field === field),
    draft.company,
    draft.fieldFlags[field] ?? [],
    ctx,
  );
}

/** Lowest of full name, title and company: the three fields that make a contact actionable. */
export function contactConfidence(draft: ContactDraft, ctx: ConfidenceContext): Confidence {
  return lowestConfidence((['full_name', 'title', 'company'] as const).map((f) => draftFieldConfidence(draft, f, ctx)));
}

/** Lower of the name and employer confidences: decides whether a contact is an unconfirmed lead. */
export function identityConfidence(draft: ContactDraft, ctx: ConfidenceContext): Confidence {
  return lowestConfidence((['full_name', 'company'] as const).map((f) => draftFieldConfidence(draft, f, ctx)));
}
