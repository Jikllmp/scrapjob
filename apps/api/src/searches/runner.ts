import { eq, inArray } from 'drizzle-orm';
import { tables } from '@scrapjob/schema';
import { runSearch, type AdapterRegistry, type PipelineStore, type SearchOutcome, type Taxonomy } from '@scrapjob/core';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import type { EventStore } from '../events/store';

const { searches } = tables;

/**
 * In-process worker over the persisted `searches` table. Runs one search at a
 * time. A search left `running` by a crash is re-queued at boot and run again.
 */
export class SearchRunner {
  private readonly queue: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private active: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly events: EventStore,
    private readonly registry: AdapterRegistry,
    private readonly store: PipelineStore,
    private readonly taxonomy: Taxonomy,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  enqueue(searchId: string): void {
    this.queue.push(searchId);
    this.pump();
  }

  /** Re-queues searches that were queued or running when the process stopped. */
  resumeInterrupted(): number {
    const pending = this.db
      .select({ id: searches.id, status: searches.status })
      .from(searches)
      .where(inArray(searches.status, ['queued', 'running']))
      .orderBy(searches.createdAt)
      .all();
    for (const { id, status } of pending) {
      if (status === 'running') {
        this.db.update(searches).set({ status: 'queued' }).where(eq(searches.id, id)).run();
        this.events.append(id, 'WARNING', 'warn', 'The server restarted during this search; running it again');
      }
      this.queue.push(id);
    }
    this.pump();
    return pending.length;
  }

  /** Returns true if the search was queued or running and is now cancelled or cancelling. */
  cancel(searchId: string): boolean {
    const controller = this.controllers.get(searchId);
    if (controller) {
      controller.abort();
      return true;
    }
    const index = this.queue.indexOf(searchId);
    if (index === -1) return false;
    this.queue.splice(index, 1);
    this.finish(searchId, {
      status: 'cancelled',
      stopReason: 'cancelled',
      message: 'Cancelled before it started',
      validatedContacts: 0,
      leads: 0,
      companies: 0,
      budgetSpent: { httpRequests: 0, searchApiCalls: 0, deepSearchRequests: 0, elapsedMs: 0 },
    });
    return true;
  }

  /** Resolves once the queue is empty. */
  async idle(): Promise<void> {
    while (this.active) await this.active;
  }

  async shutdown(): Promise<void> {
    this.queue.length = 0;
    for (const controller of this.controllers.values()) controller.abort();
    await this.idle();
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = this.run(next)
      .catch((err: unknown) => this.log.error({ err, searchId: next }, 'search runner crashed'))
      .finally(() => {
        this.active = null;
        this.pump();
      });
  }

  private async run(searchId: string): Promise<void> {
    const search = this.db.select().from(searches).where(eq(searches.id, searchId)).get();
    if (!search || search.status !== 'queued') return;
    const controller = new AbortController();
    this.controllers.set(searchId, controller);
    this.db
      .update(searches)
      .set({ status: 'running', startedAt: new Date().toISOString() })
      .where(eq(searches.id, searchId))
      .run();
    try {
      const outcome = await runSearch(
        { searchId, location: search.location, position: search.position, targetCount: search.targetCount },
        {
          adapters: this.registry.enabled(),
          events: this.events.sinkFor(searchId),
          store: this.store,
          taxonomy: this.taxonomy,
          minRelevanceScore: this.config.MIN_RELEVANCE_SCORE,
          limits: {
            maxDurationMs: this.config.MAX_SEARCH_DURATION_MS,
            maxHttpRequests: this.config.MAX_HTTP_REQUESTS,
            maxSearchApiCalls: this.config.MAX_SEARCH_API_CALLS,
          },
          sourceFailureThreshold: this.config.SOURCE_FAILURE_THRESHOLD,
          signal: controller.signal,
        },
      );
      this.finish(searchId, outcome);
    } catch (err) {
      this.log.error({ err, searchId }, 'search failed unexpectedly');
      this.db
        .update(searches)
        .set({ status: 'failed', finishedAt: new Date().toISOString(), error: 'Internal error; see the server log' })
        .where(eq(searches.id, searchId))
        .run();
      this.events.append(searchId, 'SEARCH_FAILED', 'error', 'The search stopped because of an internal error');
    } finally {
      this.controllers.delete(searchId);
    }
  }

  private finish(searchId: string, outcome: SearchOutcome): void {
    this.db
      .update(searches)
      .set({
        status: outcome.status,
        stopReason: outcome.stopReason,
        budgetSpent: outcome.budgetSpent,
        finishedAt: new Date().toISOString(),
        error: outcome.status === 'failed' ? outcome.message : null,
      })
      .where(eq(searches.id, searchId))
      .run();
    const type =
      outcome.status === 'completed'
        ? 'SEARCH_COMPLETED'
        : outcome.status === 'failed'
          ? 'SEARCH_FAILED'
          : 'SEARCH_CANCELLED';
    const level = outcome.status === 'failed' ? 'error' : 'info';
    this.events.append(searchId, type, level, outcome.message, {
      stopReason: outcome.stopReason,
      validatedContacts: outcome.validatedContacts,
      leads: outcome.leads,
      companies: outcome.companies,
      budgetSpent: outcome.budgetSpent,
    });
  }
}
