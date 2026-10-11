import { eq } from 'drizzle-orm';
import { normaliseName } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import type { Db } from '../db/client';
import { redactEvents, removeFiles } from '../privacy/purge';
import { blocklistCompanyKey } from './store';

const { contacts, companies, exports, blocklist } = tables;

export interface ErasureResult {
  erased: boolean;
  exportsDeleted: number;
}

/**
 * Erasure (spec §2.2): deletes the contact and its evidence and deep searches,
 * deletes the spreadsheets generated for its search (they may contain it), and
 * blocklists the person at that employer so no later search adds them again.
 */
export function eraseContact(
  db: Db,
  contactId: string,
  reason = 'erased by the user',
  onFileError?: (path: string, err: unknown) => void,
): ErasureResult {
  const paths: string[] = [];
  const erased = db.transaction((tx) => {
    const row = tx
      .select({ contact: contacts, company: companies })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(eq(contacts.id, contactId))
      .get();
    if (!row) return false;
    if (row.contact.fullName) {
      tx.insert(blocklist)
        .values({
          normalisedName: normaliseName(row.contact.fullName),
          companyDomain: row.company ? blocklistCompanyKey(row.company) : '',
          reason,
        })
        .onConflictDoNothing()
        .run();
    }
    for (const e of tx.select().from(exports).where(eq(exports.searchId, row.contact.searchId)).all()) paths.push(e.path);
    tx.delete(exports).where(eq(exports.searchId, row.contact.searchId)).run();
    redactEvents(tx, row.contact.searchId, contactId, row.contact.fullName);
    tx.update(contacts).set({ duplicateOfId: null }).where(eq(contacts.duplicateOfId, contactId)).run();
    tx.delete(contacts).where(eq(contacts.id, contactId)).run();
    return true;
  });
  removeFiles(paths, onFileError);
  return { erased, exportsDeleted: paths.length };
}
