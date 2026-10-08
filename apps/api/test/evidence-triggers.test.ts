import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tables } from '@scrapjob/schema';
import { openDatabase, type Db } from '../src/db/client';

const { contacts, evidence, searches, companies } = tables;

let db: Db;
let contactId: string;

const evidenceFor = (field: string, value: string) => ({
  id: randomUUID(),
  contactId,
  field,
  valueSeen: value,
  sourceAdapter: 'test',
  sourceUrl: 'https://acme.test/team',
  snippet: `${value} — Talent Acquisition`,
  retrievedAt: '2026-10-08T00:00:00.000Z',
});

beforeEach(() => {
  db = openDatabase(':memory:');
  db.insert(searches).values({ id: 's1', location: 'Charleroi', position: '.NET' }).run();
  contactId = randomUUID();
  db.insert(contacts).values({ id: contactId, searchId: 's1' }).run();
});

afterEach(() => db.$client.close());

describe('evidence enforcement in SQLite', () => {
  it('rejects a contact inserted with a populated field', () => {
    expect(() =>
      db.insert(contacts).values({ id: randomUUID(), searchId: 's1', fullName: 'Marie Dupont' }).run(),
    ).toThrow(/EVIDENCE_REQUIRED/);
  });

  it('rejects setting a field that has no evidence row', () => {
    expect(() => db.update(contacts).set({ fullName: 'Marie Dupont' }).where(eq(contacts.id, contactId)).run()).toThrow(
      /EVIDENCE_REQUIRED/,
    );
  });

  it('accepts a field once its evidence exists', () => {
    db.insert(evidence).values(evidenceFor('full_name', 'Marie Dupont')).run();
    db.update(contacts).set({ fullName: 'Marie Dupont' }).where(eq(contacts.id, contactId)).run();
    expect(db.select().from(contacts).where(eq(contacts.id, contactId)).get()?.fullName).toBe('Marie Dupont');
  });

  it('rejects evidence for one field being used to set another', () => {
    db.insert(evidence).values(evidenceFor('full_name', 'Marie Dupont')).run();
    expect(() =>
      db.update(contacts).set({ fullName: 'Marie Dupont', email: 'marie@acme.test' }).where(eq(contacts.id, contactId)).run(),
    ).toThrow(/EVIDENCE_REQUIRED/);
  });

  it('requires evidence for the company link', () => {
    db.insert(companies).values({ id: 'c1', name: 'Acme', normalisedName: 'acme' }).run();
    expect(() => db.update(contacts).set({ companyId: 'c1' }).where(eq(contacts.id, contactId)).run()).toThrow(
      /EVIDENCE_REQUIRED/,
    );
    db.insert(evidence).values(evidenceFor('company', 'Acme')).run();
    db.update(contacts).set({ companyId: 'c1' }).where(eq(contacts.id, contactId)).run();
  });

  it('refuses to delete the last evidence row of a populated field', () => {
    const row = evidenceFor('full_name', 'Marie Dupont');
    db.insert(evidence).values(row).run();
    db.update(contacts).set({ fullName: 'Marie Dupont' }).where(eq(contacts.id, contactId)).run();
    expect(() => db.delete(evidence).where(eq(evidence.id, row.id)).run()).toThrow(/EVIDENCE_REQUIRED/);
  });

  it('still lets a contact be erased together with its evidence', () => {
    db.insert(evidence).values(evidenceFor('full_name', 'Marie Dupont')).run();
    db.update(contacts).set({ fullName: 'Marie Dupont' }).where(eq(contacts.id, contactId)).run();
    db.delete(contacts).where(eq(contacts.id, contactId)).run();
    expect(db.select().from(evidence).all()).toHaveLength(0);
  });

  it('rejects evidence owned by both a contact and a company', () => {
    db.insert(companies).values({ id: 'c1', name: 'Acme', normalisedName: 'acme' }).run();
    expect(() => db.insert(evidence).values({ ...evidenceFor('name', 'Acme'), companyId: 'c1' }).run()).toThrow(
      /CHECK constraint/,
    );
  });
});
