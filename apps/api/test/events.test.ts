import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { tables } from '@scrapjob/schema';
import type { SearchEventDto } from '@scrapjob/schema/api';
import type { BuiltApp } from '../src/app';
import { testApp } from './helpers';

let built: BuiltApp;
afterEach(async () => built?.app.close());

function seedSearch(): string {
  const id = randomUUID();
  // A finished search, so the runner does not touch it.
  built.ctx.db.insert(tables.searches).values({ id, location: 'Charleroi', position: '.NET', status: 'completed' }).run();
  return id;
}

/** Opens the SSE stream and collects events until `count` have arrived. */
async function readEvents(
  url: string,
  count: number,
  headers: Record<string, string> = {},
  onOpen?: () => void,
): Promise<SearchEventDto[]> {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  onOpen?.();
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const received: SearchEventDto[] = [];
  let buffer = '';
  while (received.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block.split('\n').find((l) => l.startsWith('data: '));
      const id = block.split('\n').find((l) => l.startsWith('id: '));
      if (data) {
        const event = JSON.parse(data.slice(6)) as SearchEventDto;
        expect(id).toBe(`id: ${event.seq}`);
        received.push(event);
      }
    }
  }
  controller.abort();
  return received;
}

async function listen(): Promise<string> {
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(built.app.server.address() as AddressInfo).port}`;
}

describe('EventStore', () => {
  it('assigns a monotonic seq per search', () => {
    built = testApp();
    const a = seedSearch();
    const b = seedSearch();
    built.ctx.events.append(a, 'PROGRESS', 'info', 'one');
    built.ctx.events.append(b, 'PROGRESS', 'info', 'other search');
    built.ctx.events.append(a, 'PROGRESS', 'info', 'two');
    expect(built.ctx.events.listAfter(a).map((e) => [e.seq, e.message])).toEqual([
      [1, 'one'],
      [2, 'two'],
    ]);
    expect(built.ctx.events.listAfter(a, 1).map((e) => e.message)).toEqual(['two']);
  });
});

describe('GET /api/searches/:id/events', () => {
  it('replays exactly the events after Last-Event-ID', async () => {
    built = testApp();
    const id = seedSearch();
    for (const n of [1, 2, 3, 4, 5]) built.ctx.events.append(id, 'PROGRESS', 'info', `event ${n}`);
    const base = await listen();
    const events = await readEvents(`${base}/api/searches/${id}/events`, 2, { 'last-event-id': '3' });
    expect(events.map((e) => e.seq)).toEqual([4, 5]);
  });

  it('accepts lastEventId as a query parameter', async () => {
    built = testApp();
    const id = seedSearch();
    for (const n of [1, 2]) built.ctx.events.append(id, 'PROGRESS', 'info', `event ${n}`);
    const base = await listen();
    const events = await readEvents(`${base}/api/searches/${id}/events?lastEventId=1`, 1);
    expect(events.map((e) => e.seq)).toEqual([2]);
  });

  it('streams live events after the replay without gaps or duplicates', async () => {
    built = testApp();
    const id = seedSearch();
    built.ctx.events.append(id, 'PROGRESS', 'info', 'before');
    const base = await listen();
    const events = await readEvents(`${base}/api/searches/${id}/events`, 3, {}, () => {
      built.ctx.events.append(id, 'PROGRESS', 'info', 'live 1');
      built.ctx.events.append(id, 'SEARCH_COMPLETED', 'info', 'done');
    });
    expect(events.map((e) => [e.seq, e.message])).toEqual([
      [1, 'before'],
      [2, 'live 1'],
      [3, 'done'],
    ]);
  });

  it('loses nothing across a dropped connection', async () => {
    built = testApp();
    const id = seedSearch();
    const base = await listen();
    built.ctx.events.append(id, 'PROGRESS', 'info', 'first');
    const firstBatch = await readEvents(`${base}/api/searches/${id}/events`, 1);
    // Connection dropped; the engine keeps writing.
    built.ctx.events.append(id, 'PROGRESS', 'info', 'missed 1');
    built.ctx.events.append(id, 'PROGRESS', 'info', 'missed 2');
    const lastSeen = String(firstBatch.at(-1)!.seq);
    const resumed = await readEvents(`${base}/api/searches/${id}/events`, 2, { 'last-event-id': lastSeen });
    expect([...firstBatch, ...resumed].map((e) => e.message)).toEqual(['first', 'missed 1', 'missed 2']);
  });

  it('returns a 404 problem for an unknown search', async () => {
    built = testApp();
    const res = await built.app.inject({ url: '/api/searches/missing/events' });
    expect(res.statusCode).toBe(404);
  });
});
