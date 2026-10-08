import Fastify, { type FastifyInstance } from 'fastify';
import { AdapterRegistry, type SourceAdapter } from '@scrapjob/core';
import { allAdapters } from './adapters';
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

export interface BuildOptions {
  databasePath: string;
  adapters?: readonly SourceAdapter[];
  logger?: boolean;
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
  const registry = new AdapterRegistry(options.adapters ?? allAdapters, config.ENABLED_SOURCES);
  const runner = new SearchRunner(db, events, registry, config, app.log);
  const ctx: AppContext = { config, db, bus, events, registry, runner, version: '0.1.0' };

  registerProblemHandlers(app);
  registerMetaRoutes(app, ctx);
  registerSearchRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  app.addHook('onClose', async () => {
    await runner.shutdown();
    db.$client.close();
  });
  return { app, ctx };
}
