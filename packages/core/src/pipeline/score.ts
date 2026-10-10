import type { Company } from '@scrapjob/schema';
import { contactConfidence, isStale, type ConfidenceContext } from '../contacts/confidence';
import type { ContactDraft } from '../contacts/fields';
import { scoreContact, type LocationMatch } from '../contacts/scoring';
import type { QueryPlan } from '../planning/queries';
import { sectorMatches, type Taxonomy } from '../taxonomy';
import { containsPhrase } from '../text/normalise';
import type { ScoredDraft } from './store';

/** What the score needs to know about the employer. */
export interface EmployerFacts {
  company: Company;
  hasPosting: boolean;
}

export interface ScoringContext {
  plan: QueryPlan;
  taxonomy: Taxonomy;
  now: Date;
}

export function locationOf(draft: ContactDraft, company: Company, plan: QueryPlan): LocationMatch {
  const city = draft.fields.city ?? company.city;
  if (city && plan.location.areaNames.some((n) => containsPhrase(city, n))) return 'area';
  const country = draft.fields.country ?? company.country;
  if (city || country) {
    if (country && plan.location.countryCode && containsPhrase(country, plan.location.countryCode)) return 'country';
    if (country && plan.location.countryName && containsPhrase(country, plan.location.countryName)) return 'country';
    return 'elsewhere';
  }
  return 'unknown';
}

/** Confidence and relevance score of a draft, as the search and the deep search both compute them. */
export function scoreDraft(draft: ContactDraft, employer: EmployerFacts, ctx: ScoringContext): ScoredDraft {
  const confCtx: ConfidenceContext = { taxonomy: ctx.taxonomy, now: ctx.now };
  const confidence = contactConfidence(draft, confCtx);
  const identity = draft.evidence.filter((e) => e.field === 'full_name' || e.field === 'title');
  const score = scoreContact({
    roleTier: draft.roleTier,
    roleArchetype: draft.roleArchetype,
    roleGenericOnly: draft.roleGenericOnly,
    hasOpenPosting: employer.hasPosting,
    sectorMatch: sectorMatches(ctx.plan.field, employer.company.naceCode, ctx.taxonomy),
    location: locationOf(draft, employer.company, ctx.plan),
    locationName: ctx.plan.location.place?.name ?? ctx.plan.location.input,
    confidence,
    hasChannel: draft.fields.email !== undefined || draft.fields.profile_url !== undefined,
    stale: identity.length > 0 && identity.every((e) => isStale(e, ctx.now)),
  });
  return { draft, score, confidence };
}
