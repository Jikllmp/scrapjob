import {
  clip,
  containsPhrase,
  normaliseName,
  registrableDomain,
  snippetAround,
  type EnrichTarget,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { CompanyCandidateInput, EnrichResultInput, EvidencePatch, EvidenceRef, PostingCandidate } from '@scrapjob/schema';
import type { HttpClient } from '../http/client';
import type { BraveSearch, SearchResult } from '../search/brave';
import { fetchPage } from './pages';

/** Pages a deep search reads from the person's search results. */
const ENRICH_PAGES = 3;
/** How close the employer must be to the person's name in running text: about two sentences. */
const PASSAGE = 240;

const postingPath = /\/(jobs?|emplois?|offres?|vacatures?|careers?|carrieres?|carrières|vacancies|o|position|postes?)\b/i;
const genericSegments = /^(jobs?|emplois?|carri[eè]res?|careers?|vacatures?|recrutement|accueil|home|contact|offres? d['’]emploi)$/i;

/** ATS hosts shared by every customer, where the account is the first path segment. */
const sharedAtsHost = /^(jobs(\.eu)?\.lever\.co|(job-)?boards(\.eu)?\.greenhouse\.io|apply\.workable\.com|jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com|join\.com)$/i;

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
  readonly capabilities = new Set(['companies', 'enrich'] as const);

  constructor(
    private readonly search: BraveSearch,
    private readonly http: HttpClient,
  ) {}

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
        // On an ATS the employer is the subdomain (acme.recruitee.com) or, on a shared host, the first path
        // segment (jobs.lever.co/acme, boards.greenhouse.io/acme): that is its careers site.
        const atsAccount = onAts && sharedAtsHost.test(url.hostname) ? url.pathname.split('/').filter(Boolean)[0] : undefined;
        const website = atsAccount ? `${url.origin}/${atsAccount}` : url.origin;
        const key = onAts ? website : domain;
        if (seen.has(key)) continue;
        seen.add(key);

        const retrievedAt = new Date().toISOString();
        const text = `${result.url} — ${result.title} — ${result.description}`;
        const snippet = clip(text);
        const name = companyName(result, onAts ? (atsAccount ?? url.hostname) : domain, snippet);
        const ev = (field: EvidenceRef['field'], value: string): EvidenceRef => ({
          field,
          value,
          sourceUrl: result.url,
          snippet,
          sourceKind: 'search_snippet',
          retrievedAt,
          ...(result.pageAge ? { publishedAt: result.pageAge } : {}),
        });
        const evidence = [ev('name', name), ev('website', website)];
        const city = ctx.plan.location.areaNames.find((n) => containsPhrase(snippet, n));
        if (city) evidence.push(ev('city', city));
        const isPosting =
          postingPath.test(url.pathname) && ctx.plan.positionTerms.some((t) => containsPhrase(result.title, t));

        yielded += 1;
        yield {
          name,
          website,
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

  /**
   * Deep search: looks the person up by name and employer, then reads the
   * pages that come back (press, conference, partner sites). A page counts only
   * if the person's name and the employer appear in the same passage.
   */
  async enrich(ctx: SearchContext, target: EnrichTarget): Promise<EnrichResultInput> {
    const name = target.fields.full_name;
    const company = target.company;
    // Snippets alone add nothing here; the pages are the point, and none is read without a contact URL.
    if (!name || !company || ctx.shouldStop() || !this.http.canCrawl) return {};
    const text = `"${name}" "${company.name}"`;
    ctx.events.emit('QUERY_STARTED', 'info', text, { adapter: this.id });
    const results = await this.search.search(
      { text, lang: ctx.plan.location.languages[0] ?? 'fr', country: ctx.plan.location.countryCode },
      ctx,
      this.id,
    );
    const { aggregators } = ctx.taxonomy.hosts;
    const urls = results.map((r) => r.url).filter((u) => !aggregators.includes(registrableDomain(u))).slice(0, ENRICH_PAGES);
    const patches: EvidencePatch[] = [];
    const postings: PostingCandidate[] = [];
    let confirming = 0;
    for (const url of urls) {
      if (ctx.shouldStop()) break;
      const page = await fetchPage(this.http, this.id, url, ctx);
      if (!page) continue;
      const person = page.people.find((p) => normaliseName(p.fullName) === normaliseName(name));
      // Their card names the employer, or the employer is named within a sentence or two of them.
      const passage = person && containsPhrase(person.nameSnippet, company.name) ? person.nameSnippet : snippetAround(page.text, name, PASSAGE);
      if (!passage || !containsPhrase(passage, company.name)) continue;
      confirming += 1;
      const retrievedAt = new Date().toISOString();
      const ev = (field: EvidenceRef['field'], value: string, snippet: string): EvidencePatch => ({
        field,
        evidence: {
          field,
          value,
          sourceUrl: page.url,
          snippet,
          sourceKind: 'page',
          retrievedAt,
          ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
        },
      });
      patches.push(ev('full_name', name, passage), ev('company', company.name, snippetAround(passage, company.name) ?? passage));
      if (person?.title && person.titleSnippet) patches.push(ev('title', person.title, person.titleSnippet));
      // Only a work address on the employer's own domain: a personal address is never collected (spec §2.2).
      const workDomain = company.domain ? registrableDomain(company.domain) : null;
      if (person?.email && person.emailSnippet && workDomain && registrableDomain(person.email.split('@')[1] ?? '') === workDomain) {
        patches.push(ev('email', person.email, person.emailSnippet));
      }
      for (const job of page.jobPostings) {
        if (ctx.plan.positionTerms.some((t) => containsPhrase(job.title, t))) postings.push({ title: job.title, url: page.url });
      }
    }
    ctx.events.emit('QUERY_COMPLETED', 'info', `${results.length} results, ${confirming} pages name ${name} with ${company.name}`, {
      adapter: this.id,
      results: results.length,
    });
    return { patches, postings };
  }
}
