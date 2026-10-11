import { describe, expect, it } from 'vitest';
import { scoreContact, type ScoreInput } from '../src';

const base: ScoreInput = {
  roleTier: 1,
  roleArchetype: 'tech-recruiter',
  roleGenericOnly: false,
  hasOpenPosting: false,
  sectorMatch: null,
  location: 'unknown',
  locationName: 'Charleroi',
  confidence: 'LOW',
  hasChannel: false,
  stale: false,
};

describe('scoreContact', () => {
  it.each<[string, Partial<ScoreInput>, number, string[]]>([
    ['tier 1 alone', {}, 30, ['+30 tier 1 role (tech-recruiter)']],
    [
      'everything at its best',
      { hasOpenPosting: true, sectorMatch: true, location: 'area', confidence: 'VERIFIED', hasChannel: true },
      100,
      [
        '+30 tier 1 role (tech-recruiter)',
        '+20 employer has an open posting for this position',
        "+10 employer's sector matches the position",
        '+15 works in Charleroi',
        '+15 confidence VERIFIED',
        '+10 published professional contact channel',
      ],
    ],
    [
      'LinkedIn-only recruiter in the area (the ANALYSIS §5.1 case)',
      { location: 'area', hasChannel: true },
      55,
      ['+30 tier 1 role (tech-recruiter)', '+15 works in Charleroi', '+10 published professional contact channel'],
    ],
    [
      'generic manager, same country, HIGH, stale',
      { roleTier: 4, roleArchetype: 'cto', roleGenericOnly: true, location: 'country', confidence: 'HIGH', stale: true },
      7,
      [
        '+15 tier 4 role (cto)',
        '−10 role matched only by a generic keyword',
        '+7 works in the same country, another city',
        '+10 confidence HIGH',
        '−15 evidence older than 24 months',
      ],
    ],
    [
      'clamped at 0',
      { roleTier: 5, roleArchetype: 'posting-contact', roleGenericOnly: true, stale: true },
      0,
      ['+10 tier 5 role (posting-contact)', '−10 role matched only by a generic keyword', '−15 evidence older than 24 months'],
    ],
    ['MEDIUM confidence', { confidence: 'MEDIUM', roleTier: 2, roleArchetype: 'hiring-manager' }, 30, ['+25 tier 2 role (hiring-manager)', '+5 confidence MEDIUM']],
  ])('%s', (_name, overrides, score, reasons) => {
    expect(scoreContact({ ...base, ...overrides })).toEqual({ score, reasons });
  });
});
