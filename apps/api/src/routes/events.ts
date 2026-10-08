import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tables } from '@scrapjob/schema';
import { SearchIdParams, type SearchEventDto } from '@scrapjob/schema/api';
import type { AppContext } from '../context';
import { HttpProblem, parseOr400 } from '../problem';

const { searches } = tables;

const LastEventId = z.coerce.number().int().min(0).catch(0);
const HEARTBEAT_MS = 15_000;

function frame(event: SearchEventDto): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * SSE stream of a search's events. Replays everything after `Last-Event-ID`
 * (header, or `lastEventId` query parameter), then streams live events.
 * The client closes the stream once it sees a terminal event.
 */
export function registerEventRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, bus, events } = ctx;

  app.get('/api/searches/:id/events', (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    if (!db.select({ id: searches.id }).from(searches).where(eq(searches.id, id)).get()) {
      throw new HttpProblem(404, 'Search not found', `No search with id ${id}.`);
    }
    const query = request.query as Record<string, unknown>;
    let lastSent = LastEventId.parse(request.headers['last-event-id'] ?? query.lastEventId);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 2000\n\n');

    const send = (event: SearchEventDto) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      raw.write(frame(event));
    };

    // Subscribe before replaying so nothing published during the replay is lost;
    // `send` drops anything already sent.
    const buffered: SearchEventDto[] = [];
    let replaying = true;
    const unsubscribe = bus.subscribe(id, (event) => (replaying ? buffered.push(event) : send(event)));
    for (const event of events.listAfter(id, lastSent)) send(event);
    replaying = false;
    for (const event of buffered) send(event);

    const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
