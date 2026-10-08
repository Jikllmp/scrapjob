import { CompanyCandidate } from '@scrapjob/schema/candidates';
import type { BudgetSpent } from '@scrapjob/schema/api';
import { Budget, type BudgetLimits, type BudgetStopReason } from './budget';
import { normaliseSourceError, type SourceError } from './adapters/errors';
import { SourceHealth } from './adapters/registry';
import { isDiscoveryCapable, type EventSink, type SearchContext, type SourceAdapter } from './adapters/types';

export interface SearchRequest {
  searchId: string;
  location: string;
  position: string;
  targetCount: number;
}

export interface OrchestratorOptions {
  adapters: readonly SourceAdapter[];
  events: EventSink;
  limits: BudgetLimits;
  sourceFailureThreshold: number;
  signal: AbortSignal;
  now?: () => number;
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
  no_source_available: 'no discovery-capable source is available',
  cancelled: 'cancelled by the user',
};

/**
 * Runs one search. Phase 1 runs company discovery only; later phases add the
 * job, people, extraction, dedup and scoring stages to the same loop.
 */
export async function runSearch(request: SearchRequest, options: OrchestratorOptions): Promise<SearchOutcome> {
  const { events, signal } = options;
  const budget = new Budget(options.limits, options.now);
  const health = new SourceHealth(options.sourceFailureThreshold);
  const ctx: SearchContext = { ...request, signal, budget, events };
  let companies = 0;
  const validatedContacts = 0;

  const finish = (status: SearchOutcome['status'], stopReason: StopReason): SearchOutcome => {
    const message = `${validatedContacts} / ${request.targetCount} contacts — stopped: ${stopReasonText[stopReason]}`;
    return { status, stopReason, message, validatedContacts, companies, budgetSpent: budget.spent() };
  };

  const stopCheck = (): StopReason | null => {
    if (signal.aborted) return 'cancelled';
    if (validatedContacts >= request.targetCount) return 'target_reached';
    return budget.exhausted();
  };

  const recordFailure = (error: SourceError): void => {
    events.emit('WARNING', 'warn', `${error.adapter}: ${error.kind}: ${error.message}`, { error });
    if (health.recordFailure(error.adapter)) {
      events.emit('SOURCE_DISABLED', 'warn', `${error.adapter} disabled for this search after repeated failures`, {
        adapter: error.adapter,
        failures: health.failureCount(error.adapter),
      });
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
      events.emit('SOURCE_DISABLED', 'warn', `${adapter.displayName} is not available`, { adapter: adapter.id });
    }
  }

  const discovery = live.filter(isDiscoveryCapable);
  const failedRuns = new Set<string>();
  if (discovery.length === 0) return finish('failed', 'no_source_available');

  for (const adapter of discovery.filter((a) => a.capabilities.has('companies'))) {
    const early = stopCheck();
    if (early) return finish(early === 'cancelled' ? 'cancelled' : 'completed', early);
    if (health.isDisabled(adapter.id)) continue;
    try {
      for await (const raw of adapter.discoverCompanies(ctx)) {
        const stop = stopCheck();
        if (stop) return finish(stop === 'cancelled' ? 'cancelled' : 'completed', stop);
        const parsed = CompanyCandidate.safeParse(raw);
        if (!parsed.success) {
          events.emit('EXTRACTION_REJECTED', 'warn', `${adapter.id} returned an invalid company candidate`, {
            adapter: adapter.id,
            issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          });
          continue;
        }
        companies += 1;
        events.emit('COMPANY_DISCOVERED', 'info', parsed.data.name, {
          adapter: adapter.id,
          sourceUrl: parsed.data.evidence[0]?.sourceUrl,
        });
      }
    } catch (thrown) {
      failedRuns.add(adapter.id);
      recordFailure(normaliseSourceError(adapter.id, thrown));
    }
  }

  if (signal.aborted) return finish('cancelled', 'cancelled');
  if (discovery.every((a) => health.isDisabled(a.id) || failedRuns.has(a.id))) return finish('failed', 'all_sources_failed');
  return finish('completed', 'sources_exhausted');
}
