import type { SourceAdapter } from '@scrapjob/core';
import type { HttpClient } from '../http/client';
import type { BraveSearch } from '../search/brave';
import { CompanySiteAdapter } from './company-site';
import { LinkedInPublicAdapter } from './linkedin-public';
import { noopAdapter } from './noop';
import { WebSearchAdapter } from './web-search';

export interface AdapterDeps {
  http: HttpClient;
  brave: BraveSearch;
}

/**
 * Every known source, in the order people sources are asked: the employer's
 * own site first, so its VERIFIED values win. Adding a source means adding a
 * file and one line here.
 */
export function createAdapters(deps: AdapterDeps): SourceAdapter[] {
  return [new WebSearchAdapter(deps.brave), new CompanySiteAdapter(deps.http), new LinkedInPublicAdapter(deps.brave), noopAdapter];
}
