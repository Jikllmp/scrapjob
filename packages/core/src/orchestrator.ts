import { CompanyCandidate, CompanyPatch, JobCandidate, type Company } from '@scrapjob/schema';
import type { BudgetSpent } from '@scrapjob/schema/api';
import { Budget, type BudgetLimits, type BudgetStopReason } from './budget';
import { normaliseSourceError, type SourceError } from './adapters/errors';
import { SourceHealth } from './adapters/registry';
import { isDiscoveryCapable, type EventSink, type SearchContext, type SourceAdapter } from './adapters/types';
import { identityConfidence, type ConfidenceContext } from './contacts/confidence';
import { dedupDecision, mergeDrafts } from './contacts/dedup';
import { isLead, type ContactDraft } from './contacts/fields';
import { valueInSnippet } from './extraction/snippet';
import { planQueries, type QueryPlan } from './planning/queries';
import { buildDraft } from './pipeline/candidates';
import { scoreDraft, type ScoringContext } from './pipeline/score';
import type { PipelineStore, ScoredDraft } from './pipeline/store';
import type { Taxonomy } from './taxonomy';
import { containsPhrase, normaliseName } from './text/normalise';

export interface SearchRequest {
  searchId: string;
  location: string;
  position: string;
  targetCount: number;
}

export interface OrchestratorOptions {
  adapters: readonly SourceAdapter[];
  events: EventSink;
  store: PipelineStore;
  taxonomy: Taxonomy;
  limits: BudgetLimits;
  minRelevanceScore: number;
  sourceFailureThreshold: number;
  signal: AbortSignal;
  now?: () => number;
  /**
   * Contacts already stored for this search, with their employers, when it
   * resumes after a restart. They count toward the target, new sightings merge
   * into them instead of becoming new rows, and their employers are not asked
   * for people again.
   */
  existing?: readonly { draft: ContactDraft; company: Company | null; hasPosting: boolean }[];
}

export type StopReason =
  | 'target_reached'
  | BudgetStopReason
  | 'sources_exhausted'
  | 'all_sources_failed'
  | 'no_source_available'
  | 'cancelled';

export interface SearchOutcome {
  status: 'completed' | 'failed' | 'cancelled';
  stopReason: StopReason;
  message: string;
  validatedContacts: number;
  leads: number;
  companies: number;
  budgetSpent: BudgetSpent;
}

const stopReasonText: Record<StopReason, string> = {
  target_reached: 'target reached',
  duration_exhausted: 'time budget exhausted',
  http_budget_exhausted: 'request budget exhausted',
  search_api_budget_exhausted: 'search API budget exhausted',
  sources_exhausted: 'sources exhausted',
  all_sources_failed: 'every source failed',
  no_source_available: 'no company discovery source is available',
  deep_search_budget_exhausted: 'deep-search request budget exhausted',
  cancelled: 'cancelled by the user',
};

/** Stop asking a company for more people once it has yielded this many. */
const PEOPLE_PER_COMPANY = 3;

interface CompanyState {
  company: Company;
  hasPosting: boolean;
  validated: number;
}

interface TrackedContact {
  draft: ContactDraft;
  lead: boolean;
}

/**
 * Runs one search: plan queries, discover companies (with their open
 * postings), then for each company identify people, build evidenced drafts,
 * dedup, score and persist, until the target or a budget is reached.
 */
export async function runSearch(request: SearchRequest, options: OrchestratorOptions): Promise<SearchOutcome> {
  const { events, signal, store, taxonomy } = options;
  const now = options.now ?? Date.now;
  const budget = new Budget(options.limits, now);
  const health = new SourceHealth(options.sourceFailureThreshold);
  const confCtx = (): ConfidenceContext => ({ taxonomy, now: new Date(now()) });
  const contacts: TrackedContact[] = [];
  const companies = new Map<string, CompanyState>();
  for (const { draft, company, hasPosting } of options.existing ?? []) {
    contacts.push({ draft, lead: isLead(identityConfidence(draft, confCtx())) });
    if (!company) continue;
    const state = companies.get(company.id) ?? { company, hasPosting, validated: 0 };
    state.validated += 1;
    companies.set(company.id, state);
  }
  let validated = contacts.length;
  const warned = new Set<string>();

  const stopCheck = (): StopReason | null => {
    if (signal.aborted) return 'cancelled';
    if (validated >= request.targetCount) return 'target_reached';
    return budget.exhausted();
  };

  const leads = () => contacts.filter((c) => c.lead).length;
  const finish = (status: SearchOutcome['status'], stopReason: StopReason): SearchOutcome => {
    const confirmed = validated - leads();
    const detail = validated > 0 ? ` (${confirmed} confirmed, ${leads()} unconfirmed leads)` : '';
    const message = `${validated} / ${request.targetCount} contacts${detail} — stopped: ${stopReasonText[stopReason]}`;
    return {
      status,
      stopReason,
      message,
      validatedContacts: validated,
      leads: leads(),
      companies: companies.size,
      budgetSpent: budget.spent(),
    };
  };
  const finishStopped = (reason: StopReason) => finish(reason === 'cancelled' ? 'cancelled' : 'completed', reason);

  const recordFailure = (error: SourceError): void => {
    events.emit('WARNING', 'warn', `${error.adapter}: ${error.kind}: ${error.message}`, { error });
    if (health.recordFailure(error.adapter)) {
      events.emit('SOURCE_DISABLED', 'warn', `${error.adapter} disabled for this search after repeated failures`, {
        adapter: error.adapter,
        failures: health.failureCount(error.adapter),
      });
    }
  };

  const budgetWarnings = () => {
    const spent = budget.spent();
    const checks: [string, number, number][] = [
      ['requests', spent.httpRequests, options.limits.maxHttpRequests],
      ['search API calls', spent.searchApiCalls, options.limits.maxSearchApiCalls],
      ['time', spent.elapsedMs, options.limits.maxDurationMs],
    ];
    for (const [name, used, limit] of checks) {
      if (!warned.has(name) && used >= limit * 0.8) {
        warned.add(name);
        events.emit('BUDGET_WARNING', 'warn', `80% of the ${name} budget used`, { budget: name, used, limit });
      }
    }
  };

  events.emit('SEARCH_STARTED', 'info', `Searching for "${request.position}" in ${request.location}`, {
    location: request.location,
    position: request.position,
    targetCount: request.targetCount,
  });

  const live: SourceAdapter[] = [];
  for (const adapter of options.adapters) {
    let available = false;
    try {
      available = await adapter.isAvailable();
    } catch (thrown) {
      recordFailure(normaliseSourceError(adapter.id, thrown));
    }
    if (available) {
      live.push(adapter);
      events.emit('SOURCE_INITIALIZED', 'info', `${adapter.displayName} ready`, {
        adapter: adapter.id,
        capabilities: [...adapter.capabilities],
      });
    } else {
      health.disable(adapter.id);
      const why = adapter.unavailableReason?.() ?? 'not available';
      events.emit('SOURCE_DISABLED', 'warn', `${adapter.displayName}: ${why}`, { adapter: adapter.id });
    }
  }

  const discovery = live.filter(isDiscoveryCapable);
  const companySources = discovery.filter((a) => a.capabilities.has('companies'));
  const peopleSources = discovery.filter((a) => a.capabilities.has('people'));
  const jobSources = discovery.filter((a) => a.capabilities.has('jobs'));
  const companyEnrichers = live.filter((a) => a.capabilities.has('enrich') && a.enrichCompany);
  if (companySources.length === 0) return finish('failed', 'no_source_available');

  const plan: QueryPlan = planQueries(request.location, request.position, taxonomy);
  for (const q of plan.seeds) {
    events.emit('QUERY_PLANNED', 'debug', q.text, { queryId: q.id, intent: q.intent, lang: q.lang });
  }
  const ctx: SearchContext = {
    ...request,
    signal,
    budget,
    events,
    plan,
    taxonomy,
    shouldStop: () => stopCheck() !== null,
  };

  const scoring = (): ScoringContext => ({ plan, taxonomy, now: new Date(now()) });
  const score = (draft: ContactDraft, state: CompanyState): ScoredDraft => scoreDraft(draft, state, scoring());

  const handleCandidate = (raw: unknown, adapter: SourceAdapter, state: CompanyState): void => {
    const built = buildDraft(raw, adapter.id, state.company, taxonomy, events);
    if (!built.ok) {
      events.emit('CONTACT_REJECTED', 'debug', `${adapter.id}: ${built.reason}`, {
        adapter: adapter.id,
        company: state.company.name,
        reasons: [built.reason],
      });
      return;
    }
    const draft = built.draft;
    const name = draft.fields.full_name!;
    if (store.isBlocked(normaliseName(name), state.company)) {
      events.emit('CONTACT_REJECTED', 'info', `${name} is on the erasure blocklist`, { reasons: ['blocklisted'] });
      return;
    }
    events.emit('CONTACT_CANDIDATE_FOUND', 'debug', `${name} — ${draft.fields.title ?? 'job posting contact'}`, {
      adapter: adapter.id,
      company: state.company.name,
    });

    const decision = dedupDecision(
      draft,
      contacts.map((c) => c.draft),
    );
    if (decision.kind === 'merge') {
      const tracked = contacts.find((c) => c.draft === decision.with)!;
      const merged = mergeDrafts(decision.with, draft, confCtx());
      const scored = score(merged, companies.get(merged.company?.id ?? '') ?? state);
      store.updateContact(merged.id!, scored);
      tracked.draft = merged;
      tracked.lead = isLead(identityConfidence(merged, confCtx()));
      const urls = [...new Set([...decision.with.evidence, ...draft.evidence].map((e) => e.sourceUrl))];
      events.emit('DUPLICATE_MERGED', 'info', `${name}: merged two sightings (${decision.reason})`, {
        contactId: merged.id,
        sourceUrls: urls,
        score: scored.score.score,
        confidence: scored.confidence,
      });
      return;
    }

    const scored = score(draft, state);
    if (scored.score.score < options.minRelevanceScore) {
      events.emit('CONTACT_REJECTED', 'info', `${name} scored ${scored.score.score}, below ${options.minRelevanceScore}`, {
        company: state.company.name,
        score: scored.score.score,
        reasons: scored.score.reasons,
      });
      return;
    }
    const id = store.insertContact(request.searchId, scored);
    draft.id = id;
    const lead = isLead(identityConfidence(draft, confCtx()));
    contacts.push({ draft, lead });
    validated += 1;
    state.validated += 1;
    events.emit(
      'CONTACT_VALIDATED',
      'info',
      `${name} — ${draft.fields.title ?? 'job posting contact'}, ${state.company.name} (score ${scored.score.score}, ${scored.confidence}${lead ? ', unconfirmed lead' : ''})`,
      { contactId: id, score: scored.score.score, confidence: scored.confidence, lead, adapter: adapter.id },
    );
    if (decision.kind === 'flag') {
      store.flagPossibleDuplicate(id, decision.with.id!);
      events.emit('POSSIBLE_DUPLICATE', 'info', `${name} may be the same person as an earlier contact`, {
        contactId: id,
        otherId: decision.with.id,
        score: decision.score,
      });
    }
  };

  /** Register facts (sector, legal name) first, so the people found next are scored with them. */
  const enrichCompany = async (state: CompanyState): Promise<void> => {
    for (const adapter of companyEnrichers) {
      if (stopCheck()) return;
      if (health.isDisabled(adapter.id)) continue;
      try {
        const raw = await adapter.enrichCompany!(ctx, state.company);
        if (!raw) continue;
        const parsed = CompanyPatch.safeParse(raw);
        const evidence = parsed.success ? parsed.data.evidence.filter((e) => valueInSnippet(e.value, e.snippet)) : [];
        if (!parsed.success || evidence.length === 0) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id} returned unsupported facts for ${state.company.name}`, {
            adapter: adapter.id,
          });
          continue;
        }
        state.company = store.applyCompanyPatch(state.company, { ...parsed.data, evidence }, adapter.id);
        events.emit('ENRICHMENT_COMPLETED', 'info', `${state.company.name}: ${state.company.industry ?? 'register entry found'}`, {
          adapter: adapter.id,
          companyId: state.company.id,
          registryId: state.company.registryId,
          naceCode: state.company.naceCode,
        });
      } catch (thrown) {
        recordFailure(normaliseSourceError(adapter.id, thrown));
      }
    }
  };

  /** Open postings from the employer's job feed: the strongest sign it is hiring for this position. */
  const discoverJobs = async (state: CompanyState): Promise<void> => {
    for (const adapter of jobSources) {
      if (stopCheck()) return;
      if (health.isDisabled(adapter.id)) continue;
      try {
        for await (const raw of adapter.discoverJobs(ctx, state.company)) {
          const parsed = JobCandidate.safeParse(raw);
          if (!parsed.success || !parsed.data.evidence.some((e) => valueInSnippet(e.value, e.snippet))) {
            events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id} returned an invalid job posting`, { adapter: adapter.id });
            continue;
          }
          const job = parsed.data;
          if (!plan.positionTerms.some((t) => containsPhrase(job.title, t))) continue;
          state.hasPosting = true;
          if (store.saveJob(state.company, job, adapter.id)) {
            events.emit('JOB_DISCOVERED', 'info', `${job.title} — ${state.company.name}`, {
              adapter: adapter.id,
              companyId: state.company.id,
              url: job.url,
            });
          }
        }
      } catch (thrown) {
        recordFailure(normaliseSourceError(adapter.id, thrown));
      }
    }
  };

  const identifyPeople = async (state: CompanyState): Promise<void> => {
    for (const adapter of peopleSources) {
      if (state.validated >= PEOPLE_PER_COMPANY || stopCheck()) return;
      if (health.isDisabled(adapter.id)) continue;
      try {
        for await (const raw of adapter.discoverPeople(ctx, state.company)) {
          handleCandidate(raw, adapter, state);
          if (stopCheck() || state.validated >= PEOPLE_PER_COMPANY) break;
        }
      } catch (thrown) {
        recordFailure(normaliseSourceError(adapter.id, thrown));
      }
    }
  };

  const failedRuns = new Set<string>();
  for (const adapter of companySources) {
    const early = stopCheck();
    if (early) return finishStopped(early);
    if (health.isDisabled(adapter.id)) continue;
    try {
      for await (const raw of adapter.discoverCompanies(ctx)) {
        const stop = stopCheck();
        if (stop) return finishStopped(stop);
        const parsed = CompanyCandidate.safeParse(raw);
        if (!parsed.success) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id} returned an invalid company candidate`, {
            adapter: adapter.id,
            issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          });
          continue;
        }
        const candidate = {
          ...parsed.data,
          evidence: parsed.data.evidence.filter((e) => valueInSnippet(e.value, e.snippet)),
        };
        if (!candidate.evidence.some((e) => e.field === 'name')) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id}: company name not in its snippet`, {
            adapter: adapter.id,
            name: candidate.name,
          });
          continue;
        }
        const company = store.upsertCompany(candidate, adapter.id);
        let state = companies.get(company.id);
        const isNew = !state;
        if (!state) {
          state = { company, hasPosting: false, validated: 0 };
          companies.set(company.id, state);
        }
        const postings = store.savePostings(company, candidate, adapter.id);
        if (postings > 0) state.hasPosting = true;
        if (isNew) {
          events.emit('COMPANY_DISCOVERED', 'info', `${company.name}${company.isAgency ? ' (agency)' : ''}`, {
            adapter: adapter.id,
            companyId: company.id,
            domain: company.domain,
            sourceUrl: candidate.evidence[0]?.sourceUrl,
          });
        }
        for (const p of candidate.postings) {
          events.emit('JOB_DISCOVERED', 'info', `${p.title} — ${company.name}`, { companyId: company.id, url: p.url });
        }
        if (isNew) {
          await enrichCompany(state);
          await discoverJobs(state);
          await identifyPeople(state);
          events.emit(
            'PROGRESS',
            'info',
            `${validated} / ${request.targetCount} contacts · ${companies.size} companies · ${budget.spent().httpRequests} requests`,
            { validatedContacts: validated, leads: leads(), companies: companies.size, budgetSpent: budget.spent() },
          );
          budgetWarnings();
        }
      }
    } catch (thrown) {
      failedRuns.add(adapter.id);
      recordFailure(normaliseSourceError(adapter.id, thrown));
    }
  }

  const final = stopCheck();
  if (final) return finishStopped(final);
  // A source that broke after yielding contacts still produced a usable result.
  if (validated === 0 && companySources.every((a) => health.isDisabled(a.id) || failedRuns.has(a.id))) {
    return finish('failed', 'all_sources_failed');
  }
  return finish('completed', 'sources_exhausted');
}
