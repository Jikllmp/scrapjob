import Fastify, { type FastifyInstance } from 'fastify';
import { AdapterRegistry, type SourceAdapter } from '@scrapjob/core';
import { createAdapters } from './adapters';
import { DrizzlePipelineStore } from './contacts/store';
import { HttpClient } from './http/client';
import { undiciTransport, type Transport } from './http/transport';
import { BraveSearch } from './search/brave';
import { loadTaxonomy } from './taxonomy';
import { registerContactRoutes } from './routes/contacts';
import type { Config } from './config';
import type { AppContext } from './context';
import { openDatabase } from './db/client';
import { EventBus } from './events/bus';
import { EventStore } from './events/store';
import { registerProblemHandlers } from './problem';
import { registerEventRoutes } from './routes/events';
import { registerMetaRoutes } from './routes/meta';
import { registerSearchRoutes } from './routes/searches';
import { SearchRunner } from './searches/runner';
import { DeepSearchRunner } from './deep-search/runner';

export interface BuildOptions {
  databasePath: string;
  configDir: string;
  exportDir: string;
  /** Replaces the real network (tests replay recorded fixtures through it). */
  transport?: Transport;
  /** Replaces the whole adapter list (orchestration tests). */
  adapters?: readonly SourceAdapter[];
  logger?: boolean;
  /** Time source for rate limiting and backoff (tests use a virtual clock). */
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
}

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

const secretPaths = ['req.headers.authorization', 'req.headers.cookie', '*.BRAVE_API_KEY', '*.apiKey'];

export function buildApp(config: Config, options: BuildOptions): BuiltApp {
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.LOG_LEVEL, redact: secretPaths },
  });
  const db = openDatabase(options.databasePath);
  const bus = new EventBus();
  const events = new EventStore(db, bus);
  const taxonomy = loadTaxonomy(options.configDir);
  const http = new HttpClient({
    transport: options.transport ?? undiciTransport,
    contactUrl: config.USER_AGENT_CONTACT_URL,
    perHostRps: config.PER_HOST_RPS,
    maxConcurrent: config.MAX_CONCURRENT_REQUESTS,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    retryCount: config.RETRY_COUNT,
    ...(options.clock ?? {}),
  });
  const brave = new BraveSearch(http, config.BRAVE_API_KEY);
  const registry = new AdapterRegistry(options.adapters ?? createAdapters({ http, brave, db }), config.ENABLED_SOURCES);
  const store = new DrizzlePipelineStore(db);
  const runner = new SearchRunner(db, events, registry, store, taxonomy, config, app.log);
  const deepSearch = new DeepSearchRunner(db, events, registry, store, taxonomy, config, app.log);
  const ctx: AppContext = {
    config,
    db,
    bus,
    events,
    registry,
    runner,
    deepSearch,
    taxonomy,
    exportDir: options.exportDir,
    version: '0.3.0',
  };

  registerProblemHandlers(app);
  registerMetaRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerContactRoutes(app, ctx);

  app.addHook('onClose', async () => {
    await runner.shutdown();
    await deepSearch.shutdown();
    db.$client.close();
  });
  return { app, ctx };
}
