import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { runDeepSearch, type AdapterRegistry, type EventSink, type Taxonomy } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config';
import { loadStoredContact } from '../contacts/draft';
import type { DrizzlePipelineStore } from '../contacts/store';
import type { Db } from '../db/client';
import type { EventStore } from '../events/store';

const { contacts, deepSearches, searches } = tables;

export type StartResult = { ok: true; deepSearchId: string } | { ok: false; reason: 'not_found' | 'search_running' | 'already_running' };

/**
 * In-process worker for per-contact deep searches, one at a time. Its events
 * go to the contact's search stream, tagged with the deep search id.
 */
export class DeepSearchRunner {
  private readonly queue: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private active: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly events: EventStore,
    private readonly registry: AdapterRegistry,
    private readonly store: DrizzlePipelineStore,
    private readonly taxonomy: Taxonomy,
    private readonly config: Config,
    private readonly log: FastifyBaseLogger,
  ) {}

  start(contactId: string): StartResult {
    const row = this.db
      .select({ status: contacts.status, searchStatus: searches.status })
      .from(contacts)
      .innerJoin(searches, eq(searches.id, contacts.searchId))
      .where(eq(contacts.id, contactId))
      .get();
    if (!row || row.status !== 'validated') return { ok: false, reason: 'not_found' };
    if (row.searchStatus === 'queued' || row.searchStatus === 'running') return { ok: false, reason: 'search_running' };
    const pending = this.db
      .select({ id: deepSearches.id })
      .from(deepSearches)
      .where(eq(deepSearches.contactId, contactId))
      .all()
      .some((d) => this.queue.includes(d.id) || this.controllers.has(d.id));
    if (pending) return { ok: false, reason: 'already_running' };
    const id = randomUUID();
    this.db.insert(deepSearches).values({ id, contactId, status: 'queued', createdAt: new Date().toISOString() }).run();
    this.queue.push(id);
    this.pump();
    return { ok: true, deepSearchId: id };
  }

  /** Deep searches left queued or running by a stopped server are run again. */
  resumeInterrupted(): number {
    const pending = this.db
      .select({ id: deepSearches.id })
      .from(deepSearches)
      .where(inArray(deepSearches.status, ['queued', 'running']))
      .orderBy(deepSearches.createdAt)
      .all();
    for (const { id } of pending) {
      this.db.update(deepSearches).set({ status: 'queued' }).where(eq(deepSearches.id, id)).run();
      this.queue.push(id);
    }
    this.pump();
    return pending.length;
  }

  async idle(): Promise<void> {
    while (this.active) await this.active;
  }

  async shutdown(): Promise<void> {
    this.queue.length = 0;
    for (const c of this.controllers.values()) c.abort();
    await this.idle();
  }

  private pump(): void {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = this.run(next)
      .catch((err: unknown) => {
        this.log.error({ err, deepSearchId: next }, 'deep search crashed');
        this.db
          .update(deepSearches)
          .set({ status: 'failed', message: 'Internal error; see the server log', finishedAt: new Date().toISOString() })
          .where(eq(deepSearches.id, next))
          .run();
      })
      .finally(() => {
        this.active = null;
        this.pump();
      });
  }

  private async run(id: string): Promise<void> {
    const row = this.db.select().from(deepSearches).where(eq(deepSearches.id, id)).get();
    if (!row) return;
    const stored = loadStoredContact(this.db, row.contactId, this.taxonomy);
    if (!stored) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.db.update(deepSearches).set({ status: 'running', startedAt: new Date().toISOString() }).where(eq(deepSearches.id, id)).run();
    const sink = this.events.sinkFor(stored.search.id);
    const events: EventSink = { emit: (type, level, message, metadata) => sink.emit(type, level, message, { ...metadata, deepSearchId: id }) };
    try {
      const outcome = await runDeepSearch(
        {
          deepSearchId: id,
          contactId: row.contactId,
          location: stored.search.location,
          position: stored.search.position,
          draft: stored.draft,
          company: stored.company,
          hasPosting: stored.hasPosting,
        },
        {
          adapters: this.registry.enabled(),
          events,
          store: this.store,
          taxonomy: this.taxonomy,
          maxRequests: this.config.MAX_DEEP_SEARCH_REQUESTS,
          maxDurationMs: this.config.MAX_SEARCH_DURATION_MS,
          signal: controller.signal,
        },
      );
      this.db
        .update(deepSearches)
        .set({
          status: outcome.status,
          message: outcome.message,
          fieldsBefore: outcome.before,
          fieldsAfter: outcome.after,
          changes: outcome.changes,
          requestsSpent: outcome.budgetSpent.deepSearchRequests,
          finishedAt: new Date().toISOString(),
        })
        .where(eq(deepSearches.id, id))
        .run();
    } finally {
      this.controllers.delete(id);
    }
  }
}
