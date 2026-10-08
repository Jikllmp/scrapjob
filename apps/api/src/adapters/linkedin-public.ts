import {
  clip,
  containsPhrase,
  parseLinkedInResult,
  sameEmployer,
  snippetAround,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { Company, ContactCandidate, EvidenceRef } from '@scrapjob/schema';
import type { BraveSearch } from '../search/brave';

const ROLE_TERMS = '(recruiter OR recruteur OR recruteuse OR "talent acquisition" OR RH OR HR OR CTO OR "engineering manager")';
const MAX_PER_COMPANY = 3;

/**
 * Reads LinkedIn profile titles exactly as the licensed search API returns
 * them (spec §6.2). Never fetches linkedin.com, never logs in. Everything it
 * yields is LOW confidence until another source confirms it.
 */
export class LinkedInPublicAdapter implements SourceAdapter {
  readonly id = 'linkedin-public';
  readonly displayName = 'LinkedIn titles (via web search)';
  readonly capabilities = new Set(['people'] as const);

  constructor(private readonly search: BraveSearch) {}

  async isAvailable(): Promise<boolean> {
    return this.search.configured;
  }

  unavailableReason(): string {
    return 'BRAVE_API_KEY is not set';
  }

  async *discoverCompanies() {}

  async *discoverJobs() {}

  async *discoverPeople(ctx: SearchContext, company: Company): AsyncIterable<ContactCandidate> {
    if (ctx.shouldStop()) return;
    const text = `site:linkedin.com/in "${company.name}" ${ROLE_TERMS}`;
    ctx.events.emit('QUERY_STARTED', 'info', text, { adapter: this.id, company: company.name });
    const results = await this.search.search(
      { text, lang: ctx.plan.location.languages[0] ?? 'fr', country: ctx.plan.location.countryCode },
      ctx,
      this.id,
    );
    let yielded = 0;
    for (const result of results) {
      if (yielded >= MAX_PER_COMPANY) break;
      const lead = parseLinkedInResult(result.url, result.title, ctx.taxonomy);
      if (!lead) continue;
      const retrievedAt = new Date().toISOString();
      const ev = (field: EvidenceRef['field'], value: string, snippet: string): EvidenceRef => ({
        field,
        value,
        sourceUrl: result.url,
        snippet: clip(snippet),
        sourceKind: 'search_snippet',
        retrievedAt,
        ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
      });

      const evidence: EvidenceRef[] = [ev('full_name', lead.fullName, result.title), ev('profile_url', result.url, result.url)];
      if (lead.title) evidence.push(ev('title', lead.title, result.title));
      let companyName = lead.companyName;
      if (companyName) {
        evidence.push(ev('company', companyName, result.title));
      } else {
        const around = snippetAround(result.description, company.name);
        if (around) {
          companyName = company.name;
          evidence.push(ev('company', company.name, around));
        }
      }
      if (companyName && !sameEmployer(companyName, company.name)) continue;
      const city = ctx.plan.location.areaNames.find((n) => containsPhrase(result.description, n));
      const citySnippet = city ? snippetAround(result.description, city) : null;
      if (city && citySnippet) evidence.push(ev('city', city, citySnippet));

      yielded += 1;
      yield {
        fullName: lead.fullName,
        ...(lead.title ? { title: lead.title } : {}),
        ...(companyName ? { companyName } : {}),
        profileUrl: result.url,
        ...(city && citySnippet ? { city } : {}),
        evidence,
      };
    }
    ctx.events.emit('QUERY_COMPLETED', 'info', `${results.length} results, ${yielded} profile titles for ${company.name}`, {
      adapter: this.id,
      results: results.length,
    });
  }

  async enrich() {
    return [];
  }
}
