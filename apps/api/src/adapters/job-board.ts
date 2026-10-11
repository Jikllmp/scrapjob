import { z } from 'zod';
import { SourceFailure, sourceFailure, type SearchContext, type SourceAdapter } from '@scrapjob/core';
import type { Company, JobCandidate } from '@scrapjob/schema';
import type { HttpClient } from '../http/client';

/**
 * A public job feed that an applicant-tracking system documents for
 * embedding an employer's openings on its own site.
 */
interface Feed {
  ats: string;
  url: string;
  parse(body: unknown): { title: string; url: string; location: string | null; postedAt: string | null }[];
}

const RecruiteeOffers = z.object({
  offers: z.array(
    z.object({
      title: z.string(),
      careers_url: z.string(),
      city: z.string().nullish(),
      published_at: z.string().nullish(),
    }),
  ),
});

const LeverPostings = z.array(
  z.object({
    text: z.string(),
    hostedUrl: z.string(),
    categories: z.object({ location: z.string().nullish() }).partial().nullish(),
    createdAt: z.number().nullish(),
  }),
);

const GreenhouseJobs = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.string(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      updated_at: z.string().nullish(),
    }),
  ),
});

function iso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The employer's job feed, when its careers site is hosted on an ATS with a documented public feed. */
export function feedFor(website: string): Feed | null {
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const firstSegment = url.pathname.split('/').filter(Boolean)[0];
  const recruitee = /^([a-z0-9-]+)\.recruitee\.com$/.exec(host);
  if (recruitee) {
    return {
      ats: 'Recruitee',
      url: `https://${recruitee[1]}.recruitee.com/api/offers/`,
      parse: (body) =>
        RecruiteeOffers.parse(body).offers.map((o) => ({
          title: o.title,
          url: o.careers_url,
          location: o.city ?? null,
          postedAt: iso(o.published_at),
        })),
    };
  }
  const lever = /^jobs\.(eu\.)?lever\.co$/.exec(host);
  if (lever && firstSegment) {
    return {
      ats: 'Lever',
      url: `https://api.${lever[1] ?? ''}lever.co/v0/postings/${encodeURIComponent(firstSegment)}?mode=json`,
      parse: (body) =>
        LeverPostings.parse(body).map((p) => ({
          title: p.text,
          url: p.hostedUrl,
          location: p.categories?.location ?? null,
          postedAt: iso(p.createdAt),
        })),
    };
  }
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host) && firstSegment) {
    return {
      ats: 'Greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(firstSegment)}/jobs`,
      parse: (body) =>
        GreenhouseJobs.parse(body).jobs.map((j) => ({
          title: j.title,
          url: j.absolute_url,
          location: j.location?.name ?? null,
          postedAt: iso(j.updated_at),
        })),
    };
  }
  return null;
}

/**
 * Open postings from the public job feeds that applicant-tracking systems
 * document for employers (Recruitee, Lever, Greenhouse). Commercial job boards
 * and the Le Forem open-data API are not used: see docs/LIMITATIONS.md.
 */
export class JobBoardAdapter implements SourceAdapter {
  readonly id = 'job-board';
  readonly displayName = 'Employer job feeds (ATS)';
  readonly capabilities = new Set(['jobs'] as const);

  constructor(private readonly http: HttpClient) {}

  async isAvailable(): Promise<boolean> {
    return this.http.canCrawl;
  }

  unavailableReason(): string {
    return 'USER_AGENT_CONTACT_URL is not set, and no feed is read without one';
  }

  async *discoverCompanies() {}

  async *discoverJobs(ctx: SearchContext, company: Company): AsyncIterable<JobCandidate> {
    const feed = company.website ? feedFor(company.website) : null;
    if (!feed || ctx.shouldStop()) return;
    let res;
    try {
      res = await this.http.get(feed.url, { adapter: this.id, ctx, headers: { accept: 'application/json' } });
    } catch (err) {
      if (err instanceof SourceFailure && err.error.kind === 'RobotsDisallowed') return;
      throw err;
    }
    if (res.status === 404) return;
    if (res.status !== 200) throw sourceFailure(this.id, 'SourceUnavailable', `${feed.ats} feed answered HTTP ${res.status}`, feed.url);
    let postings;
    try {
      postings = feed.parse(JSON.parse(res.body));
    } catch {
      throw sourceFailure(this.id, 'ParseFailed', `${feed.ats} feed is not in the documented format`, feed.url);
    }
    const retrievedAt = new Date().toISOString();
    for (const p of postings) {
      if (p.url.length > 400) continue;
      const snippet = `${p.title.slice(0, 90)} — ${p.url}`;
      yield {
        companyName: company.name,
        title: p.title,
        url: p.url,
        ...(p.postedAt ? { postedAt: p.postedAt } : {}),
        ...(p.location ? { location: p.location } : {}),
        evidence: [{ field: 'website', value: p.url, sourceUrl: feed.url, snippet, sourceKind: 'page', retrievedAt }],
      };
    }
  }

  async *discoverPeople() {}

  async enrich() {
    return {};
  }
}
