import type { Confidence } from '@scrapjob/schema';

export type LocationMatch = 'area' | 'country' | 'elsewhere' | 'unknown';

export interface ScoreInput {
  roleTier: number;
  roleArchetype: string;
  roleGenericOnly: boolean;
  hasOpenPosting: boolean;
  /** null when the employer's sector is not known yet. */
  sectorMatch: boolean | null;
  location: LocationMatch;
  locationName: string;
  confidence: Confidence;
  hasChannel: boolean;
  stale: boolean;
}

export interface Score {
  score: number;
  reasons: string[];
}

const tierPoints: Record<number, number> = { 1: 30, 2: 25, 3: 20, 4: 15, 5: 10 };
const confidencePoints: Partial<Record<Confidence, number>> = { VERIFIED: 15, HIGH: 10, MEDIUM: 5 };

/** Deterministic relevance score, 0–100, every point with a reason (spec §5.4). */
export function scoreContact(input: ScoreInput): Score {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${points > 0 ? '+' : '−'}${Math.abs(points)} ${reason}`);
  };

  add(tierPoints[input.roleTier] ?? 0, `tier ${input.roleTier} role (${input.roleArchetype})`);
  if (input.roleGenericOnly) add(-10, 'role matched only by a generic keyword');
  if (input.hasOpenPosting) add(20, 'employer has an open posting for this position');
  if (input.sectorMatch) add(10, "employer's sector matches the position");
  if (input.location === 'area') add(15, `works in ${input.locationName}`);
  else if (input.location === 'country') add(7, 'works in the same country, another city');
  const conf = confidencePoints[input.confidence];
  if (conf) add(conf, `confidence ${input.confidence}`);
  if (input.hasChannel) add(10, 'published professional contact channel');
  if (input.stale) add(-15, 'evidence older than 24 months');

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
