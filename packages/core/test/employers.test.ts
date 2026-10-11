import { describe, expect, it } from 'vitest';
import { employersFor, fieldConfidence, linkedInPeopleSearchUrl, parseEmployers, planQueries, TaxonomyError } from '../src';
import shipped from '../../../config/employers.yaml?raw';
import { taxonomy } from './helpers';

const list = parseEmployers(`
employers:
  - name: Acme Software
    website: https://www.acme-software.test
    city: Gosselies
    fields: [software]
  - name: Beton Wallon
    city: Charleroi
    fields: [construction]
  - name: Ville de Charleroi
    city: Charleroi
  - name: Mons Digital
    city: Mons
`);

describe('employer list', () => {
  it('parses the shipped file', () => {
    expect(parseEmployers(shipped).length).toBeGreaterThan(0);
  });

  it('treats an empty file as an empty list', () => {
    expect(parseEmployers('')).toEqual([]);
    expect(parseEmployers('employers:\n')).toEqual([]);
  });

  it('names the file and the field when an entry is malformed', () => {
    expect(() => parseEmployers('employers:\n  - name: X\n    website: not a url\n    city: Mons\n')).toThrow(TaxonomyError);
    expect(() => parseEmployers('employers:\n  - name: X\n')).toThrow(/employers\.yaml is malformed:\n {2}employers\.0\.city/);
  });

  it('keeps employers inside the area (sections included) and in the position’s field', () => {
    const plan = planQueries('Charleroi', 'Développeur .NET', taxonomy);
    expect(employersFor(list, plan.location, plan.field).map((e) => e.name)).toEqual(['Acme Software', 'Ville de Charleroi']);
  });

  it('keeps every field when the position is unknown', () => {
    const plan = planQueries('Charleroi', 'Astronaut', taxonomy);
    expect(employersFor(list, plan.location, plan.field).map((e) => e.name)).toEqual(['Acme Software', 'Beton Wallon', 'Ville de Charleroi']);
  });
});

describe('linkedInPeopleSearchUrl', () => {
  it('builds a people search for the employer’s recruiters', () => {
    const url = new URL(linkedInPeopleSearchUrl('Acme "Software"'));
    expect(url.hostname).toBe('www.linkedin.com');
    expect(url.pathname).toBe('/search/results/people/');
    expect(url.searchParams.get('keywords')).toBe('"Acme Software" (recruiter OR recruteur OR "talent acquisition" OR RH OR HR OR "ressources humaines")');
  });
});

describe('user evidence', () => {
  it('is MEDIUM: one source, but checked by a person', () => {
    const e = {
      field: 'full_name' as const,
      value: 'Julie Renard',
      sourceUrl: 'https://linkedin.com/in/julie-renard',
      snippet: 'Added by you from https://linkedin.com/in/julie-renard: Julie Renard',
      sourceKind: 'user' as const,
      retrievedAt: '2026-10-11T00:00:00Z',
      sourceAdapter: 'manual',
    };
    expect(fieldConfidence('Julie Renard', [e], null, [], { taxonomy, now: new Date('2026-10-11') })).toBe('MEDIUM');
  });
});
