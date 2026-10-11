import { confidenceRank, type AttributedEvidence, type ContactDraft, type ContactField } from './fields';
import { draftFieldConfidence, type ConfidenceContext } from './confidence';
import { foldText, normaliseName, normaliseProfileUrl } from '../text/normalise';

export const MERGE_THRESHOLD = 80;
export const FLAG_THRESHOLD = 60;

export type DedupDecision =
  | { kind: 'merge'; with: ContactDraft; score: number; reason: string }
  | { kind: 'flag'; with: ContactDraft; score: number }
  | { kind: 'new' };

function titleOverlap(a: string, b: string): number {
  const ta = new Set(foldText(a).split(' ').filter(Boolean));
  const tb = new Set(foldText(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(ta.size, tb.size);
}

/** Pair score per spec §5.5. Never merges on name alone. */
export function pairScore(a: ContactDraft, b: ContactDraft): number {
  let score = 0;
  if (a.fields.full_name && b.fields.full_name && normaliseName(a.fields.full_name) === normaliseName(b.fields.full_name)) {
    score += 50;
  }
  const sameCompany =
    a.company !== null &&
    b.company !== null &&
    (a.company.id === b.company.id || (a.company.domain !== null && a.company.domain === b.company.domain));
  if (sameCompany) score += 30;
  if (a.fields.city && b.fields.city && foldText(a.fields.city) === foldText(b.fields.city)) score += 10;
  if (a.fields.title && b.fields.title && titleOverlap(a.fields.title, b.fields.title) >= 0.6) score += 10;
  return score;
}

export function dedupDecision(candidate: ContactDraft, existing: readonly ContactDraft[]): DedupDecision {
  const url = candidate.fields.profile_url ? normaliseProfileUrl(candidate.fields.profile_url) : null;
  const email = candidate.fields.email?.toLowerCase();
  for (const other of existing) {
    if (url && other.fields.profile_url && normaliseProfileUrl(other.fields.profile_url) === url) {
      return { kind: 'merge', with: other, score: 100, reason: 'same profile URL' };
    }
    if (email && other.fields.email?.toLowerCase() === email) {
      return { kind: 'merge', with: other, score: 100, reason: 'same published email' };
    }
  }
  let best: { other: ContactDraft; score: number } | null = null;
  for (const other of existing) {
    const score = pairScore(candidate, other);
    if (!best || score > best.score) best = { other, score };
  }
  if (best && best.score >= MERGE_THRESHOLD) return { kind: 'merge', with: best.other, score: best.score, reason: `pair score ${best.score}` };
  if (best && best.score >= FLAG_THRESHOLD) return { kind: 'flag', with: best.other, score: best.score };
  return { kind: 'new' };
}

function evidenceKey(e: AttributedEvidence): string {
  return `${e.field}\u0000${e.sourceUrl}\u0000${e.value}`;
}

/**
 * Merges `incoming` into `base`: evidence is unioned, and each field keeps the
 * value with the higher confidence. Ties keep the existing value.
 */
export function mergeDrafts(base: ContactDraft, incoming: ContactDraft, ctx: ConfidenceContext): ContactDraft {
  const seen = new Set(base.evidence.map(evidenceKey));
  const evidence = [...base.evidence, ...incoming.evidence.filter((e) => !seen.has(evidenceKey(e)))];
  const merged: ContactDraft = {
    ...base,
    company: base.company ?? incoming.company,
    evidence,
    fields: { ...base.fields },
  };
  if (incoming.roleTier < base.roleTier) {
    merged.roleTier = incoming.roleTier;
    merged.roleArchetype = incoming.roleArchetype;
    merged.roleGenericOnly = incoming.roleGenericOnly;
  }
  for (const [field, value] of Object.entries(incoming.fields) as [ContactField, string][]) {
    const current = merged.fields[field];
    if (current === undefined) {
      merged.fields[field] = value;
      continue;
    }
    const keep = draftFieldConfidence(merged, field, ctx);
    const challenger = draftFieldConfidence({ ...merged, fields: { ...merged.fields, [field]: value } }, field, ctx);
    if (confidenceRank[challenger] > confidenceRank[keep]) merged.fields[field] = value;
  }
  return merged;
}
