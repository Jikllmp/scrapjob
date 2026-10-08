import { describe, expect, it } from 'vitest';
import { SourceFailure } from '@scrapjob/core';
import type { Company } from '@scrapjob/schema';
import { CompanySiteAdapter } from '../src/adapters/company-site';
import { LinkedInPublicAdapter } from '../src/adapters/linkedin-public';
import { WebSearchAdapter } from '../src/adapters/web-search';
import { HttpClient } from '../src/http/client';
import { BraveSearch } from '../src/search/brave';
import { collect, searchContext } from './context';
import { fixtureTransport, virtualClock } from './fixtures/transport';

function setup(contactUrl: string | null = 'https://example.org/bot') {
  const fixtures = fixtureTransport();
  const http = new HttpClient({
    transport: fixtures.transport,
    contactUrl: contactUrl ?? undefined,
    perHostRps: 1,
    maxConcurrent: 4,
    timeoutMs: 1000,
    retryCount: 1,
    random: () => 0,
    ...virtualClock(),
  });
  const brave = new BraveSearch(http, 'test-key');
  return { fixtures, http, brave };
}

function company(name: string, website: string | null, domain: string | null): Company {
  return {
    id: name,
    name,
    normalisedName: name.toLowerCase(),
    website,
    domain,
    city: 'Charleroi',
    country: null,
    industry: null,
    sizeBucket: null,
    registryId: null,
    isAgency: false,
    genericEmail: null,
  };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof SourceFailure) return err.error;
    throw err;
  }
  throw new Error('expected failure');
}

describe('web-search adapter', () => {
  it('turns search results into employers, skipping job boards and press', async () => {
    const { brave } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const companies = await collect(new WebSearchAdapter(brave).discoverCompanies(ctx));
    expect(companies.map((c) => [c.name, c.domain ?? null, c.isAgency])).toEqual([
      ['Acme Software', 'acme-software.test', false],
      ['Globex IT', null, false],
      ['Initech', 'initech.test', false],
      ['Randstad', 'randstad.be', true],
    ]);
  });

  it('attaches postings found on the employer site, with the city and its evidence', async () => {
    const { brave } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const [acme] = await collect(new WebSearchAdapter(brave).discoverCompanies(ctx));
    expect(acme?.postings).toEqual([
      {
        title: 'Développeur .NET (H/F) - Carrières - Acme Software',
        url: 'https://www.acme-software.test/carrieres/developpeur-net',
        postedAt: '2026-09-20T08:00:00.000Z',
      },
    ]);
    expect(acme?.city).toBe('Charleroi');
    for (const e of acme!.evidence) expect(e.snippet.toLowerCase()).toContain(e.value.toLowerCase());
    expect(acme!.evidence.every((e) => e.sourceKind === 'search_snippet')).toBe(true);
  });

  it('sends the API key and counts one search API call per query', async () => {
    const { brave, fixtures } = setup();
    const { ctx, budget } = searchContext({ maxSearchApiCalls: 2 });
    await collect(new WebSearchAdapter(brave).discoverCompanies(ctx));
    expect(budget.spent().searchApiCalls).toBe(2);
    expect(fixtures.requests[0]?.headers['x-subscription-token']).toBe('test-key');
  });

  it('is unavailable without an API key', async () => {
    const { http } = setup();
    const adapter = new WebSearchAdapter(new BraveSearch(http, undefined));
    expect(await adapter.isAvailable()).toBe(false);
    expect(adapter.unavailableReason()).toBe('BRAVE_API_KEY is not set');
  });

  it.each<[string, number, string, string]>([
    ['rate limited', 429, '', 'RateLimited'],
    ['forbidden', 403, '', 'RateLimited'],
    ['bad key', 401, '', 'AuthRequired'],
    ['not JSON', 200, '<html>', 'ParseFailed'],
    ['wrong shape', 200, '{"web":{"results":[{"nope":1}]}}', 'ParseFailed'],
  ])('maps %s to %s', async (_name, status, body, kind) => {
    const { brave, fixtures } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const q = encodeURIComponent('"Développeur .NET" Charleroi emploi').replace(/%20/g, '+');
    fixtures.override(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&search_lang=fr&country=BE&safesearch=moderate`, { status, body });
    expect(await failure(collect(new WebSearchAdapter(brave).discoverCompanies(ctx)))).toMatchObject({ kind });
  });

  it('yields nothing for an empty result set', async () => {
    const { brave } = setup();
    const { ctx } = searchContext();
    const adapter = new WebSearchAdapter(brave);
    const only = { ...ctx, plan: { ...ctx.plan, seeds: ctx.plan.seeds.slice(1, 2) } };
    expect(await collect(adapter.discoverCompanies(only))).toEqual([]);
  });
});

describe('company-site adapter', () => {
  const acme = company('Acme Software', 'https://www.acme-software.test', 'acme-software.test');

  it('finds people on the team and careers pages, with page evidence', async () => {
    const { http } = setup();
    const { ctx } = searchContext();
    const people = await collect(new CompanySiteAdapter(http).discoverPeople(ctx, acme));
    expect(people.map((p) => [p.fullName, p.title ?? null, p.email ?? null, p.postingContact])).toEqual([
      ['Marie Dupont', 'Talent Acquisition Manager', 'marie.dupont@acme-software.test', false],
      ['Marie Dupont', null, null, true],
    ]);
    for (const p of people) {
      expect(p.evidence.every((e) => e.sourceKind === 'page')).toBe(true);
      expect(p.evidence.map((e) => e.field)).toContain('company');
    }
  });

  it('never fetches a path robots.txt disallows', async () => {
    const { http, fixtures } = setup();
    await collect(new CompanySiteAdapter(http).discoverPeople(searchContext().ctx, acme));
    expect(fixtures.requests.map((r) => r.url)).not.toContain('https://www.acme-software.test/admin/login');
    expect(fixtures.requests[0]?.url).toBe('https://www.acme-software.test/robots.txt');
  });

  it('skips a site that disallows everything, and logs it', async () => {
    const { http, fixtures } = setup();
    const { ctx, events } = searchContext();
    const people = await collect(new CompanySiteAdapter(http).discoverPeople(ctx, company('Initech', 'https://www.initech.test', 'initech.test')));
    expect(people).toEqual([]);
    expect(events.map((e) => e.type)).toEqual(['ROBOTS_DISALLOWED']);
    expect(fixtures.requests.map((r) => r.url)).toEqual(['https://www.initech.test/robots.txt']);
  });

  it('treats a missing site as empty, not as a failure', async () => {
    const { http } = setup();
    expect(await collect(new CompanySiteAdapter(http).discoverPeople(searchContext().ctx, company('Gone', 'https://gone.test', 'gone.test')))).toEqual([]);
  });

  it('survives malformed HTML', async () => {
    const { http, fixtures } = setup();
    fixtures.override('https://www.acme-software.test/', {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body><div><h3>Marie Dupont<p>Talent Acquisition<a href="/equipe"',
    });
    await expect(collect(new CompanySiteAdapter(http).discoverPeople(searchContext().ctx, acme))).resolves.toBeDefined();
  });

  it('reads an ATS careers site as the employer and finds the posting contact', async () => {
    const { http } = setup();
    const globex = company('Globex IT', 'https://globex-it.recruitee.com', null);
    const people = await collect(new CompanySiteAdapter(http).discoverPeople(searchContext().ctx, globex));
    expect(people).toMatchObject([{ fullName: 'Anne Petit', postingContact: true, companyName: 'Globex IT' }]);
  });

  it('refuses to crawl without a contact URL in the User-Agent', async () => {
    const { http } = setup(null);
    expect(await new CompanySiteAdapter(http).isAvailable()).toBe(false);
  });
});

describe('linkedin-public adapter', () => {
  it('reads profile titles from search results and never fetches linkedin.com', async () => {
    const { brave, fixtures } = setup();
    const { ctx } = searchContext();
    const leads = await collect(new LinkedInPublicAdapter(brave).discoverPeople(ctx, company('Acme Software', null, 'acme-software.test')));
    expect(leads.map((l) => [l.fullName, l.title, l.city ?? null])).toEqual([
      ['Marie Dupont', 'Talent Acquisition Manager', 'Charleroi'],
      ['Paul Martin', 'Engineering Manager', 'Gosselies'],
      ['Julie Renard', 'Comptable', 'Charleroi'],
    ]);
    expect(leads.flatMap((l) => l.evidence).every((e) => e.sourceKind === 'search_snippet')).toBe(true);
    expect(fixtures.requests.map((r) => new URL(r.url).hostname)).toEqual(['api.search.brave.com']);
  });

  it('drops people the result places at another company', async () => {
    const { brave } = setup();
    const leads = await collect(new LinkedInPublicAdapter(brave).discoverPeople(searchContext().ctx, company('Initech', null, 'initech.test')));
    expect(leads.map((l) => l.fullName)).toEqual(['Hugo Lambert']);
  });
});
