import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SourceFailure } from '@scrapjob/core';
import { tables, type Company } from '@scrapjob/schema';
import { CompanySiteAdapter } from '../src/adapters/company-site';
import { feedFor, JobBoardAdapter } from '../src/adapters/job-board';
import { PressEventsAdapter } from '../src/adapters/press-events';
import { RegistryAdapter } from '../src/adapters/registry';
import { importRegistry, parseCsvLine } from '../src/registry/import';
import { LinkedInPublicAdapter } from '../src/adapters/linkedin-public';
import { WebSearchAdapter } from '../src/adapters/web-search';
import { HttpClient } from '../src/http/client';
import { BraveSearch } from '../src/search/brave';
import { collect, searchContext } from './context';
import { fixtureTransport, virtualClock } from './fixtures/transport';
import { testApp } from './helpers';

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
    naceCode: null,
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
    const { brave, http } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const companies = await collect(new WebSearchAdapter(brave, http).discoverCompanies(ctx));
    expect(companies.map((c) => [c.name, c.domain ?? null, c.isAgency])).toEqual([
      ['Acme Software', 'acme-software.test', false],
      ['Globex IT', null, false],
      ['Initech', 'initech.test', false],
      ['Randstad', 'randstad.be', true],
    ]);
  });

  it('attaches postings found on the employer site, with the city and its evidence', async () => {
    const { brave, http } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const [acme] = await collect(new WebSearchAdapter(brave, http).discoverCompanies(ctx));
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
    const { brave, http, fixtures } = setup();
    const { ctx, budget } = searchContext({ maxSearchApiCalls: 2 });
    await collect(new WebSearchAdapter(brave, http).discoverCompanies(ctx));
    expect(budget.spent().searchApiCalls).toBe(2);
    expect(fixtures.requests[0]?.headers['x-subscription-token']).toBe('test-key');
  });

  it('is unavailable without an API key', async () => {
    const { http } = setup();
    const adapter = new WebSearchAdapter(new BraveSearch(http, undefined), http);
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
    const { brave, http, fixtures } = setup();
    const { ctx } = searchContext({ maxSearchApiCalls: 1 });
    const q = encodeURIComponent('"Développeur .NET" Charleroi emploi').replace(/%20/g, '+');
    fixtures.override(`https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&search_lang=fr&country=BE&safesearch=moderate`, { status, body });
    expect(await failure(collect(new WebSearchAdapter(brave, http).discoverCompanies(ctx)))).toMatchObject({ kind });
  });

  it('yields nothing for an empty result set', async () => {
    const { brave, http } = setup();
    const { ctx } = searchContext();
    const adapter = new WebSearchAdapter(brave, http);
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
    const { brave, http, fixtures } = setup();
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
    const { brave, http } = setup();
    const leads = await collect(new LinkedInPublicAdapter(brave).discoverPeople(searchContext().ctx, company('Initech', null, 'initech.test')));
    expect(leads.map((l) => l.fullName)).toEqual(['Hugo Lambert']);
  });
});

describe('job-board adapter', () => {
  const globex = () => company('Globex IT', 'https://globex-it.recruitee.com', null);

  it('finds the documented public feed for each supported ATS, and none elsewhere', () => {
    expect(feedFor('https://globex-it.recruitee.com/o/x')?.url).toBe('https://globex-it.recruitee.com/api/offers/');
    expect(feedFor('https://jobs.lever.co/acme')?.url).toBe('https://api.lever.co/v0/postings/acme?mode=json');
    expect(feedFor('https://jobs.eu.lever.co/acme/123')?.url).toBe('https://api.eu.lever.co/v0/postings/acme?mode=json');
    expect(feedFor('https://boards.greenhouse.io/acme')?.url).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs');
    expect(feedFor('https://www.acme-software.test/')).toBeNull();
    expect(feedFor('https://jobs.lever.co/')).toBeNull();
  });

  it('yields every posting of the feed with its evidence', async () => {
    const { http } = setup();
    const { ctx } = searchContext();
    const jobs = await collect(new JobBoardAdapter(http).discoverJobs(ctx, globex()));
    expect(jobs.map((j) => [j.title, j.url, j.location, j.postedAt])).toEqual([
      ['Développeur .NET', 'https://globex-it.recruitee.com/o/developpeur-net', 'Charleroi', '2026-09-20T08:00:00.000Z'],
      ['Senior .NET Developer', 'https://globex-it.recruitee.com/o/senior-net-developer', 'Charleroi', '2026-09-28T08:00:00.000Z'],
      ['Office Manager', 'https://globex-it.recruitee.com/o/office-manager', 'Charleroi', '2026-09-01T08:00:00.000Z'],
    ]);
    expect(jobs[0]?.evidence[0]).toMatchObject({ sourceUrl: 'https://globex-it.recruitee.com/api/offers/', sourceKind: 'page' });
  });

  it('yields nothing for an employer without a known feed or with an empty one', async () => {
    const { http, fixtures } = setup();
    const { ctx } = searchContext();
    expect(await collect(new JobBoardAdapter(http).discoverJobs(ctx, company('Acme', 'https://www.acme-software.test/', 'acme-software.test')))).toEqual([]);
    fixtures.override('https://globex-it.recruitee.com/api/offers/', { status: 200, body: '{"offers":[]}' });
    expect(await collect(new JobBoardAdapter(http).discoverJobs(ctx, globex()))).toEqual([]);
  });

  it.each<[string, number, string, string]>([
    ['rate limited', 429, '', 'RateLimited'],
    ['forbidden', 403, '', 'RateLimited'],
    ['server error', 503, '', 'SourceUnavailable'],
    ['malformed', 200, '{"offers":[{"title":1}]}', 'ParseFailed'],
    ['not JSON', 200, '<html>', 'ParseFailed'],
  ])('maps %s to %s', async (_name, status, body, kind) => {
    const { http, fixtures } = setup();
    const { ctx } = searchContext();
    fixtures.override('https://globex-it.recruitee.com/api/offers/', { status, body });
    expect(await failure(collect(new JobBoardAdapter(http).discoverJobs(ctx, globex())))).toMatchObject({ kind });
  });

  it('skips a feed that robots.txt disallows', async () => {
    const { http, fixtures } = setup();
    const { ctx, events } = searchContext();
    fixtures.override('https://globex-it.recruitee.com/robots.txt', { status: 200, body: 'User-agent: *\nDisallow: /api/' });
    expect(await collect(new JobBoardAdapter(http).discoverJobs(ctx, globex()))).toEqual([]);
    expect(events.map((e) => e.type)).toContain('ROBOTS_DISALLOWED');
  });
});

describe('press-events adapter', () => {
  const initech = () => company('Initech', 'https://www.initech.test/', 'initech.test');

  it('keeps only hiring-relevant people whose own card names the employer', async () => {
    const { brave, http } = setup();
    const { ctx } = searchContext();
    const people = await collect(new PressEventsAdapter(brave, http).discoverPeople(ctx, initech()));
    expect(people.map((p) => [p.fullName, p.title, p.companyName])).toEqual([['Sophie Leroy', 'CTO', 'Initech']]);
    expect(people[0]!.evidence.map((e) => [e.field, e.sourceKind])).toEqual([
      ['full_name', 'page'],
      ['company', 'page'],
      ['title', 'page'],
    ]);
  });

  it('never reads LinkedIn or a job board, and yields nothing for an empty result set', async () => {
    const { brave, http, fixtures } = setup();
    const { ctx } = searchContext();
    await collect(new PressEventsAdapter(brave, http).discoverPeople(ctx, initech()));
    expect(fixtures.requests.some((r) => new URL(r.url).hostname.endsWith('linkedin.com'))).toBe(false);
    expect(await collect(new PressEventsAdapter(brave, http).discoverPeople(ctx, company('Globex IT', null, null)))).toEqual([]);
  });

  it('skips a page with malformed HTML without failing', async () => {
    const { brave, http, fixtures } = setup();
    const { ctx } = searchContext();
    fixtures.override('https://www.devday-charleroi.test/speakers', { status: 200, headers: { 'content-type': 'text/html' }, body: '<div><h3>Sophie<p>CTO</div></span>' });
    expect(await collect(new PressEventsAdapter(brave, http).discoverPeople(ctx, initech()))).toEqual([]);
  });
});

describe('registry import and adapter', () => {
  const kbo = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/kbo');

  it('parses the quoted CSV lines of the register', () => {
    expect(parseCsvLine('"0999.000.101","2","001","Acme ""Soft"", SA"')).toEqual(['0999.000.101', '2', '001', 'Acme "Soft", SA']);
  });

  it('imports active enterprises, their names, newest main activity and registered office', async () => {
    const built = testApp();
    try {
      const summary = await importRegistry(built.ctx.db, kbo);
      expect(summary).toEqual({ enterprises: 3, names: 4, activities: 4, addresses: 3, naceCodes: 4 });
      const rows = built.ctx.db.select().from(tables.registryEnterprises).orderBy(tables.registryEnterprises.enterpriseNumber).all();
      expect(rows.map((r) => [r.enterpriseNumber, r.name, r.naceCode, r.naceVersion, r.municipality])).toEqual([
        ['0999.000.101', 'Acme Software SA', '62.100', '2025', 'Charleroi'],
        ['0999.000.202', 'Initech SRL', '62.020', '2008', 'Charleroi'],
        ['0999.000.303', 'Initech BV', '47.110', '2008', 'Gand'],
      ]);
    } finally {
      await built.app.close();
    }
  });

  it('refuses a folder that is not the register extract, naming the file and column', async () => {
    const built = testApp();
    try {
      await expect(importRegistry(built.ctx.db, join(kbo, '..', 'brave'))).rejects.toThrow(/enterprise\.csv is missing/);
    } finally {
      await built.app.close();
    }
  });

  it('gives up on a homonym it cannot place in the searched area', async () => {
    const built = testApp();
    try {
      await importRegistry(built.ctx.db, kbo);
      const adapter = new RegistryAdapter(built.ctx.db);
      const { ctx } = searchContext();
      const namur = { ...ctx, plan: { ...ctx.plan, location: { ...ctx.plan.location, areaNames: ['Namur'] } } };
      expect(await adapter.enrichCompany(namur, company('Initech', null, null))).toBeNull();
      expect(await adapter.enrichCompany(ctx, company('Unknown BV', null, null))).toBeNull();
      expect(await adapter.enrichCompany(ctx, company('Initech', null, null))).toMatchObject({ registryId: '0999.000.202' });
    } finally {
      await built.app.close();
    }
  });
});
