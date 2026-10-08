import {
  clip,
  containsPhrase,
  registrableDomain,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { CompanyCandidateInput, EvidenceRef } from '@scrapjob/schema';
import type { BraveSearch, SearchResult } from '../search/brave';

const postingPath = /\/(jobs?|emplois?|offres?|vacatures?|careers?|carrieres?|carrières|vacancies|o|position|postes?)\b/i;
const genericSegments = /^(jobs?|emplois?|carri[eè]res?|careers?|vacatures?|recrutement|accueil|home|contact|offres? d['’]emploi)$/i;

function titleSegments(title: string): string[] {
  return title
    .split(/\s+[-–—|:·]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The company name as the result itself writes it, or the domain when it writes none. */
function companyName(result: SearchResult, host: string, text: string): string {
  const segments = titleSegments(result.title);
  const options = [result.siteName, segments.at(-1), segments[0]].filter((s): s is string => Boolean(s));
  for (const name of options) {
    if (name.length >= 2 && name.length <= 60 && !genericSegments.test(name) && text.toLowerCase().includes(name.toLowerCase())) {
      return name;
    }
  }
  return host;
}

/**
 * Discovers employers from the licensed search index (Brave). Never scrapes a
 * results page. Job boards, social networks and press are not employers and
 * are skipped; postings found on an employer's own site or ATS are attached.
 */
export class WebSearchAdapter implements SourceAdapter {
  readonly id = 'web-search';
  readonly displayName = 'Web search (Brave)';
  readonly capabilities = new Set(['companies'] as const);

  constructor(private readonly search: BraveSearch) {}

  async isAvailable(): Promise<boolean> {
    return this.search.configured;
  }

  unavailableReason(): string {
    return 'BRAVE_API_KEY is not set';
  }

  async *discoverCompanies(ctx: SearchContext): AsyncIterable<CompanyCandidateInput> {
    const seen = new Set<string>();
    const { hosts } = ctx.taxonomy;
    for (const query of ctx.plan.seeds) {
      if (ctx.shouldStop()) return;
      ctx.events.emit('QUERY_STARTED', 'info', query.text, { adapter: this.id, queryId: query.id });
      const results = await this.search.search(
        { text: query.text, lang: query.lang, country: ctx.plan.location.countryCode },
        ctx,
        this.id,
      );
      let yielded = 0;
      for (const result of results) {
        let url: URL;
        try {
          url = new URL(result.url);
        } catch {
          continue;
        }
        const domain = registrableDomain(url.hostname);
        if (hosts.aggregators.includes(domain) || hosts.media.includes(domain)) continue;
        const onAts = hosts.ats.includes(domain);
        const key = onAts ? url.hostname : domain;
        if (seen.has(key)) continue;
        seen.add(key);

        const retrievedAt = new Date().toISOString();
        const text = `${result.url} — ${result.title} — ${result.description}`;
        const snippet = clip(text);
        const name = companyName(result, onAts ? url.hostname : domain, snippet);
        const ev = (field: EvidenceRef['field'], value: string): EvidenceRef => ({
          field,
          value,
          sourceUrl: result.url,
          snippet,
          sourceKind: 'search_snippet',
          retrievedAt,
          ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
        });
        const evidence = [ev('name', name), ev('website', url.origin)];
        const city = ctx.plan.location.areaNames.find((n) => containsPhrase(snippet, n));
        if (city) evidence.push(ev('city', city));
        const isPosting =
          postingPath.test(url.pathname) && ctx.plan.positionTerms.some((t) => containsPhrase(result.title, t));

        yielded += 1;
        yield {
          name,
          website: url.origin,
          domain: onAts ? undefined : domain,
          city,
          isAgency: hosts.agencies.includes(domain),
          postings: isPosting
            ? [{ title: result.title, url: result.url, ...(result.pageAge ? { postedAt: result.pageAge } : {}) }]
            : [],
          evidence,
        };
      }
      ctx.events.emit('QUERY_COMPLETED', 'info', `${results.length} results, ${yielded} new employers`, {
        adapter: this.id,
        queryId: query.id,
        results: results.length,
        employers: yielded,
      });
    }
  }

  async *discoverJobs() {}

  async *discoverPeople() {}

  async enrich() {
    return [];
  }
}
