import type { BudgetSpent } from '@scrapjob/schema/api';

export interface BudgetLimits {
  maxDurationMs: number;
  maxHttpRequests: number;
  maxSearchApiCalls: number;
}

export type BudgetStopReason = 'duration_exhausted' | 'http_budget_exhausted' | 'search_api_budget_exhausted';

/** Tracks what a search has spent against its limits. */
export class Budget {
  private httpRequests = 0;
  private searchApiCalls = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  spendHttpRequest(): void {
    this.httpRequests += 1;
  }

  spendSearchApiCall(): void {
    this.searchApiCalls += 1;
  }

  exhausted(): BudgetStopReason | null {
    if (this.now() - this.startedAt >= this.limits.maxDurationMs) return 'duration_exhausted';
    if (this.httpRequests >= this.limits.maxHttpRequests) return 'http_budget_exhausted';
    if (this.searchApiCalls >= this.limits.maxSearchApiCalls) return 'search_api_budget_exhausted';
    return null;
  }

  spent(): BudgetSpent {
    return {
      httpRequests: this.httpRequests,
      searchApiCalls: this.searchApiCalls,
      deepSearchRequests: 0,
      elapsedMs: Math.max(0, this.now() - this.startedAt),
    };
  }
}
