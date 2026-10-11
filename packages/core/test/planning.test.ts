import { describe, expect, it } from 'vitest';
import { MAX_SEED_QUERIES, classifyTitle, planQueries, resolveLocation } from '../src';
import { taxonomy } from './helpers';

describe('planQueries', () => {
  it('is deterministic for the same input', () => {
    expect(planQueries('Charleroi', 'Développeur .NET', taxonomy)).toEqual(
      planQueries('Charleroi', 'Développeur .NET', taxonomy),
    );
  });

  it('never exceeds the 12-query cap and has no duplicates', () => {
    for (const [loc, pos] of [
      ['Charleroi', 'Développeur .NET'],
      ['Bruxelles', 'Full stack developer React TypeScript'],
      ['Nowhere', 'Astronaut'],
    ] as const) {
      const plan = planQueries(loc, pos, taxonomy);
      expect(plan.seeds.length).toBeLessThanOrEqual(MAX_SEED_QUERIES);
      expect(new Set(plan.seeds.map((q) => q.text)).size).toBe(plan.seeds.length);
    }
  });

  it('puts career pages first, then jobs, then companies', () => {
    const intents = planQueries('Charleroi', 'Développeur .NET', taxonomy).seeds.map((q) => q.intent);
    const firstJob = intents.indexOf('jobs');
    const firstCompany = intents.indexOf('companies');
    expect(intents[0]).toBe('careers');
    expect(firstJob).toBeGreaterThan(0);
    expect(firstCompany === -1 || firstCompany > firstJob).toBe(true);
  });

  it('expands the position with synonyms and the location with its province', () => {
    const plan = planQueries('charleroi', 'Développeur .NET', taxonomy);
    expect(plan.positionKey).toBe('dotnet-developer');
    expect(plan.positionTerms).toContain('C# Developer');
    expect(plan.seeds.some((q) => q.text.includes('Hainaut'))).toBe(true);
    expect(plan.seeds[0]?.text).toBe('"Développeur .NET" Charleroi emploi');
  });

  it('searches an unknown location as typed', () => {
    const plan = planQueries('Timbuktu', 'Baker', taxonomy);
    expect(plan.location.place).toBeNull();
    expect(plan.seeds.every((q) => q.text.includes('Timbuktu'))).toBe(true);
  });
});

describe('resolveLocation', () => {
  it('treats commune sections as inside the area', () => {
    const loc = resolveLocation('Charleroi', taxonomy);
    expect(loc.areaNames).toEqual(expect.arrayContaining(['Gosselies', 'Marcinelle']));
    expect(loc.countryCode).toBe('BE');
  });

  it('matches aliases in other languages', () => {
    expect(resolveLocation('Luik', taxonomy).place?.name).toBe('Liège');
  });
});

describe('classifyTitle', () => {
  it.each([
    ['Talent Acquisition Specialist', 1, false],
    ['Recruteuse IT', 1, false],
    ['Engineering Manager', 2, false],
    ['Teamleider .NET', 2, false],
    ['HR Business Partner', 3, false],
    ['Responsable RH', 3, false],
    ['CTO & co-founder', 4, false],
    ['Directeur technique', 4, false],
    ['Sales Manager', 4, true],
  ])('%s → tier %i (generic: %s)', (title, tier, generic) => {
    expect(classifyTitle(title, taxonomy)).toMatchObject({ tier, genericOnly: generic });
  });

  it.each(['Directrice commerciale adjointe', 'Commercial director', 'Senior .NET Developer', 'Comptable'])(
    'does not misread %s as a hiring role through a word fragment',
    (title) => {
      const match = classifyTitle(title, taxonomy);
      expect(match === null || match.genericOnly).toBe(true);
    },
  );
});
