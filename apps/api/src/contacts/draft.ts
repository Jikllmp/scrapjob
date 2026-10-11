import { and, eq } from 'drizzle-orm';
import { classifyTitle, contactFields, type AttributedEvidence, type ContactDraft, type Taxonomy } from '@scrapjob/core';
import { tables, type Company } from '@scrapjob/schema';
import type { Db } from '../db/client';

const { contacts, companies, evidence, jobOpportunities, searches } = tables;

type ContactRow = typeof contacts.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;

/** A contact field's stored value; `company` is the employer's name. */
export const valueOf: Record<(typeof contactFields)[number], (c: ContactRow, companyName: string | null) => string | null> = {
  first_name: (c) => c.firstName,
  last_name: (c) => c.lastName,
  full_name: (c) => c.fullName,
  title: (c) => c.title,
  department: (c) => c.department,
  profile_url: (c) => c.profileUrl,
  email: (c) => c.email,
  phone: (c) => c.phone,
  city: (c) => c.city,
  country: (c) => c.country,
  company: (_c, companyName) => companyName,
};

export function toAttributed(e: EvidenceRow): AttributedEvidence {
  return {
    field: e.field as AttributedEvidence['field'],
    value: e.valueSeen,
    sourceUrl: e.sourceUrl,
    snippet: e.snippet,
    sourceKind: e.sourceKind,
    retrievedAt: e.retrievedAt,
    ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
    sourceAdapter: e.sourceAdapter,
  };
}

export interface StoredContact {
  draft: ContactDraft;
  company: Company | null;
  hasPosting: boolean;
  score: { score: number; reasons: string[] } | null;
  search: { id: string; location: string; position: string };
}

/** Rebuilds the pipeline's view of a stored contact, so a deep search can work on it like the search did. */
export function loadStoredContact(db: Db, contactId: string, taxonomy: Taxonomy): StoredContact | null {
  const row = db
    .select({ contact: contacts, company: companies, search: searches })
    .from(contacts)
    .innerJoin(searches, eq(searches.id, contacts.searchId))
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(eq(contacts.id, contactId))
    .get();
  if (!row) return null;
  const { contact, company, search } = row;
  const fields: ContactDraft['fields'] = {};
  for (const field of contactFields) {
    const value = valueOf[field](contact, company?.name ?? null);
    if (value !== null) fields[field] = value;
  }
  const role = contact.roleArchetype !== 'posting-contact' && contact.title ? classifyTitle(contact.title, taxonomy) : null;
  const hasPosting =
    company !== null &&
    db.select({ id: jobOpportunities.id }).from(jobOpportunities).where(and(eq(jobOpportunities.companyId, company.id))).get() !== undefined;
  return {
    draft: {
      id: contact.id,
      fields,
      company: company ? { id: company.id, name: company.name, domain: company.domain, isAgency: company.isAgency } : null,
      evidence: db.select().from(evidence).where(eq(evidence.contactId, contact.id)).all().map(toAttributed),
      roleArchetype: contact.roleArchetype ?? role?.archetype ?? 'unknown',
      roleTier: contact.roleTier ?? role?.tier ?? 5,
      roleGenericOnly: role?.genericOnly ?? false,
      fieldFlags: contact.fieldFlags,
    },
    company,
    hasPosting,
    score: contact.relevanceScore === null ? null : { score: contact.relevanceScore, reasons: contact.relevanceReasons },
    search: { id: search.id, location: search.location, position: search.position },
  };
}
