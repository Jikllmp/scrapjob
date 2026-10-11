import { parsePage, SourceFailure, type ParsedPage, type SearchContext } from '@scrapjob/core';
import type { HttpClient } from '../http/client';

/**
 * Fetches and parses one HTML page for an adapter. A page that is missing,
 * disallowed by robots.txt, marked noindex or not HTML is skipped (null), not
 * a source failure; rate limits and server errors still propagate.
 */
export async function fetchPage(http: HttpClient, adapter: string, url: string, ctx: SearchContext): Promise<ParsedPage | null> {
  try {
    const res = await http.get(url, { adapter, ctx, headers: { accept: 'text/html' } });
    const type = res.headers['content-type'] ?? 'text/html';
    if (res.status !== 200 || !type.includes('html')) return null;
    const page = parsePage(res.body, res.url, ctx.taxonomy);
    if (page.noindex) {
      ctx.events.emit('ROBOTS_DISALLOWED', 'info', `${res.url} asks not to be indexed (meta robots)`, { adapter, url: res.url });
      return null;
    }
    return page;
  } catch (err) {
    if (err instanceof SourceFailure && err.error.kind === 'RobotsDisallowed') return null;
    throw err;
  }
}
