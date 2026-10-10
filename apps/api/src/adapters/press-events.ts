import {
  containsPhrase,
  registrableDomain,
  snippetAround,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { Company, ContactCandidate, EvidenceRef } from '@scrapjob/schema';
import type { HttpClient } from '../http/client';
import type { BraveSearch } from '../search/brave';
import { fetchPage } from './pages';

const EVENT_TERMS = '(speaker OR orateur OR oratrice OR intervenant OR spreker OR conférence OR conference OR meetup OR webinar OR communiqué)';
/** Pages read per employer. Speaker and press pages are long; two is enough to find the people who represent it. */
const PAGES_PER_COMPANY = 2;

/**
 * People who publicly represent an employer: conference speakers, meetup
 * hosts, people quoted in press releases. Found through the licensed search
 * index, then read on the event or press page itself. A person counts only if
 * the page names them with the employer on their own card.
 */
export class PressEventsAdapter implements SourceAdapter {
  readonly id = 'press-events';
  readonly displayName = 'Conferences, meetups and press';
  readonly capabilities = new Set(['people'] as const);

  constructor(
    private readonly search: BraveSearch,
    private readonly http: HttpClient,
  ) {}

  async isAvailable(): Promise<boolean> {
    return this.search.configured && this.http.canCrawl;
  }

  unavailableReason(): string {
    return this.search.configured ? 'USER_AGENT_CONTACT_URL is not set' : 'BRAVE_API_KEY is not set';
  }

  async *discoverCompanies() {}

  async *discoverJobs() {}

  async *discoverPeople(ctx: SearchContext, company: Company): AsyncIterable<ContactCandidate> {
    if (ctx.shouldStop()) return;
    const text = `"${company.name}" ${EVENT_TERMS}`;
    ctx.events.emit('QUERY_STARTED', 'info', text, { adapter: this.id, company: company.name });
    const results = await this.search.search(
      { text, lang: ctx.plan.location.languages[0] ?? 'fr', country: ctx.plan.location.countryCode },
      ctx,
      this.id,
    );
    const { aggregators } = ctx.taxonomy.hosts;
    const employer = company.domain ? registrableDomain(company.domain) : null;
    // The employer's own site is company-site's job; job boards and social networks are never read.
    const urls = results
      .map((r) => r.url)
      .filter((u) => {
        const domain = registrableDomain(u);
        return !aggregators.includes(domain) && domain !== employer;
      })
      .slice(0, PAGES_PER_COMPANY);
    let found = 0;
    for (const url of urls) {
      if (ctx.shouldStop()) break;
      const page = await fetchPage(this.http, this.id, url, ctx);
      if (!page) continue;
      const retrievedAt = new Date().toISOString();
      const ev = (field: EvidenceRef['field'], value: string, snippet: string): EvidenceRef => ({
        field,
        value,
        sourceUrl: page.url,
        snippet,
        sourceKind: 'page',
        retrievedAt,
        ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
      });
      for (const person of page.people) {
        // The person's own card (or contact line) must name the employer: a neighbour's card does not count.
        if (person.postingContact || !containsPhrase(person.nameSnippet, company.name)) continue;
        const companySnippet = snippetAround(person.nameSnippet, company.name) ?? person.nameSnippet;
        const evidence: EvidenceRef[] = [ev('full_name', person.fullName, person.nameSnippet), ev('company', company.name, companySnippet)];
        if (person.title && person.titleSnippet) evidence.push(ev('title', person.title, person.titleSnippet));
        found += 1;
        yield {
          fullName: person.fullName,
          ...(person.title ? { title: person.title } : {}),
          companyName: company.name,
          evidence,
        };
      }
    }
    ctx.events.emit('QUERY_COMPLETED', 'info', `${results.length} results, ${found} people representing ${company.name}`, {
      adapter: this.id,
      results: results.length,
    });
  }

  async enrich() {
    return {};
  }
}
