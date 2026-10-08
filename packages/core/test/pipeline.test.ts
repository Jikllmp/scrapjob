import { describe, expect, it } from 'vitest';
import type { Company, ContactCandidate } from '@scrapjob/schema';
import { normaliseName, runSearch, type OrchestratorOptions, type SourceAdapter } from '../src';
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
