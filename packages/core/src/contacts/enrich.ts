import type { Confidence } from '@scrapjob/schema';
import { draftFieldConfidence, type ConfidenceContext } from './confidence';
import { confidenceRank, type AttributedEvidence, type ContactDraft, type ContactField } from './fields';
import { foldText, normaliseName } from '../text/normalise';
import { sameEmployer } from '../pipeline/candidates';
import { valueInSnippet } from '../extraction/snippet';

export type FieldChangeKind = 'added' | 'updated' | 'corroborated' | 'contradicted';

export interface FieldChange {
  field: ContactField;
  kind: FieldChangeKind;
  before: string | null;
  after: string | null;
  confidenceBefore: Confidence;
  confidenceAfter: Confidence;
}

export interface PatchOutcome {
  draft: ContactDraft;
  changes: FieldChange[];
}

/** Fields where a different value means the person is not where we thought (spec §8.2). */
const identityFields: ReadonlySet<ContactField> = new Set(['title', 'company']);

function evidenceKey(e: AttributedEvidence): string {
  return `${e.field}\u0000${e.sourceUrl}\u0000${foldText(e.value)}`;
}

function titleTokens(title: string): Set<string> {
  return new Set(foldText(title).split(' ').filter((t) => t.length > 1));
}

/** "Talent Acquisition Manager" and "Senior Talent Acquisition Manager" describe the same job. */
export function compatibleTitles(a: string, b: string): boolean {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.min(ta.size, tb.size) >= 0.75;
}

function agrees(field: ContactField, current: string, value: string): boolean {
  if (field === 'full_name') return normaliseName(current) === normaliseName(value);
  if (field === 'company') return sameEmployer(current, value);
  return foldText(current) === foldText(value);
}

/**
 * Applies deep-search evidence to a contact (spec §8.2). Evidence is always
 * appended; a value is only replaced by one with strictly higher confidence;
 * a title or employer that disagrees is kept as evidence and the field is
 * flagged `contradicted` (which makes it UNKNOWN) instead of picking a winner.
 * The person's name is never changed.
 */
export function applyPatches(draft: ContactDraft, patches: readonly AttributedEvidence[], ctx: ConfidenceContext): PatchOutcome {
  const next: ContactDraft = {
    ...draft,
    fields: { ...draft.fields },
    evidence: [...draft.evidence],
    fieldFlags: Object.fromEntries(Object.entries(draft.fieldFlags).map(([k, v]) => [k, [...v]])),
  };
  const before = new Map<ContactField, { value: string | null; confidence: Confidence }>();
  const touched = new Map<ContactField, FieldChangeKind>();
  const seen = new Set(next.evidence.map(evidenceKey));
  const remember = (field: ContactField) => {
    if (!before.has(field)) {
      before.set(field, { value: next.fields[field] ?? null, confidence: draftFieldConfidence(next, field, ctx) });
    }
  };
  const mark = (field: ContactField, kind: FieldChangeKind) => {
    const order: FieldChangeKind[] = ['corroborated', 'updated', 'added', 'contradicted'];
    const current = touched.get(field);
    if (!current || order.indexOf(kind) > order.indexOf(current)) touched.set(field, kind);
  };

  for (const e of patches) {
    const field = e.field as ContactField;
    if (field === 'first_name' || field === 'last_name') continue;
    const key = evidenceKey(e);
    if (seen.has(key)) continue;
    const current = next.fields[field];
    if (field === 'full_name' && (current === undefined || !agrees(field, current, e.value))) continue;
    remember(field);
    seen.add(key);

    if (current === undefined) {
      next.evidence.push(e);
      next.fields[field] = e.value;
      mark(field, 'added');
      continue;
    }
    if (agrees(field, current, e.value)) {
      // Record it under the stored spelling when the snippet has it, so confidence counts it.
      next.evidence.push(valueInSnippet(current, e.snippet) ? { ...e, value: current } : e);
      mark(field, 'corroborated');
      continue;
    }
    next.evidence.push(e);
    if (identityFields.has(field) && !(field === 'title' && compatibleTitles(current, e.value))) {
      const flags = next.fieldFlags[field] ?? [];
      if (!flags.includes('contradicted')) next.fieldFlags[field] = [...flags, 'contradicted'];
      mark(field, 'contradicted');
      continue;
    }
    const keep = draftFieldConfidence(next, field, ctx);
    const challenger = draftFieldConfidence({ ...next, fields: { ...next.fields, [field]: e.value } }, field, ctx);
    if (confidenceRank[challenger] > confidenceRank[keep]) {
      next.fields[field] = e.value;
      mark(field, 'updated');
    }
  }

  const changes: FieldChange[] = [];
  for (const [field, kind] of touched) {
    const was = before.get(field)!;
    const confidenceAfter = draftFieldConfidence(next, field, ctx);
    if (kind === 'corroborated' && confidenceRank[confidenceAfter] <= confidenceRank[was.confidence]) continue;
    changes.push({
      field,
      kind,
      before: was.value,
      after: next.fields[field] ?? null,
      confidenceBefore: was.confidence,
      confidenceAfter,
    });
  }
  return { draft: next, changes };
}
