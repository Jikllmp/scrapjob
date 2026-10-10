/**
 * Imports the Belgian business register (KBO/BCE open data) into the local
 * database. Download the "Full" extract from the KBO open-data portal (free
 * registration), unzip it, then run:
 *
 *   pnpm registry:import -- path/to/KboOpenData_xxxx_Full
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { databasePath, loadConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { importRegistry, RegistryImportError } from '../src/registry/import';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(repoRoot, '.env'), quiet: true });

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length !== 1) {
  console.error('Usage: pnpm registry:import -- <folder with enterprise.csv, denomination.csv, activity.csv, address.csv, code.csv>');
  process.exit(2);
}
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), args[0]!);
const config = loadConfig(process.env);
const db = openDatabase(resolve(repoRoot, databasePath(config.DATABASE_URL)));
const started = Date.now();
importRegistry(db, dir, (line) => console.log(line)).then(
  (summary) => {
    console.log(`Imported ${summary.enterprises} enterprises in ${Math.round((Date.now() - started) / 1000)} s.`);
    db.$client.close();
  },
  (err: unknown) => {
    console.error(err instanceof RegistryImportError ? err.message : err);
    db.$client.close();
    process.exit(1);
  },
);
