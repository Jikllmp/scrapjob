/**
 * Deletes collected personal data from the local database and export folder.
 *
 *   pnpm data:purge -- --search <id>
 *   pnpm data:purge -- --all
 *   pnpm data:purge -- --expired
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { databasePath, loadConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { runPurgeCommand } from '../src/privacy/purge-cli';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(repoRoot, '.env'), quiet: true });

const config = loadConfig(process.env);
const db = openDatabase(resolve(repoRoot, databasePath(config.DATABASE_URL)));
const code = runPurgeCommand(process.argv.slice(2), {
  db,
  exportDir: resolve(repoRoot, config.EXPORT_DIR),
  retentionDays: config.DATA_RETENTION_DAYS,
  out: (line) => console.log(line),
});
db.$client.close();
process.exit(code);
