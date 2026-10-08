import { describe, expect, it } from 'vitest';
import {
  contactConfidence,
  dedupDecision,
  fieldConfidence,
  isEmployerSource,
  mergeDrafts,
  pairScore,
  type AttributedEvidence,
  type CompanyRef,
  type ContactDraft,
} from '../src';
import { T, taxonomy } from './helpers';

const acme: CompanyRef = { id: 'c1', name: 'Acme Software', domain: 'acme.be', isAgency: false };
const ctx = { taxonomy, now: new Date(T) };

function ev(field: AttributedEvidence['field'], value: string, url: string, kind: 'page' | 'search_snippet' = 'page', publishedAt?: string): AttributedEvidence {
  return {
    field,
    value,
    sourceUrl: url,
    snippet: `… ${value} …`,
    sourceKind: kind,
    retrievedAt: T,
    sourceAdapter: 'test',
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function draft(fields: ContactDraft['fields'], evidence: AttributedEvidence[], company: CompanyRef | null = acme): ContactDraft {
  return { id: null, fields, company, evidence, roleArchetype: 'tech-recruiter', roleTier: 1, roleGenericOnly: false, fieldFlags: {} };
}

describe('fieldConfidence (spec §4.2)', () => {
  it.each<[string, AttributedEvidence[], string]>([
    ['employer page', [ev('title', 'Recruiter', 'https://www.acme.be/team')], 'VERIFIED'],
    ['employer ATS page', [ev('title', 'Recruiter', 'https://acmesoftware.recruitee.com/o/dev')], 'VERIFIED'],
    ['another company on the same ATS', [ev('title', 'Recruiter', 'https://globex.recruitee.com/o/dev')], 'MEDIUM'],
    ['employer domain seen only as a search snippet', [ev('title', 'Recruiter', 'https://acme.be/team', 'search_snippet')], 'LOW'],
    ['two independent sources', [ev('title', 'Recruiter', 'https://lesoir.be/a'), ev('title', 'Recruiter', 'https://www.linkedin.com/in/x', 'search_snippet')], 'HIGH'],
    ['two pages on the same site count once', [ev('title', 'Recruiter', 'https://lesoir.be/a'), ev('title', 'Recruiter', 'https://www.lesoir.be/b')], 'MEDIUM'],
    ['one press page', [ev('title', 'Recruiter', 'https://lesoir.be/a')], 'MEDIUM'],
    ['one LinkedIn snippet', [ev('title', 'Recruiter', 'https://be.linkedin.com/in/x', 'search_snippet')], 'LOW'],
    ['one job-board page', [ev('title', 'Recruiter', 'https://www.jobat.be/x')], 'LOW'],
    ['stale', [ev('title', 'Recruiter', 'https://acme.be/team', 'page', '2023-01-01T00:00:00.000Z')], 'UNKNOWN'],
    ['no evidence', [], 'UNKNOWN'],
    ['evidence for another value', [ev('title', 'CTO', 'https://acme.be/team')], 'UNKNOWN'],
  ])('%s → %s', (_name, evidence, expected) => {
    expect(fieldConfidence('Recruiter', evidence, acme, [], ctx)).toBe(expected);
  });

  it('is UNKNOWN when the field is contradicted', () => {
    expect(fieldConfidence('Recruiter', [ev('title', 'Recruiter', 'https://acme.be/t')], acme, ['contradicted'], ctx)).toBe('UNKNOWN');
  });

  it('does not treat an ATS without a matching company slug as the employer', () => {
    expect(isEmployerSource('https://jobs.recruitee.com/', acme, taxonomy)).toBe(false);
  });
});

describe('contactConfidence', () => {
  it('is the lowest of name, title and company', () => {
    const d = draft({ full_name: 'Marie Dupont', title: 'Recruiter', company: 'Acme Software' }, [
      ev('full_name', 'Marie Dupont', 'https://acme.be/team'),
      ev('title', 'Recruiter', 'https://acme.be/team'),
      ev('company', 'Acme Software', 'https://www.linkedin.com/in/m', 'search_snippet'),
    ]);
    expect(contactConfidence(d, ctx)).toBe('LOW');
  });
});

describe('dedup (spec §5.5)', () => {
  const marie = draft({ full_name: 'Marie Dupont', title: 'IT Recruiter', company: 'Acme Software', city: 'Charleroi' }, [
    ev('full_name', 'Marie Dupont', 'https://acme.be/team'),
  ]);
  marie.id = 'm1';

  it('merges the same person seen on two sources', () => {
    const seen = draft({ full_name: 'Dupont Marie', title: 'IT Recruiter', company: 'Acme Software' }, [
      ev('full_name', 'Dupont Marie', 'https://be.linkedin.com/in/md', 'search_snippet'),
    ]);
    expect(pairScore(seen, marie)).toBe(90);
    expect(dedupDecision(seen, [marie])).toMatchObject({ kind: 'merge', score: 90 });
  });

  it('never merges two people who only share a name', () => {
    const namesake = draft({ full_name: 'Marie Dupont', title: 'IT Recruiter' }, [], {
      id: 'c2',
      name: 'Globex',
      domain: 'globex.be',
      isAgency: false,
    });
    expect(dedupDecision(namesake, [marie])).toMatchObject({ kind: 'flag', score: 60 });
    const elsewhere = draft({ full_name: 'Marie Dupont', title: 'Accountant' }, [], null);
    expect(dedupDecision(elsewhere, [marie])).toEqual({ kind: 'new' });
  });

  it('flags the 60–79 band instead of merging', () => {
    const maybe = draft({ full_name: 'Marie Dupont', title: 'Office manager', city: 'Charleroi' }, [], {
      id: 'c3',
      name: 'Initech',
      domain: 'initech.be',
      isAgency: false,
    });
    expect(dedupDecision(maybe, [marie])).toMatchObject({ kind: 'flag', score: 60 });
  });

  it('merges immediately on the same profile URL', () => {
    const a = draft({ full_name: 'M. Dupont', profile_url: 'https://be.linkedin.com/in/Marie-Dupont/' }, []);
    const b = draft({ full_name: 'Marie Dupont', profile_url: 'https://www.linkedin.com/in/marie-dupont?trk=x' }, []);
    b.id = 'b';
    expect(dedupDecision(a, [b])).toMatchObject({ kind: 'merge', reason: 'same profile URL' });
  });

  it('keeps the higher-confidence value per field and unions evidence on merge', () => {
    const fromLinkedIn = draft({ full_name: 'Marie Dupont', title: 'Recruiter' }, [
      ev('full_name', 'Marie Dupont', 'https://be.linkedin.com/in/md', 'search_snippet'),
      ev('title', 'Recruiter', 'https://be.linkedin.com/in/md', 'search_snippet'),
    ]);
    fromLinkedIn.id = 'l1';
    const fromSite = draft({ full_name: 'Marie Dupont', title: 'Senior IT Recruiter' }, [
      ev('full_name', 'Marie Dupont', 'https://acme.be/team'),
      ev('title', 'Senior IT Recruiter', 'https://acme.be/team'),
    ]);
    const merged = mergeDrafts(fromLinkedIn, fromSite, ctx);
    expect(merged.id).toBe('l1');
    expect(merged.fields.title).toBe('Senior IT Recruiter');
    expect(merged.evidence).toHaveLength(4);
  });
});
