import { describe, expect, it } from 'vitest';
import type { Company } from '@scrapjob/schema';
import {
  applyPatches,
  compatibleTitles,
  runDeepSearch,
  sectorMatches,
  sourceFailure,
  type AttributedEvidence,
  type ContactDraft,
  type DeepSearchStore,
  type ScoredDraft,
} from '../src';
import { RecordingSink, T, fakeAdapter, taxonomy } from './helpers';

const ctx = { taxonomy, now: new Date(T) };
const acme: Company = {
  id: 'c1',
  name: 'Acme Software',
  normalisedName: 'acme software',
  website: 'https://acme.be/',
  domain: 'acme.be',
  city: 'Charleroi',
  country: 'BE',
  industry: null,
  sizeBucket: null,
  registryId: null,
  naceCode: null,
  isAgency: false,
  genericEmail: null,
};

function ev(field: AttributedEvidence['field'], value: string, url: string, kind: 'page' | 'search_snippet' = 'page'): AttributedEvidence {
  return { field, value, sourceUrl: url, snippet: `… ${value} …`, sourceKind: kind, retrievedAt: T, sourceAdapter: 'test' };
}

/** A LinkedIn-only lead: name, title and employer from one search result. */
function lead(): ContactDraft {
  const url = 'https://be.linkedin.com/in/paul-martin';
  return {
    id: 'p1',
    fields: { full_name: 'Paul Martin', title: 'Engineering Manager', company: 'Acme Software', profile_url: url },
    company: { id: acme.id, name: acme.name, domain: acme.domain, isAgency: false },
    evidence: [
      ev('full_name', 'Paul Martin', url, 'search_snippet'),
      ev('title', 'Engineering Manager', url, 'search_snippet'),
      ev('company', 'Acme Software', url, 'search_snippet'),
      ev('profile_url', url, url, 'search_snippet'),
    ],
    roleArchetype: 'hiring-manager',
    roleTier: 2,
    roleGenericOnly: false,
    fieldFlags: {},
  };
}

describe('applyPatches', () => {
  it('raises a lead to VERIFIED when the employer site names the same person and title', () => {
    const page = 'https://acme.be/equipe';
    const { draft, changes } = applyPatches(
      lead(),
      [ev('full_name', 'Paul Martin', page), ev('title', 'Engineering Manager', page), ev('company', 'Acme Software', page)],
      ctx,
    );
    expect(draft.fields.title).toBe('Engineering Manager');
    expect(draft.evidence).toHaveLength(7);
    expect(changes.map((c) => [c.field, c.kind, c.confidenceBefore, c.confidenceAfter])).toEqual([
      ['full_name', 'corroborated', 'LOW', 'VERIFIED'],
      ['title', 'corroborated', 'LOW', 'VERIFIED'],
      ['company', 'corroborated', 'LOW', 'VERIFIED'],
    ]);
  });

  it('adds a published email it did not have', () => {
    const { draft, changes } = applyPatches(lead(), [ev('email', 'paul.martin@acme.be', 'https://acme.be/contact')], ctx);
    expect(draft.fields.email).toBe('paul.martin@acme.be');
    expect(changes).toEqual([
      { field: 'email', kind: 'added', before: null, after: 'paul.martin@acme.be', confidenceBefore: 'UNKNOWN', confidenceAfter: 'VERIFIED' },
    ]);
  });

  it('flags a different title as contradicted instead of picking a winner, and keeps both in evidence', () => {
    const { draft, changes } = applyPatches(lead(), [ev('title', 'Head of Sales', 'https://acme.be/equipe')], ctx);
    expect(draft.fields.title).toBe('Engineering Manager');
    expect(draft.fieldFlags.title).toEqual(['contradicted']);
    expect(draft.evidence.filter((e) => e.field === 'title').map((e) => e.value)).toEqual(['Engineering Manager', 'Head of Sales']);
    expect(changes[0]).toMatchObject({ field: 'title', kind: 'contradicted', confidenceAfter: 'UNKNOWN' });
  });

  it('flags a different employer as contradicted', () => {
    const { draft } = applyPatches(lead(), [ev('company', 'Globex IT', 'https://news.test/article')], ctx);
    expect(draft.fieldFlags.company).toEqual(['contradicted']);
    expect(draft.fields.company).toBe('Acme Software');
  });

  it('replaces a compatible title only with a higher-confidence one', () => {
    const better = applyPatches(lead(), [ev('title', 'Senior Engineering Manager', 'https://acme.be/equipe')], ctx);
    expect(better.draft.fields.title).toBe('Senior Engineering Manager');
    expect(better.changes[0]).toMatchObject({ kind: 'updated', confidenceBefore: 'LOW', confidenceAfter: 'VERIFIED' });

    const verified = better.draft;
    const worse = applyPatches(verified, [ev('title', 'Engineering Manager', 'https://other.test/x', 'search_snippet')], ctx);
    expect(worse.draft.fields.title).toBe('Senior Engineering Manager');
    expect(worse.changes).toEqual([]);
  });

  it('never changes the person’s name and ignores evidence about someone else', () => {
    const { draft, changes } = applyPatches(lead(), [ev('full_name', 'Pauline Martin', 'https://acme.be/equipe')], ctx);
    expect(draft.fields.full_name).toBe('Paul Martin');
    expect(draft.evidence).toHaveLength(4);
    expect(changes).toEqual([]);
  });

  it('does not report evidence it already had', () => {
    const base = lead();
    const { changes, draft } = applyPatches(base, [base.evidence[0]!], ctx);
    expect(changes).toEqual([]);
    expect(draft.evidence).toHaveLength(4);
  });
});

describe('compatibleTitles and sectorMatches', () => {
  it('treats seniority words as the same job', () => {
    expect(compatibleTitles('Talent Acquisition Manager', 'Senior Talent Acquisition Manager')).toBe(true);
    expect(compatibleTitles('Engineering Manager', 'Head of Sales')).toBe(false);
  });

  it('matches NACE codes by whole-digit prefix, and says nothing when unknown', () => {
    expect(sectorMatches('software', '62.010', taxonomy)).toBe(true);
    expect(sectorMatches('software', '63.110', taxonomy)).toBe(true);
    expect(sectorMatches('software', '47.110', taxonomy)).toBe(false);
    expect(sectorMatches('software', null, taxonomy)).toBeNull();
    expect(sectorMatches(null, '62.010', taxonomy)).toBeNull();
  });
});

class MemoryDeepStore implements DeepSearchStore {
  saved: ScoredDraft | null = null;
  linked: string[] = [];
  saveEnriched(_id: string, scored: ScoredDraft) {
    this.saved = scored;
  }
  linkPosting(_id: string, _company: Company, posting: { url: string }) {
    this.linked.push(posting.url);
  }
}

describe('runDeepSearch', () => {
  const request = {
    deepSearchId: 'd1',
    contactId: 'p1',
    location: 'Charleroi',
    position: 'Développeur .NET',
    company: acme,
    hasPosting: false,
  };
  const base = { taxonomy, maxRequests: 25, maxDurationMs: 60_000, signal: new AbortController().signal, now: () => Date.parse(T) };

  it('records before and after, saves the enriched contact and links the posting', async () => {
    const page = 'https://acme.be/equipe';
    const site = fakeAdapter({
      id: 'site',
      capabilities: ['enrich'],
      enrich: async () => ({
        patches: [
          { field: 'full_name', evidence: { ...ev('full_name', 'Paul Martin', page) } },
          { field: 'title', evidence: { ...ev('title', 'Engineering Manager', page) } },
          { field: 'company', evidence: { ...ev('company', 'Acme Software', page) } },
        ].map((p) => ({ field: p.field, evidence: { field: p.evidence.field, value: p.evidence.value, sourceUrl: p.evidence.sourceUrl, snippet: p.evidence.snippet, sourceKind: p.evidence.sourceKind, retrievedAt: T } })),
        postings: [{ title: 'Développeur .NET (H/F)', url: 'https://acme.be/jobs/dotnet' }, { title: 'Comptable', url: 'https://acme.be/jobs/compta' }],
      }),
    });
    const events = new RecordingSink();
    const store = new MemoryDeepStore();
    const outcome = await runDeepSearch({ ...request, draft: lead() }, { ...base, adapters: [site], events, store });

    expect(outcome.status).toBe('completed');
    expect(outcome.before).toMatchObject({ confidence: 'LOW', lead: true });
    expect(outcome.after).toMatchObject({ confidence: 'VERIFIED', lead: false });
    expect(outcome.after.score).toBeGreaterThan(outcome.before.score);
    expect(outcome.after.fields.title).toEqual({ value: 'Engineering Manager', confidence: 'VERIFIED' });
    expect(store.saved?.draft.evidence).toHaveLength(7);
    expect(store.linked).toEqual(['https://acme.be/jobs/dotnet']);
    expect(outcome.postingUrl).toBe('https://acme.be/jobs/dotnet');
    expect(events.types()).toEqual(['ENRICHMENT_STARTED', 'ENRICHMENT_COMPLETED']);
    expect(events.events[1]?.message).toBe('Deep search: Paul Martin: 0 fields added, 0 updated, 3 corroborated, 0 contradicted, posting found (0 requests)');
  });

  it('rejects a patch whose value is not in its snippet', async () => {
    const liar = fakeAdapter({
      id: 'liar',
      capabilities: ['enrich'],
      enrich: async () => ({
        patches: [{ field: 'email', evidence: { field: 'email', value: 'paul@acme.be', sourceUrl: 'https://acme.be/', snippet: 'Contact us', sourceKind: 'page', retrievedAt: T } }],
      }),
    });
    const events = new RecordingSink();
    const store = new MemoryDeepStore();
    const outcome = await runDeepSearch({ ...request, draft: lead() }, { ...base, adapters: [liar], events, store });
    expect(outcome.changes).toEqual([]);
    expect(store.saved).toBeNull();
    expect(events.ofType('EXTRACTION_REJECTED')).toHaveLength(1);
  });

  it('fails with a message when every source fails, and changes nothing', async () => {
    const broken = fakeAdapter({
      id: 'broken',
      capabilities: ['enrich'],
      enrich: async () => {
        throw sourceFailure('broken', 'RateLimited', 'HTTP 429');
      },
    });
    const events = new RecordingSink();
    const store = new MemoryDeepStore();
    const outcome = await runDeepSearch({ ...request, draft: lead() }, { ...base, adapters: [broken], events, store });
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toBe('Deep search: Paul Martin: every source failed (0 requests)');
    expect(store.saved).toBeNull();
    expect(outcome.after).toEqual(outcome.before);
  });

  it('fails when no source can enrich', async () => {
    const events = new RecordingSink();
    const outcome = await runDeepSearch(
      { ...request, draft: lead() },
      { ...base, adapters: [fakeAdapter({ id: 'disc' })], events, store: new MemoryDeepStore() },
    );
    expect(outcome.status).toBe('failed');
    expect(outcome.message).toContain('no deep-search source is available');
  });
});
