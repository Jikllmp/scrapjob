import { desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tables } from '@scrapjob/schema';
import { HealthDto, PrivacyDto, SourceListDto, type SourceDto } from '@scrapjob/schema/api';
import type { AppContext } from '../context';

const { blocklist, contacts, evidence, searches, searchEvents } = tables;

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/health', async () => HealthDto.parse({ status: 'ok', version: ctx.version }));

  app.get('/api/privacy', async () => {
    const held = db.select({ n: sql<number>`count(*)`, oldest: sql<string | null>`min(${contacts.collectedAt})` }).from(contacts).get();
    const blocked = db.select({ n: sql<number>`count(*)` }).from(blocklist).get();
    return PrivacyDto.parse({
      retentionDays: ctx.config.DATA_RETENTION_DAYS,
      contacts: held?.n ?? 0,
      oldestCollectedAt: held?.oldest ?? null,
      blocklistEntries: blocked?.n ?? 0,
    });
  });

  /** The registry with each source's health: availability now, yield so far, and how it behaved in the last search. */
  app.get('/api/sources', async () => {
    const yields = new Map(
      db
        .select({ adapter: evidence.sourceAdapter, n: sql<number>`count(distinct ${evidence.contactId})` })
        .from(evidence)
        .where(isNotNull(evidence.contactId))
        .groupBy(evidence.sourceAdapter)
        .all()
        .map((r) => [r.adapter, r.n]),
    );
    const last = db.select().from(searches).where(isNotNull(searches.startedAt)).orderBy(desc(searches.createdAt)).limit(1).get();
    const lastEvents = last
      ? db
          .select({ type: searchEvents.type, message: searchEvents.message, metadata: searchEvents.metadata })
          .from(searchEvents)
          .where(eq(searchEvents.searchId, last.id))
          .all()
          .filter((e) => e.type === 'WARNING' || e.type === 'SOURCE_DISABLED')
      : [];

    const items = await Promise.all(
      ctx.registry.list().map(async ({ adapter, enabled }): Promise<SourceDto> => {
        let available = false;
        try {
          available = await adapter.isAvailable();
        } catch {
          available = false;
        }
        const warnings = lastEvents.filter(
          (e) => e.type === 'WARNING' && (e.metadata.error as { adapter?: string } | undefined)?.adapter === adapter.id,
        );
        return {
          id: adapter.id,
          displayName: adapter.displayName,
          capabilities: [...adapter.capabilities],
          enabled,
          available,
          unavailableReason: available ? null : (adapter.unavailableReason?.() ?? 'not available'),
          contacts: yields.get(adapter.id) ?? 0,
          lastSearch: last
            ? {
                searchId: last.id,
                createdAt: last.createdAt,
                failures: warnings.length,
                disabled: lastEvents.some((e) => e.type === 'SOURCE_DISABLED' && e.metadata.adapter === adapter.id),
                lastError: warnings.at(-1)?.message ?? null,
              }
            : null,
        };
      }),
    );
    return SourceListDto.parse({ items });
  });
}
