import type { SourceAdapter } from '@scrapjob/core';
import type { Db } from '../db/client';
import type { HttpClient } from '../http/client';
import type { BraveSearch } from '../search/brave';
import { CompanySiteAdapter } from './company-site';
import { JobBoardAdapter } from './job-board';
import { LinkedInPublicAdapter } from './linkedin-public';
import { noopAdapter } from './noop';
import { PressEventsAdapter } from './press-events';
import { RegistryAdapter } from './registry';
import { WebSearchAdapter } from './web-search';

export interface AdapterDeps {
  http: HttpClient;
  brave: BraveSearch;
  db: Db;
}

/**
 * Every known source. People sources are asked in this order, and deep
 * search asks enrich sources in this order: the employer's own site first, so
 * its VERIFIED values win. Adding a source means adding a file and one line here.
 */
export function createAdapters(deps: AdapterDeps): SourceAdapter[] {
  return [
    new WebSearchAdapter(deps.brave, deps.http),
    new RegistryAdapter(deps.db),
    new JobBoardAdapter(deps.http),
    new CompanySiteAdapter(deps.http),
    new LinkedInPublicAdapter(deps.brave),
    new PressEventsAdapter(deps.brave, deps.http),
    noopAdapter,
  ];
}
