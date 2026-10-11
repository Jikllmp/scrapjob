import { EnrichResult, type Company, type Confidence, type PostingCandidate } from '@scrapjob/schema';
import type { BudgetSpent } from '@scrapjob/schema/api';
import { Budget } from './budget';
import { normaliseSourceError } from './adapters/errors';
import type { EventSink, SearchContext, SourceAdapter } from './adapters/types';
import { contactConfidence, draftFieldConfidence, identityConfidence, type ConfidenceContext } from './contacts/confidence';
import { applyPatches, type FieldChange } from './contacts/enrich';
import { contactFields, isLead, type AttributedEvidence, type ContactDraft, type ContactField } from './contacts/fields';
import { classifyTitle } from './contacts/roles';
import { valueInSnippet } from './extraction/snippet';
import { planQueries } from './planning/queries';
import { scoreDraft } from './pipeline/score';
import type { ScoredDraft } from './pipeline/store';
import type { Taxonomy } from './taxonomy';
import { containsPhrase } from './text/normalise';

/** A contact's values with their confidence, score and lead status at one moment. */
export interface ContactSnapshot {
  fields: Record<string, { value: string; confidence: Confidence }>;
  score: number;
  confidence: Confidence;
  lead: boolean;
}

export interface DeepSearchRequest {
  deepSearchId: string;
  contactId: string;
  /** The search the contact came from: its location and position frame the queries. */
  location: string;
  position: string;
  draft: ContactDraft;
  company: Company | null;
  hasPosting: boolean;
  /** The stored score, kept when there is no employer to score against. */
  previousScore?: { score: number; reasons: string[] } | null;
}

export interface DeepSearchStore {
  /** Persists the enriched contact: appends evidence, sets the chosen values and the new score. */
  saveEnriched(contactId: string, scored: ScoredDraft): void;
  /** Stores a posting found for the employer and links it to the contact. */
  linkPosting(contactId: string, company: Company, posting: PostingCandidate, adapter: string): void;
}

export interface DeepSearchOptions {
  adapters: readonly SourceAdapter[];
  events: EventSink;
  store: DeepSearchStore;
  taxonomy: Taxonomy;
  maxRequests: number;
  maxDurationMs: number;
  signal: AbortSignal;
  now?: () => number;
}

export interface DeepSearchOutcome {
  status: 'completed' | 'failed';
  message: string;
  before: ContactSnapshot;
  after: ContactSnapshot;
  changes: FieldChange[];
  postingUrl: string | null;
  budgetSpent: BudgetSpent;
}

export function snapshot(scored: ScoredDraft, ctx: ConfidenceContext): ContactSnapshot {
  const fields: ContactSnapshot['fields'] = {};
  for (const field of contactFields) {
    const value = scored.draft.fields[field];
    if (value !== undefined) fields[field] = { value, confidence: draftFieldConfidence(scored.draft, field, ctx) };
  }
  return {
    fields,
    score: scored.score.score,
    confidence: scored.confidence,
    lead: isLead(identityConfidence(scored.draft, ctx)),
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Enriches one contact (spec §8.2): asks every enrich-capable source for
 * evidence about this person, applies it without ever creating a second row
 * or lowering a value's confidence, rescores, and records before and after.
 */
export async function runDeepSearch(request: DeepSearchRequest, options: DeepSearchOptions): Promise<DeepSearchOutcome> {
  const { events, taxonomy, signal } = options;
  const now = options.now ?? Date.now;
  const budget = Budget.forDeepSearch(options.maxRequests, options.maxDurationMs, now);
  const plan = planQueries(request.location, request.position, taxonomy);
  const scoring = () => ({ plan, taxonomy, now: new Date(now()) });
  const confCtx = (): ConfidenceContext => ({ taxonomy, now: new Date(now()) });
  const name = request.draft.fields.full_name ?? 'contact';

  const employer = request.company;
  const rescore = (draft: ContactDraft, hasPosting: boolean): ScoredDraft =>
    employer
      ? scoreDraft(draft, { company: employer, hasPosting }, scoring())
      : { draft, score: request.previousScore ?? { score: 0, reasons: [] }, confidence: contactConfidence(draft, confCtx()) };
  const initial = rescore(request.draft, request.hasPosting);
  const before = snapshot(initial, confCtx());

  events.emit('ENRICHMENT_STARTED', 'info', `Deep search: ${name}${employer ? `, ${employer.name}` : ''}`, {
    contactId: request.contactId,
  });

  const ctx: SearchContext = {
    searchId: request.deepSearchId,
    location: request.location,
    position: request.position,
    targetCount: 1,
    signal,
    budget,
    events,
    plan,
    taxonomy,
    shouldStop: () => signal.aborted || budget.exhausted() !== null,
  };

  const evidence: AttributedEvidence[] = [];
  const postings: { posting: PostingCandidate; adapter: string }[] = [];
  const sources = options.adapters.filter((a) => a.capabilities.has('enrich'));
  let asked = 0;
  let failed = 0;
  for (const adapter of sources) {
    if (ctx.shouldStop()) break;
    let available = false;
    try {
      available = await adapter.isAvailable();
    } catch {
      available = false;
    }
    if (!available) continue;
    asked += 1;
    try {
      const raw = await adapter.enrich(ctx, { contactId: request.contactId, fields: request.draft.fields, company: employer });
      const parsed = EnrichResult.safeParse(raw);
      if (!parsed.success) {
        events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id} returned an invalid deep-search result`, { adapter: adapter.id });
        continue;
      }
      for (const patch of parsed.data.patches) {
        const e = patch.evidence;
        if (!isContactField(patch.field)) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id}: "${patch.field}" is not a contact field`, { adapter: adapter.id, sourceUrl: e.sourceUrl });
          continue;
        }
        if (patch.field !== e.field || !valueInSnippet(e.value, e.snippet)) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id}: "${patch.field}" value is not in its snippet`, {
            adapter: adapter.id,
            sourceUrl: e.sourceUrl,
          });
          continue;
        }
        evidence.push({ ...e, sourceAdapter: adapter.id });
      }
      for (const posting of parsed.data.postings) {
        if (plan.positionTerms.some((t) => containsPhrase(posting.title, t))) postings.push({ posting, adapter: adapter.id });
      }
    } catch (thrown) {
      failed += 1;
      const error = normaliseSourceError(adapter.id, thrown);
      events.emit('WARNING', 'warn', `${error.adapter}: ${error.kind}: ${error.message}`, { error });
    }
  }

  // Interrupted (shutdown): save nothing, so the rerun starts from the stored contact.
  if (signal.aborted) {
    return {
      status: 'failed',
      message: `Deep search: ${name}: interrupted`,
      before,
      after: before,
      changes: [],
      postingUrl: null,
      budgetSpent: budget.spent(),
    };
  }

  const applied = applyPatches(request.draft, evidence, confCtx());
  // A better-supported title can change the role, and with it the score.
  const newTitle = applied.draft.fields.title;
  if (newTitle && newTitle !== request.draft.fields.title && applied.draft.roleArchetype !== 'posting-contact') {
    const role = classifyTitle(newTitle, taxonomy);
    if (role) Object.assign(applied.draft, { roleArchetype: role.archetype, roleTier: role.tier, roleGenericOnly: role.genericOnly });
  }
  const posting = postings[0] ?? null;
  const after = rescore(applied.draft, request.hasPosting || posting !== null);
  if (applied.changes.length > 0 || posting) options.store.saveEnriched(request.contactId, after);
  if (posting && employer) options.store.linkPosting(request.contactId, employer, posting.posting, posting.adapter);

  const count = (kind: FieldChange['kind']) => applied.changes.filter((c) => c.kind === kind).length;
  const spent = budget.spent();
  const allFailed = asked > 0 && failed === asked;
  const summary =
    asked === 0
      ? 'no deep-search source is available'
      : allFailed
        ? 'every source failed'
        : `${plural(count('added'), 'field')} added, ${count('updated')} updated, ${count('corroborated')} corroborated, ${count('contradicted')} contradicted${posting ? ', posting found' : ''}`;
  const message = `Deep search: ${name}: ${summary} (${plural(spent.deepSearchRequests, 'request')})`;
  const status = asked === 0 || allFailed ? 'failed' : 'completed';
  events.emit('ENRICHMENT_COMPLETED', status === 'failed' ? 'warn' : 'info', message, {
    contactId: request.contactId,
    changes: applied.changes,
    budgetSpent: spent,
  });
  return {
    status,
    message,
    before,
    after: snapshot(after, confCtx()),
    changes: applied.changes,
    postingUrl: posting?.posting.url ?? null,
    budgetSpent: spent,
  };
}

function isContactField(field: string): field is ContactField {
  return (contactFields as readonly string[]).includes(field);
}
