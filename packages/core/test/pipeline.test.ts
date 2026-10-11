import { describe, expect, it } from 'vitest';
import type { Company, ContactCandidate } from '@scrapjob/schema';
import { normaliseName, runSearch, sourceFailure, type OrchestratorOptions, type SourceAdapter } from '../src';
import { MemoryStore, RecordingSink, T, company, fakeAdapter, taxonomy, teamPagePerson } from './helpers';

const request = { searchId: 's1', location: 'Charleroi', position: 'Développeur .NET', targetCount: 20 };
const limits = { maxDurationMs: 60_000, maxHttpRequests: 300, maxSearchApiCalls: 40 };

function setup(adapters: SourceAdapter[], overrides: Partial<OrchestratorOptions> = {}) {
  const events = new RecordingSink();
  const store = new MemoryStore();
  const opts: OrchestratorOptions = {
    adapters,
    events,
    store,
    taxonomy,
    minRelevanceScore: 35,
    limits,
    sourceFailureThreshold: 3,
    signal: new AbortController().signal,
    now: () => Date.parse(T),
    ...overrides,
  };
  return { events, store, opts };
}

const discovery = (...names: string[]) =>
  fakeAdapter({
    id: 'discovery',
    companies: async function* () {
      for (const n of names) yield company(n, { city: 'Charleroi', postings: [{ title: 'Développeur .NET', url: `https://${n.toLowerCase()}.test/jobs/1` }] });
    },
  });

const people = (id: string, byCompany: Record<string, ContactCandidate[]>) =>
  fakeAdapter({
    id,
    capabilities: ['people'],
    people: async function* (c: Company) {
      for (const p of byCompany[c.name] ?? []) yield p;
    },
  });

function linkedInLead(companyName: string, fullName: string, title: string): ContactCandidate {
  const url = `https://be.linkedin.com/in/${fullName.toLowerCase().replace(/\s+/g, '-')}`;
  const snippet = `${fullName} - ${title} - ${companyName} | LinkedIn`;
  return {
    fullName,
    title,
    companyName,
    profileUrl: url,
    evidence: [
      ...(
        [
          ['full_name', fullName],
          ['title', title],
          ['company', companyName],
        ] as const
      ).map(([field, value]) => ({ field, value, sourceUrl: url, snippet, sourceKind: 'search_snippet' as const, retrievedAt: T })),
      { field: 'profile_url', value: url, sourceUrl: url, snippet: url, sourceKind: 'search_snippet', retrievedAt: T },
    ],
  };
}

describe('contact pipeline', () => {
  it('validates evidenced people, scores them and persists them', async () => {
    const { events, store, opts } = setup([
      discovery('Acme'),
      people('company-site', { Acme: [teamPagePerson('Acme', 'Marie Dupont', 'Talent Acquisition Manager')] }),
    ]);
    const outcome = await runSearch(request, opts);
    expect(outcome).toMatchObject({ status: 'completed', stopReason: 'sources_exhausted', validatedContacts: 1, leads: 0 });
    expect(outcome.message).toBe('1 / 20 contacts (1 confirmed, 0 unconfirmed leads) — stopped: sources exhausted');
    const [saved] = [...store.contacts.values()];
    expect(saved?.confidence).toBe('VERIFIED');
    // 30 tier 1 + 20 posting + 15 area (company city) + 15 VERIFIED
    expect(saved?.score.score).toBe(80);
    expect(events.ofType('CONTACT_VALIDATED')[0]?.message).toBe(
      'Marie Dupont — Talent Acquisition Manager, Acme (score 80, VERIFIED)',
    );
  });

  it('counts a LinkedIn-snippet contact as an unconfirmed lead', async () => {
    const { store, opts } = setup([discovery('Acme'), people('linkedin-public', { Acme: [linkedInLead('Acme', 'Marie Dupont', 'IT Recruiter')] })]);
    const outcome = await runSearch(request, opts);
    expect(outcome).toMatchObject({ validatedContacts: 1, leads: 1 });
    expect([...store.contacts.values()][0]?.confidence).toBe('LOW');
  });

  it('merges the same person found by two adapters into one contact', async () => {
    const { events, store, opts } = setup([
      discovery('Acme'),
      people('linkedin-public', { Acme: [linkedInLead('Acme', 'Marie Dupont', 'IT Recruiter')] }),
      people('company-site', { Acme: [teamPagePerson('Acme', 'Marie Dupont', 'IT Recruiter')] }),
    ]);
    const outcome = await runSearch(request, opts);
    expect(outcome).toMatchObject({ validatedContacts: 1, leads: 0 });
    expect(store.contacts.size).toBe(1);
    const merged = [...store.contacts.values()][0]!;
    expect(merged.confidence).toBe('VERIFIED');
    expect(merged.draft.fields.profile_url).toBe('https://be.linkedin.com/in/marie-dupont');
    expect(events.ofType('DUPLICATE_MERGED')[0]?.metadata.sourceUrls).toEqual([
      'https://be.linkedin.com/in/marie-dupont',
      'https://acme.test/equipe',
    ]);
  });

  it('rejects a value that is not in its snippet and drops only that value', async () => {
    const forged = teamPagePerson('Acme', 'Marie Dupont', 'IT Recruiter', { email: 'marie@acme.test' });
    forged.evidence.push({ field: 'email', value: 'marie@acme.test', sourceUrl: 'https://acme.test/equipe', snippet: 'Marie Dupont IT Recruiter', sourceKind: 'page', retrievedAt: T });
    const { events, store, opts } = setup([discovery('Acme'), people('company-site', { Acme: [forged] })]);
    await runSearch(request, opts);
    expect(events.ofType('EXTRACTION_REJECTED').map((e) => e.metadata.field)).toEqual(['email', 'email']);
    expect([...store.contacts.values()][0]?.draft.fields.email).toBeUndefined();
  });

  it('rejects people whose title is not hiring-relevant, or who work elsewhere', async () => {
    const { events, store, opts } = setup([
      discovery('Acme'),
      people('linkedin-public', {
        Acme: [linkedInLead('Acme', 'Paul Durand', 'Comptable'), linkedInLead('Globex', 'Anne Petit', 'IT Recruiter')],
      }),
    ]);
    await runSearch(request, opts);
    expect(store.contacts.size).toBe(0);
    expect(events.ofType('CONTACT_REJECTED').map((e) => e.metadata.reasons)).toEqual([
      ['"Comptable" is not a hiring-relevant role'],
      ['listed at "Globex", not Acme'],
    ]);
  });

  it('rejects contacts scoring under the threshold, with the reasons', async () => {
    const { events, store, opts } = setup(
      [
        fakeAdapter({ id: 'discovery', companies: async function* () { yield company('Acme'); } }),
        people('linkedin-public', { Acme: [linkedInLead('Acme', 'Paul Durand', 'Sales Manager')] }),
      ],
      { minRelevanceScore: 35 },
    );
    await runSearch(request, opts);
    expect(store.contacts.size).toBe(0);
    const rejection = events.ofType('CONTACT_REJECTED')[0]!;
    expect(rejection.message).toBe('Paul Durand scored 15, below 35');
    expect(rejection.metadata.reasons).toEqual([
      '+15 tier 4 role (cto)',
      '−10 role matched only by a generic keyword',
      '+10 published professional contact channel',
    ]);
  });

  it('never re-inserts someone on the blocklist', async () => {
    const { store, opts } = setup([discovery('Acme'), people('company-site', { Acme: [teamPagePerson('Acme', 'Marie Dupont', 'IT Recruiter')] })]);
    store.blocked.add(normaliseName('Marie Dupont'));
    await runSearch(request, opts);
    expect(store.contacts.size).toBe(0);
  });

  it('stops at the target count', async () => {
    const team = ['Anne Petit', 'Marc Leroy', 'Julie Simon'].map((n) => teamPagePerson('Acme', n, 'IT Recruiter'));
    const { opts } = setup([discovery('Acme', 'Globex'), people('company-site', { Acme: team, Globex: team })]);
    const outcome = await runSearch({ ...request, targetCount: 2 }, opts);
    expect(outcome).toMatchObject({ stopReason: 'target_reached', validatedContacts: 2 });
  });

  it('asks a company for at most three people', async () => {
    const team = ['Anne Petit', 'Marc Leroy', 'Julie Simon', 'Hugo Lambert'].map((n) => teamPagePerson('Acme', n, 'IT Recruiter'));
    const { opts } = setup([discovery('Acme'), people('company-site', { Acme: team })]);
    expect((await runSearch(request, opts)).validatedContacts).toBe(3);
  });

  it('fails fast when no company discovery source is alive', async () => {
    const { opts } = setup([people('company-site', {})]);
    expect((await runSearch(request, opts)).stopReason).toBe('no_source_available');
  });
});

describe('employer facts before people', () => {
  const quiet = (...names: string[]) =>
    fakeAdapter({
      id: 'discovery',
      companies: async function* () {
        for (const n of names) yield company(n, { city: 'Charleroi' });
      },
    });
  const marie = people('company-site', { Acme: [teamPagePerson('Acme', 'Marie Dupont', 'Talent Acquisition Manager')] });

  it('scores the sector from the register before scoring people', async () => {
    const registry = fakeAdapter({
      id: 'registry',
      capabilities: ['enrich'],
      enrichCompany: async (c) => ({
        registryId: '0123.456.789',
        naceCode: '62.010',
        industry: 'Programmation informatique',
        evidence: [
          {
            field: 'industry',
            value: 'Programmation informatique',
            sourceUrl: 'https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=0123456789',
            snippet: `0123.456.789 ${c.name} — NACE 62.010 Programmation informatique`,
            sourceKind: 'dataset',
            retrievedAt: T,
          },
        ],
      }),
    });
    const { events, store, opts } = setup([quiet('Acme'), registry, marie]);
    await runSearch(request, opts);
    const [saved] = [...store.contacts.values()];
    expect(saved?.score.reasons).toContain("+10 employer's sector matches the position");
    expect(events.ofType('ENRICHMENT_COMPLETED')[0]?.message).toBe('Acme: Programmation informatique');
  });

  it('ignores register facts that have no supporting snippet', async () => {
    const liar = fakeAdapter({
      id: 'registry',
      capabilities: ['enrich'],
      enrichCompany: async () => ({
        naceCode: '62.010',
        evidence: [{ field: 'industry', value: 'Software', sourceUrl: 'https://x.test/', snippet: 'nothing here', sourceKind: 'dataset', retrievedAt: T }],
      }),
    });
    const { events, store, opts } = setup([quiet('Acme'), liar, marie]);
    await runSearch(request, opts);
    expect([...store.contacts.values()][0]?.score.reasons.join(' ')).not.toContain('sector');
    expect(events.ofType('EXTRACTION_REJECTED')).toHaveLength(1);
  });

  it('counts a matching posting from a job feed, and ignores postings for other jobs', async () => {
    const feed = (title: string) =>
      fakeAdapter({
        id: 'job-board',
        capabilities: ['jobs'],
        jobs: async function* (c: Company) {
          const url = `https://acme.recruitee.test/o/${title.toLowerCase().replace(/\W+/g, '-')}`;
          yield { companyName: c.name, title, url, evidence: [{ field: 'name', value: c.name, sourceUrl: url, snippet: `${title} — ${c.name}`, sourceKind: 'page', retrievedAt: T }] };
        },
      });
    const withPosting = setup([quiet('Acme'), feed('Développeur .NET senior'), marie]);
    await runSearch(request, withPosting.opts);
    expect([...withPosting.store.contacts.values()][0]?.score.reasons).toContain('+20 employer has an open posting for this position');
    expect(withPosting.store.jobs).toHaveLength(1);
    expect(withPosting.events.ofType('JOB_DISCOVERED')[0]?.message).toBe('Développeur .NET senior — Acme');

    const other = setup([quiet('Acme'), feed('Comptable'), marie]);
    await runSearch(request, other.opts);
    expect([...other.store.contacts.values()][0]?.score.reasons.join(' ')).not.toContain('posting');
    expect(other.store.jobs).toHaveLength(0);
  });
});

describe('a failing source mid-search', () => {
  it('is disabled after SOURCE_FAILURE_THRESHOLD rate limits, and the search completes with the other sources', async () => {
    let calls = 0;
    const limited = fakeAdapter({
      id: 'limited',
      capabilities: ['people'],
      people: async function* () {
        calls += 1;
        throw sourceFailure('limited', 'RateLimited', 'HTTP 429', 'https://limited.test');
      },
    });
    const names = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli'];
    const recruiters = ['Marie Dupont', 'Luc Peeters', 'Sara Janssens', 'Tom Maes', 'Ines Lambert'];
    const byCompany = Object.fromEntries(names.map((n, i) => [n, [teamPagePerson(n, recruiters[i]!, 'Talent Acquisition Manager')]]));
    const { events, store, opts } = setup([discovery(...names), limited, people('site', byCompany)]);
    const outcome = await runSearch(request, opts);

    expect(calls).toBe(3);
    expect(events.events.filter((e) => e.type === 'SOURCE_DISABLED').map((e) => e.metadata)).toEqual([{ adapter: 'limited', failures: 3 }]);
    expect(outcome).toMatchObject({ status: 'completed', stopReason: 'sources_exhausted', validatedContacts: 5 });
    expect(store.contacts.size).toBe(5);
  });

  it('reports a source that broke after yielding contacts as a completed, partial result', async () => {
    const flaky = fakeAdapter({
      id: 'discovery',
      companies: async function* () {
        yield company('Acme', { city: 'Charleroi' });
        throw sourceFailure('discovery', 'RateLimited', 'HTTP 429 on page 2');
      },
    });
    const { opts } = setup([flaky, people('site', { Acme: [teamPagePerson('Acme', 'Marie Dupont', 'Talent Acquisition Manager')] })]);
    const outcome = await runSearch(request, opts);
    expect(outcome).toMatchObject({ status: 'completed', stopReason: 'sources_exhausted', validatedContacts: 1 });
  });

  it('asks the next people source until the employer has given 3 people', async () => {
    const first = people('first', {
      Acme: [teamPagePerson('Acme', 'Marie Dupont', 'Talent Acquisition Manager'), teamPagePerson('Acme', 'Luc Peeters', 'HR Business Partner')],
    });
    const second = people('second', { Acme: [teamPagePerson('Acme', 'Sara Janssens', 'Recruiter')] });
    const { opts } = setup([discovery('Acme'), first, second]);
    expect((await runSearch(request, opts)).validatedContacts).toBe(3);
  });
});
