import type { Taxonomy } from '../taxonomy';
import { containsPhrase } from '../text/normalise';

export interface RoleMatch {
  archetype: string;
  tier: number;
  /** Matched only through a broad keyword such as "manager". */
  genericOnly: boolean;
  keyword: string;
}

/** Best (lowest tier) archetype whose keyword appears in the title as whole words. */
export function classifyTitle(title: string, taxonomy: Taxonomy): RoleMatch | null {
  let best: RoleMatch | null = null;
  for (const a of [...taxonomy.roles.archetypes].sort((x, y) => x.tier - y.tier)) {
    const specific = a.keywords.find((k) => containsPhrase(title, k));
    if (specific) return { archetype: a.key, tier: a.tier, genericOnly: false, keyword: specific };
    const generic = a.generic_keywords.find((k) => containsPhrase(title, k));
    if (generic && !best) best = { archetype: a.key, tier: a.tier, genericOnly: true, keyword: generic };
  }
  return best;
}

/** The archetype used for a person named as the contact on a job posting. */
export function postingContactRole(taxonomy: Taxonomy): RoleMatch {
  const tier5 = taxonomy.roles.archetypes.find((a) => a.tier === 5);
  return { archetype: tier5?.key ?? 'posting-contact', tier: 5, genericOnly: false, keyword: 'job posting contact' };
}
