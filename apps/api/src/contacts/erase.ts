import { rmSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { normaliseName } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import type { Db } from '../db/client';
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
export function eraseContact(db: Db, contactId: string, reason = 'erased by the user'): ErasureResult {
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
    tx.update(contacts).set({ duplicateOfId: null }).where(eq(contacts.duplicateOfId, contactId)).run();
    tx.delete(contacts).where(eq(contacts.id, contactId)).run();
    return true;
  });
  for (const path of paths) rmSync(path, { force: true });
  return { erased, exportsDeleted: paths.length };
}
