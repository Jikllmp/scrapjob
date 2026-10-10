import type { Db } from '../db/client';
import { purgeAll, purgeExpiredContacts, purgeSearch } from './purge';

export const PURGE_USAGE = `Usage:
  pnpm data:purge -- --search <id>   delete one search, its contacts, evidence and spreadsheets
  pnpm data:purge -- --all           delete every search, contact, employer and spreadsheet
  pnpm data:purge -- --expired       delete contacts older than DATA_RETENTION_DAYS now`;

export type PurgeCommand = { kind: 'search'; id: string } | { kind: 'all' } | { kind: 'expired' };

/** Parses the arguments, with or without the `--` that pnpm and npm pass through. */
export function parsePurgeArgs(argv: readonly string[]): PurgeCommand | null {
  const args = argv.filter((a) => a !== '--');
  if (args.length === 1 && args[0] === '--all') return { kind: 'all' };
  if (args.length === 1 && args[0] === '--expired') return { kind: 'expired' };
  if (args.length === 2 && args[0] === '--search' && args[1] && !args[1].startsWith('--')) return { kind: 'search', id: args[1] };
  const inline = args.length === 1 ? /^--search=(.+)$/.exec(args[0]!) : null;
  if (inline) return { kind: 'search', id: inline[1]! };
  return null;
}

export interface PurgeDeps {
  db: Db;
  exportDir: string;
  retentionDays: number;
  out: (line: string) => void;
}

/** Runs the purge command and returns the process exit code. */
export function runPurgeCommand(argv: readonly string[], deps: PurgeDeps): number {
  const command = parsePurgeArgs(argv);
  if (!command) {
    deps.out(PURGE_USAGE);
    return 2;
  }
  switch (command.kind) {
    case 'search': {
      const result = purgeSearch(deps.db, command.id);
      if (!result) {
        deps.out(`No search with id ${command.id}.`);
        return 1;
      }
      deps.out(`Deleted search ${command.id}: ${result.contacts} contacts, ${result.files} spreadsheets.`);
      return 0;
    }
    case 'all': {
      const result = purgeAll(deps.db, deps.exportDir);
      deps.out(
        `Deleted ${result.searches} searches, ${result.contacts} contacts and ${result.files} spreadsheets. ` +
          `Kept the erasure blocklist (${result.blocklistKept} entries) and the business register.`,
      );
      return 0;
    }
    case 'expired': {
      const result = purgeExpiredContacts(deps.db, deps.retentionDays);
      deps.out(`Deleted ${result.contacts} contacts older than ${deps.retentionDays} days and ${result.files} spreadsheets.`);
      return 0;
    }
  }
}
