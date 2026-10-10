/**
 * Runs the API against the synthetic fixtures in test/fixtures instead of the
 * network, so the whole flow can be tried without a Brave key. Only the search
 * "Développeur .NET" in Charleroi has fixtures; anything else finds nothing.
 * Uses a throwaway database and export folder, with the synthetic business
 * register already imported.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { importRegistry } from '../src/registry/import';
import { fixtureTransport } from '../test/fixtures/transport';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = mkdtempSync(join(tmpdir(), 'scrapjob-demo-'));

const config = loadConfig({
  PORT: process.env.PORT ?? '3001',
  BRAVE_API_KEY: 'demo-key-not-sent-anywhere',
  USER_AGENT_CONTACT_URL: 'https://example.org/scrapjob-demo',
  LOG_LEVEL: 'info',
});

const { app, ctx } = buildApp(config, {
  databasePath: join(scratch, 'demo.db'),
  configDir: resolve(repoRoot, 'config'),
  exportDir: join(scratch, 'exports'),
  transport: fixtureTransport().transport,
});

await importRegistry(ctx.db, join(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/kbo'));

app.listen({ port: config.PORT, host: '127.0.0.1' }).then(
  () => app.log.info(`Demo API on fixtures at http://localhost:${config.PORT} (data in ${scratch})`),
  (err: unknown) => {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}
