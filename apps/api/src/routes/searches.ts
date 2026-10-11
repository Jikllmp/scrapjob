import { randomUUID } from 'node:crypto';
import { count, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { tables } from '@scrapjob/schema';
import {
  CreateSearchBody,
  CreateSearchResponse,
  ListSearchesQuery,
  SearchDto,
  SearchIdParams,
  SearchListDto,
} from '@scrapjob/schema/api';
import type { AppContext } from '../context';
import { HttpProblem, parseOr400 } from '../problem';
import { purgeSearch } from '../privacy/purge';

const { searches, searchEvents, contacts, companies } = tables;

type SearchRow = typeof searches.$inferSelect;

export function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, runner, config } = ctx;

  const toDto = (row: SearchRow): SearchDto => {
    const events = db.select({ n: count() }).from(searchEvents).where(eq(searchEvents.searchId, row.id)).get();
    const validated = db
      .select({ n: count() })
      .from(contacts)
      .where(sql`${contacts.searchId} = ${row.id} AND ${contacts.status} = 'validated'`)
      .get();
    const companyCount = db
      .select({ n: sql<number>`count(distinct ${contacts.companyId})` })
      .from(contacts)
      .innerJoin(companies, eq(companies.id, contacts.companyId))
      .where(eq(contacts.searchId, row.id))
      .get();
    return SearchDto.parse({
      ...row,
      counters: { events: events?.n ?? 0, contactsValidated: validated?.n ?? 0, companies: companyCount?.n ?? 0 },
    });
  };

  const findOr404 = (id: string): SearchRow => {
    const row = db.select().from(searches).where(eq(searches.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Search not found', `No search with id ${id}.`);
    return row;
  };

  app.post('/api/searches', async (request, reply) => {
    const body = parseOr400(CreateSearchBody, request.body, 'request body');
    const targetCount = Math.min(body.targetCount ?? 20, config.MAX_CONTACTS_PER_SEARCH);
    const id = randomUUID();
    db.insert(searches).values({ id, location: body.location, position: body.position, targetCount }).run();
    runner.enqueue(id);
    return reply.status(201).send(CreateSearchResponse.parse({ searchId: id }));
  });

  app.get('/api/searches', async (request) => {
    const query = parseOr400(ListSearchesQuery, request.query, 'query string');
    const rows = db
      .select()
      .from(searches)
      .orderBy(desc(searches.createdAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    const total = db.select({ n: count() }).from(searches).get()?.n ?? 0;
    return SearchListDto.parse({ items: rows.map(toDto), total, limit: query.limit, offset: query.offset });
  });

  app.get('/api/searches/:id', async (request) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    return toDto(findOr404(id));
  });

  /** Stops a queued or running search. Never deletes anything, unlike DELETE. */
  app.post('/api/searches/:id/cancel', async (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const row = findOr404(id);
    if (row.status !== 'queued' && row.status !== 'running') {
      throw new HttpProblem(409, 'Search is not running', `Search ${id} is already ${row.status}.`);
    }
    runner.cancel(id);
    return reply.status(202).send();
  });

  app.delete('/api/searches/:id', async (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const row = findOr404(id);
    if (row.status === 'queued' || row.status === 'running') {
      runner.cancel(id);
      return reply.status(202).send();
    }
    purgeSearch(db, id, (path, err) => request.log.warn({ path, err }, 'could not delete a spreadsheet of this search; delete it by hand'));
    return reply.status(204).send();
  });
}
