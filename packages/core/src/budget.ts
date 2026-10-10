import type { BudgetSpent } from '@scrapjob/schema/api';

export interface BudgetLimits {
  maxDurationMs: number;
  maxHttpRequests: number;
  maxSearchApiCalls: number;
}

export type BudgetStopReason =
  | 'duration_exhausted'
  | 'http_budget_exhausted'
  | 'search_api_budget_exhausted'
  | 'deep_search_budget_exhausted';

/** Tracks what a search has spent against its limits. */
export class Budget {
  private httpRequests = 0;
  private searchApiCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly now: () => number = Date.now,
    /** Deep search: page fetches and search-API calls share one request cap. */
    private readonly combinedLimit: number | null = null,
  ) {
    this.startedAt = now();
  }

  /** One contact's deep search: `MAX_DEEP_SEARCH_REQUESTS` covers every outbound request. */
  static forDeepSearch(maxRequests: number, maxDurationMs: number, now: () => number = Date.now): Budget {
    return new Budget({ maxDurationMs, maxHttpRequests: maxRequests, maxSearchApiCalls: maxRequests }, now, maxRequests);
  }

  spendHttpRequest(): void {
    this.httpRequests += 1;
  }

  spendSearchApiCall(): void {
    this.searchApiCalls += 1;
  }

  exhausted(): BudgetStopReason | null {
    if (this.now() - this.startedAt >= this.limits.maxDurationMs) return 'duration_exhausted';
    if (this.combinedLimit !== null) {
      return this.httpRequests + this.searchApiCalls >= this.combinedLimit ? 'deep_search_budget_exhausted' : null;
    }
    if (this.httpRequests >= this.limits.maxHttpRequests) return 'http_budget_exhausted';
    if (this.searchApiCalls >= this.limits.maxSearchApiCalls) return 'search_api_budget_exhausted';
    return null;
  }

  spent(): BudgetSpent {
    return {
      httpRequests: this.httpRequests,
      searchApiCalls: this.searchApiCalls,
      deepSearchRequests: this.combinedLimit === null ? 0 : this.httpRequests + this.searchApiCalls,
      elapsedMs: Math.max(0, this.now() - this.startedAt),
    };
  }
}
