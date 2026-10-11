import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { tables } from '@scrapjob/schema';
import type { Db } from '../db/client';

const { companies, contacts, exports, jobOpportunities, searches, searchEvents, blocklist } = tables;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  searches: number;
  contacts: number;
  files: number;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Deletes the export rows of these searches and returns their files, to remove once the transaction commits. */
function deleteExportRows(tx: Tx, searchIds: string[]): string[] {
  if (searchIds.length === 0) return [];
  const files = tx.select({ path: exports.path }).from(exports).where(inArray(exports.searchId, searchIds)).all();
  tx.delete(exports).where(inArray(exports.searchId, searchIds)).run();
  return files.map((f) => f.path);
}

export type FileErrorHandler = (path: string, err: unknown) => void;

/**
 * The spreadsheets hold the same personal data as the rows, so they go too.
 * A file that cannot be deleted (on Windows, open in Excel) is reported, not
 * thrown: the database part of the deletion has already happened.
 */
export function removeFiles(paths: readonly string[], onError: FileErrorHandler = () => {}): number {
  let removed = 0;
  for (const path of paths) {
    try {
      rmSync(path, { force: true });
      removed += 1;
    } catch (err) {
      onError(path, err);
    }
  }
  return removed;
}

/**
 * Retention (spec §2.2): deletes every contact collected more than
 * `retentionDays` ago, with its evidence and deep searches, and the
 * spreadsheets of the searches it belonged to. Nobody is blocklisted: this is
 * housekeeping, not an objection.
 */
/**
 * Blanks the log lines that name a person or point at their contact row. The
 * lines stay (their sequence numbers keep live streams consistent), but the
 * personal data in them goes with the contact.
 */
export function redactEvents(tx: Tx, searchId: string, contactId: string, fullName: string | null): void {
  const mentions = fullName
    ? sql`(instr(${searchEvents.message}, ${fullName}) > 0 OR instr(${searchEvents.metadata}, ${fullName}) > 0 OR json_extract(${searchEvents.metadata}, '$.contactId') = ${contactId})`
    : sql`json_extract(${searchEvents.metadata}, '$.contactId') = ${contactId}`;
  tx.update(searchEvents).set({ message: '[erased]', metadata: {} }).where(and(eq(searchEvents.searchId, searchId), mentions)).run();
}

export function purgeExpiredContacts(db: Db, retentionDays: number, now = new Date(), onFileError?: FileErrorHandler): PurgeResult {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  // Log lines name people too, including candidates that were rejected: they expire on the same clock.
  db.update(searchEvents)
    .set({ message: '[expired]', metadata: {} })
    .where(and(lt(searchEvents.createdAt, cutoff), ne(searchEvents.message, '[expired]')))
    .run();
  const expired = db.select({ id: contacts.id, searchId: contacts.searchId }).from(contacts).where(lt(contacts.collectedAt, cutoff)).all();
  if (expired.length === 0) return { searches: 0, contacts: 0, files: 0 };
  const ids = expired.map((c) => c.id);
  const searchIds = [...new Set(expired.map((c) => c.searchId))];
  const paths = db.transaction((tx) => {
    const files = deleteExportRows(tx, searchIds);
    tx.update(contacts).set({ duplicateOfId: null }).where(inArray(contacts.duplicateOfId, ids)).run();
    tx.delete(contacts).where(inArray(contacts.id, ids)).run();
    return files;
  });
  return { searches: 0, contacts: expired.length, files: removeFiles(paths, onFileError) };
}

/** Deletes one search with its contacts, evidence, events, deep searches and spreadsheets. */
export function purgeSearch(db: Db, searchId: string, onFileError?: FileErrorHandler): PurgeResult | null {
  const search = db.select({ id: searches.id }).from(searches).where(eq(searches.id, searchId)).get();
  if (!search) return null;
  const count = db.select({ n: sql<number>`count(*)` }).from(contacts).where(eq(contacts.searchId, searchId)).get()?.n ?? 0;
  const paths = db.transaction((tx) => {
    const files = deleteExportRows(tx, [searchId]);
    tx.delete(searches).where(eq(searches.id, searchId)).run();
    return files;
  });
  return { searches: 1, contacts: count, files: removeFiles(paths, onFileError) };
}

/**
 * Empties everything collected: searches, contacts, evidence, events,
 * employers, postings and every file in the export folder. Two things stay:
 * the erasure blocklist (it is what keeps an objection honoured) and the
 * imported business register (open company data, no people in it).
 */
export function purgeAll(db: Db, exportDir: string): PurgeResult & { blocklistKept: number } {
  const counts = {
    searches: db.select({ n: sql<number>`count(*)` }).from(searches).get()?.n ?? 0,
    contacts: db.select({ n: sql<number>`count(*)` }).from(contacts).get()?.n ?? 0,
  };
  db.transaction((tx) => {
    tx.delete(exports).run();
    tx.delete(searches).run();
    tx.delete(jobOpportunities).run();
    tx.delete(companies).run();
  });
  let files = 0;
  try {
    files = removeFiles(readdirSync(exportDir).filter((name) => name.endsWith('.xlsx')).map((name) => join(exportDir, name)));
  } catch {
    // No export folder yet: nothing to delete.
  }
  const blocklistKept = db.select({ n: sql<number>`count(*)` }).from(blocklist).get()?.n ?? 0;
  return { ...counts, files, blocklistKept };
}
