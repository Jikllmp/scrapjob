import { z } from 'zod';
import { sourceFailure, type Lang, type SearchContext } from '@scrapjob/core';
import type { HttpClient } from '../http/client';

const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const BraveResponse = z.object({
  web: z
    .object({
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string().optional(),
          page_age: z.string().optional(),
          profile: z.object({ name: z.string().optional() }).optional(),
        }),
      ),
    })
    .optional(),
});

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  pageAge: string | null;
  siteName: string | null;
}

export interface SearchQuery {
  text: string;
  lang: Lang;
  country: string | null;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Brave Search API: licensed access to a web index (ADR 0001). Results are
 * cached per search so that two adapters asking the same question pay once.
 */
export class BraveSearch {
  private readonly cache = new Map<string, Promise<SearchResult[]>>();

  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string | undefined,
  ) {}

  get configured(): boolean {
    return this.apiKey !== undefined;
  }

  search(query: SearchQuery, ctx: SearchContext, adapter: string): Promise<SearchResult[]> {
    const key = `${ctx.searchId}\u0000${query.lang}\u0000${query.country}\u0000${query.text}`;
    let pending = this.cache.get(key);
    if (!pending) {
      pending = this.fetch(query, ctx, adapter);
      this.cache.set(key, pending);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }

  private async fetch(query: SearchQuery, ctx: SearchContext, adapter: string): Promise<SearchResult[]> {
    if (!this.apiKey) throw sourceFailure(adapter, 'AuthRequired', 'BRAVE_API_KEY is not set');
    const url = new URL(BRAVE_ENDPOINT);
    url.searchParams.set('q', query.text);
    url.searchParams.set('count', '20');
    url.searchParams.set('search_lang', query.lang);
    if (query.country) url.searchParams.set('country', query.country);
    url.searchParams.set('safesearch', 'moderate');

    const res = await this.http.get(url.toString(), {
      adapter,
      ctx,
      robots: false,
      budget: 'search_api',
      headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
    });
    if (res.status === 401) throw sourceFailure(adapter, 'AuthRequired', 'Brave rejected the API key', BRAVE_ENDPOINT);
    if (res.status === 402) throw sourceFailure(adapter, 'QuotaExceeded', 'Brave plan quota exhausted', BRAVE_ENDPOINT);
    if (res.status !== 200) throw sourceFailure(adapter, 'SourceUnavailable', `HTTP ${res.status}`, BRAVE_ENDPOINT);

    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw sourceFailure(adapter, 'ParseFailed', 'response is not JSON', BRAVE_ENDPOINT);
    }
    const parsed = BraveResponse.safeParse(json);
    if (!parsed.success) throw sourceFailure(adapter, 'ParseFailed', 'unexpected response shape', BRAVE_ENDPOINT);
    return (parsed.data.web?.results ?? []).map((r) => ({
      title: stripTags(r.title),
      url: r.url,
      description: stripTags(r.description ?? ''),
      pageAge: isoOrNull(r.page_age),
      siteName: r.profile?.name?.trim() || null,
    }));
  }
}
