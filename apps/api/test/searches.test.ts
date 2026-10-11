import { afterEach, describe, expect, it } from 'vitest';
import { sourceFailure } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import type { BuiltApp } from '../src/app';
import { noopAdapter } from '../src/adapters/noop';
import { testApp } from './helpers';

let built: BuiltApp;
afterEach(async () => built?.app.close());

describe('search routes', () => {
  it('validates the body and answers with RFC 9457 problem details', async () => {
    built = testApp();
    const res = await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'C' } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const body = res.json();
    expect(body).toMatchObject({ status: 400, title: 'Invalid request', instance: '/api/searches' });
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['location', 'position']);
  });

  it('answers malformed JSON with a problem, not a crash', async () => {
    built = testApp();
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/searches',
      headers: { 'content-type': 'application/json' },
      payload: '{nope',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ status: 400 });
  });

  it('creates a search, runs it and records the outcome', async () => {
    built = testApp();
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/searches',
      payload: { location: 'Charleroi', position: 'Développeur .NET' },
    });
    expect(res.statusCode).toBe(201);
    const { searchId } = res.json();
    await built.ctx.runner.idle();

    const search = (await built.app.inject({ url: `/api/searches/${searchId}` })).json();
    expect(search).toMatchObject({
      location: 'Charleroi',
      position: 'Développeur .NET',
      targetCount: 20,
      status: 'completed',
      stopReason: 'sources_exhausted',
    });
    const types = built.ctx.events.listAfter(searchId).map((e) => e.type);
    expect(search.counters.events).toBe(types.length);
    expect(types.filter((t) => t !== 'QUERY_PLANNED')).toEqual(['SEARCH_STARTED', 'SOURCE_INITIALIZED', 'SEARCH_COMPLETED']);
  });

  it('clamps targetCount to MAX_CONTACTS_PER_SEARCH', async () => {
    built = testApp({ MAX_CONTACTS_PER_SEARCH: '10' });
    const res = await built.app.inject({
      method: 'POST',
      url: '/api/searches',
      payload: { location: 'Charleroi', position: '.NET', targetCount: 50 },
    });
    const search = (await built.app.inject({ url: `/api/searches/${res.json().searchId}` })).json();
    expect(search.targetCount).toBe(10);
  });

  it('marks a search failed with a message when every source fails', async () => {
    const broken = {
      ...noopAdapter,
      discoverCompanies: async function* () {
        throw sourceFailure('noop', 'SourceUnavailable', 'HTTP 503');
      },
    };
    built = testApp({}, [broken]);
    const res = await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Mons', position: 'QA' } });
    await built.ctx.runner.idle();
    const search = (await built.app.inject({ url: `/api/searches/${res.json().searchId}` })).json();
    expect(search.status).toBe('failed');
    expect(search.error).toBe('0 / 20 contacts — stopped: every source failed');
  });

  it('lists searches newest first with pagination', async () => {
    built = testApp();
    for (const location of ['Namur', 'Liège']) {
      await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location, position: 'Dev' } });
    }
    await built.ctx.runner.idle();
    const list = (await built.app.inject({ url: '/api/searches?limit=1' })).json();
    expect(list.total).toBe(2);
    expect(list.items).toHaveLength(1);
  });

  it('returns 404 problems for unknown searches and routes', async () => {
    built = testApp();
    expect((await built.app.inject({ url: '/api/searches/missing' })).statusCode).toBe(404);
    const res = await built.app.inject({ url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });

  it('deletes a finished search and its events', async () => {
    built = testApp();
    const { searchId } = (
      await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Namur', position: 'Dev' } })
    ).json();
    await built.ctx.runner.idle();
    expect((await built.app.inject({ method: 'DELETE', url: `/api/searches/${searchId}` })).statusCode).toBe(204);
    expect((await built.app.inject({ url: `/api/searches/${searchId}` })).statusCode).toBe(404);
    expect(built.ctx.events.listAfter(searchId)).toHaveLength(0);
  });

  it('cancels a running search', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = {
      ...noopAdapter,
      discoverCompanies: async function* () {
        await gate;
      },
    };
    built = testApp({}, [slow]);
    const { searchId } = (
      await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Namur', position: 'Dev' } })
    ).json();
    await new Promise((r) => setTimeout(r, 10));
    expect((await built.app.inject({ method: 'DELETE', url: `/api/searches/${searchId}` })).statusCode).toBe(202);
    release();
    await built.ctx.runner.idle();
    const search = (await built.app.inject({ url: `/api/searches/${searchId}` })).json();
    expect(search.status).toBe('cancelled');
  });
});

describe('cancel and shutdown', () => {
  function slowApp() {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = {
      ...noopAdapter,
      discoverCompanies: async function* () {
        await gate;
      },
    };
    return { app: testApp({}, [slow]), release };
  }

  it('cancels with POST …/cancel, and refuses to cancel a finished search instead of deleting it', async () => {
    const slow = slowApp();
    built = slow.app;
    const { searchId } = (await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Namur', position: 'Dev' } })).json();
    await new Promise((r) => setTimeout(r, 10));
    expect((await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/cancel` })).statusCode).toBe(202);
    slow.release();
    await built.ctx.runner.idle();
    const again = await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/cancel` });
    expect(again.statusCode).toBe(409);
    expect((await built.app.inject({ url: `/api/searches/${searchId}` })).json().status).toBe('cancelled');
  });

  it('leaves a running search running on shutdown, so the next start resumes it', async () => {
    const slow = slowApp();
    built = slow.app;
    const { searchId } = (await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Namur', position: 'Dev' } })).json();
    await new Promise((r) => setTimeout(r, 10));
    const closing = built.ctx.runner.shutdown();
    slow.release();
    await closing;
    const row = built.ctx.db.select().from(tables.searches).all().find((s) => s.id === searchId)!;
    expect(row.status).toBe('running');
    expect(built.ctx.events.listAfter(searchId).map((e) => e.type)).not.toContain('SEARCH_CANCELLED');
  });
});

describe('meta routes', () => {
  it('reports health and the source registry', async () => {
    built = testApp();
    expect((await built.app.inject({ url: '/api/health' })).json()).toEqual({ status: 'ok', version: '0.4.0' });
    const { items } = (await built.app.inject({ url: '/api/sources' })).json() as { items: Record<string, unknown>[] };
    expect(items.map((s) => [s.id, s.capabilities, s.enabled, s.available, s.unavailableReason])).toEqual([
      ['web-search', ['companies', 'enrich'], false, false, 'BRAVE_API_KEY is not set'],
      ['registry', ['enrich'], false, false, 'the business register is not imported yet (pnpm registry:import -- <folder>)'],
      ['job-board', ['jobs'], false, false, 'USER_AGENT_CONTACT_URL is not set, and no feed is read without one'],
      ['company-site', ['people', 'enrich'], false, false, 'USER_AGENT_CONTACT_URL is not set, and no site is crawled without one'],
      ['linkedin-public', ['people', 'enrich'], false, false, 'BRAVE_API_KEY is not set'],
      ['press-events', ['people'], false, false, 'BRAVE_API_KEY is not set'],
      ['noop', ['companies'], true, true, null],
    ]);
    expect(items.every((s) => s.contacts === 0 && s.lastSearch === null)).toBe(true);
  });

  it('reports what the privacy page needs', async () => {
    built = testApp({ DATA_RETENTION_DAYS: '90' });
    expect((await built.app.inject({ url: '/api/privacy' })).json()).toEqual({
      retentionDays: 90,
      contacts: 0,
      oldestCollectedAt: null,
      blocklistEntries: 0,
    });
  });
});

describe('SearchRunner', () => {
  it('re-runs a search left running by a crash, without re-emitting old events', async () => {
    built = testApp();
    const { db, events, runner } = built.ctx;
    db.insert(tables.searches).values({ id: 'crashed', location: 'Namur', position: 'Dev', status: 'running' }).run();
    events.append('crashed', 'SEARCH_STARTED', 'info', 'before the crash');

    expect(runner.resumeInterrupted()).toBe(1);
    await runner.idle();

    const log = events.listAfter('crashed');
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i + 1));
    expect(log[0]?.message).toBe('before the crash');
    expect(log[1]?.type).toBe('WARNING');
    expect(log.at(-1)?.type).toBe('SEARCH_COMPLETED');
  });
});
