import {
  containsPhrase,
  normaliseName,
  registrableDomain,
  sameEmployer,
  snippetAround,
  type EnrichTarget,
  type ParsedPage,
  type SearchContext,
  type SourceAdapter,
} from '@scrapjob/core';
import type { Company, ContactCandidate, EnrichResultInput, EvidencePatch, EvidenceRef, PostingCandidate } from '@scrapjob/schema';
import type { HttpClient } from '../http/client';
import { fetchPage } from './pages';

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
  readonly capabilities = new Set(['people', 'enrich'] as const);

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
    for (const page of await this.employerPages(ctx, company)) {
      for (const candidate of this.candidates(page, company)) yield candidate;
    }
  }

  /**
   * Deep search: re-reads the employer's pages to confirm the person still
   * appears there with that title, and picks up a published email and a
   * posting for the position.
   */
  async enrich(ctx: SearchContext, target: EnrichTarget): Promise<EnrichResultInput> {
    const { company } = target;
    const name = target.fields.full_name;
    if (!company || !name) return {};
    const patches: EvidencePatch[] = [];
    const postings: PostingCandidate[] = [];
    for (const page of await this.employerPages(ctx, company)) {
      for (const candidate of this.candidates(page, company)) {
        if (normaliseName(candidate.fullName) !== normaliseName(name)) continue;
        for (const evidence of candidate.evidence) patches.push({ field: evidence.field, evidence });
      }
      for (const job of page.jobPostings) {
        if (ctx.plan.positionTerms.some((t) => containsPhrase(job.title, t))) {
          postings.push({ title: job.title, url: page.url, ...(job.datePosted ? { postedAt: job.datePosted } : {}) });
        }
      }
    }
    return { patches, postings };
  }

  /** The home page, then up to four team, about, careers or contact pages it links to. */
  private async employerPages(ctx: SearchContext, company: Company): Promise<ParsedPage[]> {
    if (!company.website || ctx.shouldStop()) return [];
    const home = await fetchPage(this.http, this.id, new URL(company.website).toString(), ctx);
    if (!home) return [];
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
      const page = await fetchPage(this.http, this.id, href, ctx);
      if (page) pages.push(page);
    }
    return pages;
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
