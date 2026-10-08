import { describe, expect, it } from 'vitest';
import { runSearch, sourceFailure, type OrchestratorOptions, type SourceAdapter } from '../src';
import { RecordingSink, company, fakeAdapter } from './helpers';

const request = { searchId: 's1', location: 'Charleroi', position: 'Développeur .NET', targetCount: 20 };
const limits = { maxDurationMs: 60_000, maxHttpRequests: 300, maxSearchApiCalls: 40 };

function options(adapters: SourceAdapter[], overrides: Partial<OrchestratorOptions> = {}) {
  const events = new RecordingSink();
  return {
    events,
    opts: {
      adapters,
      events,
      limits,
      sourceFailureThreshold: 3,
      signal: new AbortController().signal,
      ...overrides,
    } satisfies OrchestratorOptions,
  };
}

const failing = (id: string) =>
  fakeAdapter({
    id,
    companies: async function* () {
      throw sourceFailure(id, 'RateLimited', 'HTTP 429', 'https://example.test');
    },
  });

describe('runSearch', () => {
  it('fails with a message when no discovery-capable source is available', async () => {
    const { events, opts } = options([fakeAdapter({ id: 'down', available: false })]);
    const outcome = await runSearch(request, opts);
    expect(outcome.status).toBe('failed');
    expect(outcome.stopReason).toBe('no_source_available');
    expect(outcome.message).toBe('0 / 20 contacts — stopped: no discovery-capable source is available');
    expect(events.types()).toEqual(['SEARCH_STARTED', 'SOURCE_DISABLED']);
  });

  it('ignores enrich-only adapters when deciding whether discovery is possible', async () => {
    const { opts } = options([fakeAdapter({ id: 'enricher', capabilities: ['enrich'] })]);
    expect((await runSearch(request, opts)).stopReason).toBe('no_source_available');
  });

  it('ends failed when every source fails', async () => {
    const { events, opts } = options([failing('a'), failing('b')]);
    const outcome = await runSearch(request, opts);
    expect(outcome.status).toBe('failed');
    expect(outcome.stopReason).toBe('all_sources_failed');
    expect(events.events.filter((e) => e.type === 'WARNING')).toHaveLength(2);
  });

  it('completes when one source fails and another works', async () => {
    const ok = fakeAdapter({
      id: 'ok',
      companies: async function* () {
        yield company('Acme');
        yield company('Globex');
      },
    });
    const { events, opts } = options([failing('bad'), ok]);
    const outcome = await runSearch(request, opts);
    expect(outcome.status).toBe('completed');
    expect(outcome.stopReason).toBe('sources_exhausted');
    expect(outcome.companies).toBe(2);
    expect(events.events.filter((e) => e.type === 'COMPANY_DISCOVERED').map((e) => e.message)).toEqual([
      'Acme',
      'Globex',
    ]);
  });

  it('wraps a raw exception from an adapter as Unknown instead of crashing', async () => {
    const buggy = fakeAdapter({
      id: 'buggy',
      companies: async function* () {
        throw new TypeError('boom');
      },
    });
    const { events, opts } = options([buggy]);
    const outcome = await runSearch(request, opts);
    expect(outcome.status).toBe('failed');
    const warning = events.events.find((e) => e.type === 'WARNING');
    expect(warning?.metadata.error).toMatchObject({ kind: 'Unknown', adapter: 'buggy', message: 'boom' });
  });

  it('rejects a candidate without evidence and keeps going', async () => {
    const sloppy = fakeAdapter({
      id: 'sloppy',
      companies: async function* () {
        yield { name: 'No Evidence SA', evidence: [] };
        yield company('Acme');
      },
    });
    const { events, opts } = options([sloppy]);
    const outcome = await runSearch(request, opts);
    expect(outcome.companies).toBe(1);
    expect(events.types()).toContain('EXTRACTION_REJECTED');
  });

  it('stops as cancelled when the signal aborts mid-search', async () => {
    const controller = new AbortController();
    const slow = fakeAdapter({
      id: 'slow',
      companies: async function* () {
        yield company('Acme');
        controller.abort();
        yield company('Globex');
      },
    });
    const { opts } = options([slow], { signal: controller.signal });
    const outcome = await runSearch(request, opts);
    expect(outcome.status).toBe('cancelled');
    expect(outcome.companies).toBe(1);
  });

  it('stops when the time budget is exhausted', async () => {
    let t = 0;
    const ticking = fakeAdapter({
      id: 'ticking',
      companies: async function* () {
        for (const name of ['A', 'B', 'C']) {
          t += 40_000;
          yield company(name);
        }
      },
    });
    const { opts } = options([ticking], { now: () => t });
    const outcome = await runSearch(request, opts);
    expect(outcome.stopReason).toBe('duration_exhausted');
    expect(outcome.message).toBe('0 / 20 contacts — stopped: time budget exhausted');
    expect(outcome.companies).toBe(1);
  });
});
