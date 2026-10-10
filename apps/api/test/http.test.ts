import { describe, expect, it } from 'vitest';
import { SourceFailure } from '@scrapjob/core';
import { HttpClient } from '../src/http/client';
import { TransportTimeout, type Transport, type TransportResponse } from '../src/http/transport';
import { virtualClock } from './fixtures/transport';
import { searchContext } from './context';

type Handler = (url: string) => Partial<TransportResponse> & { status: number };

function client(handler: Handler, extra: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  const clock = virtualClock();
  const seen: { url: string; at: number; headers: Record<string, string> }[] = [];
  const transport: Transport = async (req) => {
    seen.push({ url: req.url, at: clock.now(), headers: req.headers });
    const res = handler(req.url);
    return { url: req.url, headers: {}, body: '', ...res };
  };
  const http = new HttpClient({
    transport,
    contactUrl: 'https://example.org/scrapjob-bot',
    perHostRps: 1,
    maxConcurrent: 4,
    timeoutMs: 1000,
    retryCount: 3,
    random: () => 0,
    ...clock,
    ...extra,
  });
  return { http, seen, clock };
}

async function failureOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof SourceFailure) return err.error;
    throw err;
  }
  throw new Error('expected a SourceFailure');
}

const ok: Handler = (url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: 200, body: '<p>hi</p>' });

describe('HttpClient', () => {
  it('sends an identifiable User-Agent with the contact URL', async () => {
    const { http, seen } = client(ok);
    await http.get('https://a.test/page', { adapter: 't', ctx: searchContext().ctx });
    expect(seen.every((r) => r.headers['user-agent'] === 'ScrapJob/0.2 (+https://example.org/scrapjob-bot)')).toBe(true);
  });

  it('reads robots.txt once per host, before the first page', async () => {
    const { http, seen } = client(ok);
    const { ctx } = searchContext();
    await http.get('https://a.test/1', { adapter: 't', ctx });
    await http.get('https://a.test/2', { adapter: 't', ctx });
    expect(seen.map((r) => r.url)).toEqual(['https://a.test/robots.txt', 'https://a.test/1', 'https://a.test/2']);
  });

  it('skips a disallowed path and logs ROBOTS_DISALLOWED', async () => {
    const { http, seen } = client((url) =>
      url.endsWith('/robots.txt') ? { status: 200, body: 'User-agent: *\nDisallow: /private' } : { status: 200 },
    );
    const { ctx, events } = searchContext();
    const error = await failureOf(http.get('https://a.test/private/team', { adapter: 't', ctx }));
    expect(error).toMatchObject({ kind: 'RobotsDisallowed', retryable: false });
    expect(seen.map((r) => r.url)).toEqual(['https://a.test/robots.txt']);
    expect(events.map((e) => e.type)).toEqual(['ROBOTS_DISALLOWED']);
  });

  it('honours a rule written for ScrapJob specifically', async () => {
    const { http } = client((url) =>
      url.endsWith('/robots.txt') ? { status: 200, body: 'User-agent: ScrapJob\nDisallow: /\n\nUser-agent: *\nAllow: /' } : { status: 200 },
    );
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx }))).toMatchObject({ kind: 'RobotsDisallowed' });
  });

  it('treats a robots.txt server error as "disallow everything"', async () => {
    const { http } = client((url) => (url.endsWith('/robots.txt') ? { status: 503 } : { status: 200 }));
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx }))).toMatchObject({ kind: 'RobotsDisallowed' });
  });

  it('respects X-Robots-Tag: noindex', async () => {
    const { http } = client((url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: 200, headers: { 'x-robots-tag': 'noindex' } }));
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx }))).toMatchObject({ kind: 'RobotsDisallowed' });
  });

  it('retries 5xx three times with backoff, then gives up', async () => {
    const { http, seen } = client((url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: 502 }));
    const error = await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx }));
    expect(error).toMatchObject({ kind: 'SourceUnavailable', message: 'HTTP 502' });
    const attempts = seen.filter((r) => r.url === 'https://a.test/x');
    expect(attempts).toHaveLength(4);
    const gaps = attempts.slice(1).map((r, i) => r.at - attempts[i]!.at);
    expect(gaps[1]).toBeGreaterThan(gaps[0]!);
  });

  it('retries timeouts and reports Timeout', async () => {
    const clock = virtualClock();
    let calls = 0;
    const http = new HttpClient({
      transport: async (req) => {
        if (req.url.endsWith('/robots.txt')) return { status: 404, url: req.url, headers: {}, body: '' };
        calls += 1;
        throw new TransportTimeout('slow');
      },
      contactUrl: 'https://example.org',
      perHostRps: 1,
      maxConcurrent: 4,
      timeoutMs: 1000,
      retryCount: 3,
      ...clock,
    });
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx }))).toMatchObject({ kind: 'Timeout', retryable: true });
    expect(calls).toBe(4);
  });

  it('never retries a 4xx, and returns 404 to the caller', async () => {
    const { http, seen } = client((url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: 404 }));
    const res = await http.get('https://a.test/missing', { adapter: 't', ctx: searchContext().ctx });
    expect(res.status).toBe(404);
    expect(seen.filter((r) => r.url === 'https://a.test/missing')).toHaveLength(1);
  });

  it.each([429, 403])('backs off on %i and reports RateLimited without retrying', async (status) => {
    const { http, seen, clock } = client((url) =>
      url.endsWith('/robots.txt') ? { status: 404 } : url.endsWith('/x') ? { status, headers: { 'retry-after': '30' } } : { status: 200 },
    );
    const { ctx, events } = searchContext();
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx }))).toMatchObject({ kind: 'RateLimited', retryable: false });
    expect(events.map((e) => e.type)).toEqual(['RATE_LIMITED']);
    const before = clock.now();
    await http.get('https://a.test/y', { adapter: 't', ctx });
    expect(seen.at(-1)!.at - before).toBeGreaterThanOrEqual(30_000);
  });

  it('limits each host to about one request per second after a burst of three', async () => {
    const { http, seen } = client(ok);
    const { ctx } = searchContext();
    for (const n of [1, 2, 3, 4, 5]) await http.get(`https://a.test/${n}`, { adapter: 't', ctx });
    const times = seen.map((r) => r.at);
    expect(times.at(-1)! - times[0]!).toBeGreaterThanOrEqual(2900);
  });

  it('counts every request against the budget and stops when it is spent', async () => {
    const { http } = client(ok);
    const { ctx, budget } = searchContext({ maxHttpRequests: 3 });
    await http.get('https://a.test/1', { adapter: 't', ctx });
    await http.get('https://a.test/2', { adapter: 't', ctx });
    expect(budget.spent().httpRequests).toBe(3);
    expect(await failureOf(http.get('https://a.test/3', { adapter: 't', ctx }))).toMatchObject({ kind: 'QuotaExceeded' });
  });

  it('counts search API calls separately and skips robots for them', async () => {
    const { http, seen } = client(() => ({ status: 200, body: '{}' }));
    const { ctx, budget } = searchContext();
    await http.get('https://api.search.test/q', { adapter: 't', ctx, robots: false, budget: 'search_api' });
    expect(seen.map((r) => r.url)).toEqual(['https://api.search.test/q']);
    expect(budget.spent()).toMatchObject({ httpRequests: 0, searchApiCalls: 1 });
  });

  it('opens a circuit breaker after 5 consecutive failures on a host, for this search only', async () => {
    const { http, seen } = client((url) =>
      url.endsWith('/robots.txt') ? { status: 404 } : url.startsWith('https://down.test') ? { status: 503 } : { status: 200 },
      { retryCount: 0 },
    );
    const { ctx, events } = searchContext();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(await failureOf(http.get(`https://down.test/${n}`, { adapter: 't', ctx }))).toMatchObject({ kind: 'SourceUnavailable' });
    }
    expect(events.filter((e) => e.type === 'WARNING')).toHaveLength(1);
    expect(events.at(-1)?.metadata).toMatchObject({ host: 'down.test', circuitBreaker: 'open' });

    const calls = seen.length;
    expect(await failureOf(http.get('https://down.test/6', { adapter: 't', ctx }))).toMatchObject({
      message: 'down.test failed repeatedly; skipped for this search',
    });
    expect(seen).toHaveLength(calls);
    expect((await http.get('https://up.test/1', { adapter: 't', ctx })).status).toBe(200);

    const next = searchContext();
    await failureOf(http.get('https://down.test/7', { adapter: 't', ctx: next.ctx }));
    expect(seen.at(-1)?.url).toBe('https://down.test/7');
  });

  it('resets the failure streak after a success', async () => {
    let failing = true;
    const { http } = client((url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: failing ? 503 : 200 }), { retryCount: 0 });
    const { ctx, events } = searchContext();
    for (const n of [1, 2, 3, 4]) await failureOf(http.get(`https://a.test/${n}`, { adapter: 't', ctx }));
    failing = false;
    await http.get('https://a.test/ok', { adapter: 't', ctx });
    failing = true;
    for (const n of [5, 6, 7, 8]) await failureOf(http.get(`https://a.test/${n}`, { adapter: 't', ctx }));
    expect(events.filter((e) => e.type === 'WARNING')).toHaveLength(0);
  });

  it('turns a network error into SourceUnavailable without retrying', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNRESET');
    };
    const { http } = client(ok, { transport });
    expect(await failureOf(http.get('https://a.test/x', { adapter: 't', ctx: searchContext().ctx, robots: false }))).toMatchObject({
      kind: 'SourceUnavailable',
      message: 'ECONNRESET',
    });
  });

  it('re-reads robots.txt after 24 hours', async () => {
    const { http, seen, clock } = client(ok);
    const { ctx } = searchContext();
    await http.get('https://a.test/1', { adapter: 't', ctx });
    await clock.sleep(24 * 60 * 60 * 1000);
    await http.get('https://a.test/2', { adapter: 't', ctx });
    expect(seen.filter((r) => r.url.endsWith('/robots.txt'))).toHaveLength(2);
  });
});
