import {
  parsePage,
  registrableDomain,
  sameEmployer,
  snippetAround,
  SourceFailure,
  type ParsedPage,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { Company, ContactCandidate, EvidenceRef } from '@scrapjob/schema';
import type { HttpClient } from '../http/client';

const MAX_PAGES = 4;

/** Pages most likely to name people, best first. */
const pageHints: [RegExp, number][] = [
  [/(equipe|équipe|team|qui-sommes-nous|about|a-propos|à-propos|over-ons|wie-zijn-we|management|direction|leadership|people)/i, 1],
  [/(carri[eè]res?|careers?|jobs?|emplois?|vacatures?|werken-bij|rejoignez|join-us|recrutement|\/o\/)/i, 2],
  [/(contact)/i, 3],
];

function rankLink(href: string, text: string): number | null {
  const haystack = `${decodeURIComponent(new URL(href).pathname)} ${text}`;
  for (const [pattern, rank] of pageHints) if (pattern.test(haystack)) return rank;
  return null;
}

/**
 * Reads the employer's own site: home page, then up to four team, about,
 * careers or contact pages it links to (including its ATS careers site).
 * The highest-confidence source: the employer publishing its own people.
 */
export class CompanySiteAdapter implements SourceAdapter {
  readonly id = 'company-site';
  readonly displayName = 'Employer websites';
  readonly capabilities = new Set(['people'] as const);

  constructor(private readonly http: HttpClient) {}

  async isAvailable(): Promise<boolean> {
    return this.http.canCrawl;
  }

  unavailableReason(): string {
    return 'USER_AGENT_CONTACT_URL is not set, and no site is crawled without one';
  }

  async *discoverCompanies() {}

  async *discoverJobs() {}

  async *discoverPeople(ctx: SearchContext, company: Company): AsyncIterable<ContactCandidate> {
    if (!company.website || ctx.shouldStop()) return;
    const home = await this.fetchPage(new URL(company.website).toString(), ctx);
    if (!home) return;
    const pages: ParsedPage[] = [home];
    const allowed = new Set([registrableDomain(home.url), ...ctx.taxonomy.hosts.ats]);
    const ranked = home.links
      .filter((l) => allowed.has(registrableDomain(l.href)) && l.href !== home.url)
      .map((l) => ({ href: l.href, rank: rankLink(l.href, l.text) }))
      .filter((l): l is { href: string; rank: number } => l.rank !== null)
      .sort((a, b) => a.rank - b.rank);
    const targets = [...new Set(ranked.map((l) => l.href))].slice(0, MAX_PAGES);

    for (const href of targets) {
      if (ctx.shouldStop()) break;
      const page = await this.fetchPage(href, ctx);
      if (page) pages.push(page);
    }
    for (const page of pages) {
      for (const candidate of this.candidates(page, company)) yield candidate;
    }
  }

  async enrich() {
    return [];
  }

  /** Fetches and parses one page; a page that is missing, disallowed or not HTML is skipped, not a failure. */
  private async fetchPage(url: string, ctx: SearchContext): Promise<ParsedPage | null> {
    try {
      const res = await this.http.get(url, { adapter: this.id, ctx, headers: { accept: 'text/html' } });
      const type = res.headers['content-type'] ?? 'text/html';
      if (res.status !== 200 || !type.includes('html')) return null;
      const page = parsePage(res.body, res.url, ctx.taxonomy);
      if (page.noindex) {
        ctx.events.emit('ROBOTS_DISALLOWED', 'info', `${res.url} asks not to be indexed (meta robots)`, {
          adapter: this.id,
          url: res.url,
        });
        return null;
      }
      return page;
    } catch (err) {
      if (err instanceof SourceFailure && err.error.kind === 'RobotsDisallowed') return null;
      throw err;
    }
  }

  private *candidates(page: ParsedPage, company: Company): Iterable<ContactCandidate> {
    const companySnippet = snippetAround(page.text, company.name) ?? (sameEmployer(page.title, company.name) ? page.title : null);
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
    for (const p of page.people) {
      const evidence: EvidenceRef[] = [ev('full_name', p.fullName, p.nameSnippet)];
      if (p.title && p.titleSnippet) evidence.push(ev('title', p.title, p.titleSnippet));
      if (p.email && p.emailSnippet) evidence.push(ev('email', p.email, p.emailSnippet));
      if (p.profileUrl && p.profileSnippet) evidence.push(ev('profile_url', p.profileUrl, p.profileSnippet));
      if (companySnippet) evidence.push(ev('company', company.name, companySnippet));
      yield {
        fullName: p.fullName,
        ...(p.title ? { title: p.title } : {}),
        ...(p.email ? { email: p.email } : {}),
        ...(p.profileUrl ? { profileUrl: p.profileUrl } : {}),
        ...(companySnippet ? { companyName: company.name } : {}),
        postingContact: p.postingContact,
        evidence,
      };
    }
  }
}
