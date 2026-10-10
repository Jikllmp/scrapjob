import type { AdapterRegistry, Taxonomy } from '@scrapjob/core';
import type { Config } from './config';
import type { Db } from './db/client';
import type { EventBus } from './events/bus';
import type { EventStore } from './events/store';
import type { DeepSearchRunner } from './deep-search/runner';
import type { SearchRunner } from './searches/runner';
import type { RetentionJob } from './privacy/retention';

export interface AppContext {
  config: Config;
  db: Db;
  bus: EventBus;
  events: EventStore;
  registry: AdapterRegistry;
  runner: SearchRunner;
  deepSearch: DeepSearchRunner;
  retention: RetentionJob;
  taxonomy: Taxonomy;
  exportDir: string;
  version: string;
}
