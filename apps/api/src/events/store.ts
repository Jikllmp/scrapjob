import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { tables, type EventLevel, type EventType } from '@scrapjob/schema';
import type { SearchEventDto } from '@scrapjob/schema/api';
import type { EventSink } from '@scrapjob/core';
import type { Db } from '../db/client';
import type { EventBus } from './bus';

const { searchEvents } = tables;

/** Persists an event first, then pushes it. `seq` is per search, monotonic, and doubles as the SSE id. */
export class EventStore {
  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly now: () => Date = () => new Date(),
  ) {}

  append(
    searchId: string,
    type: EventType,
    level: EventLevel,
    message: string,
    metadata: Record<string, unknown> = {},
  ): SearchEventDto {
    const event = this.db.transaction((tx) => {
      const row = tx
        .select({ max: sql<number | null>`max(${searchEvents.seq})` })
        .from(searchEvents)
        .where(eq(searchEvents.searchId, searchId))
        .get();
      const dto: SearchEventDto = {
        seq: (row?.max ?? 0) + 1,
        type,
        level,
        message,
        metadata,
        createdAt: this.now().toISOString(),
      };
      tx.insert(searchEvents)
        .values({ id: randomUUID(), searchId, ...dto })
        .run();
      return dto;
    });
    this.bus.publish(searchId, event);
    return event;
  }

  listAfter(searchId: string, afterSeq = 0): SearchEventDto[] {
    return this.db
      .select({
        seq: searchEvents.seq,
        type: searchEvents.type,
        level: searchEvents.level,
        message: searchEvents.message,
        metadata: searchEvents.metadata,
        createdAt: searchEvents.createdAt,
      })
      .from(searchEvents)
      .where(and(eq(searchEvents.searchId, searchId), gt(searchEvents.seq, afterSeq)))
      .orderBy(asc(searchEvents.seq))
      .all();
  }

  sinkFor(searchId: string): EventSink {
    return { emit: (type, level, message, metadata) => this.append(searchId, type, level, message, metadata) };
  }
}
