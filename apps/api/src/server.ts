import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app';
import { ConfigError, databasePath, loadConfig } from './config';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function main(): void {
  loadDotenv({ path: resolve(repoRoot, '.env'), quiet: true });
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const dbPath = resolve(repoRoot, databasePath(config.DATABASE_URL));
  const { app, ctx } = buildApp(config, { databasePath: dbPath });
  const resumed = ctx.runner.resumeInterrupted();
  if (resumed > 0) app.log.info({ resumed }, 'resumed interrupted searches');

  app.listen({ port: config.PORT, host: '127.0.0.1' }).then(
    () => app.log.info(`API ready on http://localhost:${config.PORT} (database: ${dbPath})`),
    (err: unknown) => {
      app.log.error({ err }, 'failed to start');
      process.exit(1);
    },
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void app.close().then(() => process.exit(0)));
  }
}

main();
