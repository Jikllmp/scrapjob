import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import {
  contactFields,
  lowestConfidence,
  fieldConfidence,
  isLead,
  type AttributedEvidence,
  type CompanyRef,
  type Taxonomy,
} from '@scrapjob/core';
import { tables, type Confidence } from '@scrapjob/schema';
import type { ContactRowDto } from '@scrapjob/schema/api';
import type { Db } from '../db/client';

const { contacts, companies, evidence, jobOpportunities } = tables;

const valueOf: Record<(typeof contactFields)[number], (c: typeof contacts.$inferSelect, companyName: string | null) => string | null> = {
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

/**
 * Validated contacts of a search, with everything the table and the export
 * show. Field confidence is derived from the evidence on every read, never stored by hand.
 */
export function loadContactRows(db: Db, searchId: string, taxonomy: Taxonomy, ids?: readonly string[]): ContactRowDto[] {
  const rows = db
    .select({ contact: contacts, company: companies })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(
      and(
        eq(contacts.searchId, searchId),
        eq(contacts.status, 'validated'),
        ids ? inArray(contacts.id, [...ids]) : isNotNull(contacts.id),
      ),
    )
    .all();
  if (rows.length === 0) return [];

  const contactIds = rows.map((r) => r.contact.id);
  const allEvidence = db.select().from(evidence).where(inArray(evidence.contactId, contactIds)).orderBy(asc(evidence.retrievedAt)).all();
  const companyIds = [...new Set(rows.map((r) => r.company?.id).filter((x): x is string => Boolean(x)))];
  const postings = companyIds.length
    ? db.select().from(jobOpportunities).where(inArray(jobOpportunities.companyId, companyIds)).all()
    : [];
  const now = new Date();

  return rows
    .map(({ contact, company }) => {
      const ev: AttributedEvidence[] = allEvidence
        .filter((e) => e.contactId === contact.id)
        .map((e) => ({
          field: e.field as AttributedEvidence['field'],
          value: e.valueSeen,
          sourceUrl: e.sourceUrl,
          snippet: e.snippet,
          sourceKind: e.sourceKind,
          retrievedAt: e.retrievedAt,
          ...(e.publishedAt ? { publishedAt: e.publishedAt } : {}),
          sourceAdapter: e.sourceAdapter,
        }));
      const ref: CompanyRef | null = company
        ? { id: company.id, name: company.name, domain: company.domain, isAgency: company.isAgency }
        : null;
      const perField: Record<string, Confidence> = {};
      for (const field of contactFields) {
        const value = valueOf[field](contact, company?.name ?? null);
        if (value === null) continue;
        perField[field] = fieldConfidence(
          value,
          ev.filter((e) => e.field === field),
          ref,
          contact.fieldFlags[field] ?? [],
          { taxonomy, now },
        );
      }
      const primary = ev.find((e) => e.field === 'full_name') ?? ev[0];
      return {
        id: contact.id,
        fullName: contact.fullName,
        firstName: contact.firstName,
        lastName: contact.lastName,
        title: contact.title,
        department: contact.department,
        roleTier: contact.roleTier,
        roleArchetype: contact.roleArchetype,
        company: company
          ? {
              id: company.id,
              name: company.name,
              website: company.website,
              domain: company.domain,
              city: company.city,
              country: company.country,
              industry: company.industry,
              isAgency: company.isAgency,
            }
          : null,
        email: contact.email,
        phone: contact.phone,
        profileUrl: contact.profileUrl,
        city: contact.city,
        country: contact.country,
        relevanceScore: contact.relevanceScore,
        relevanceReasons: contact.relevanceReasons,
        confidence: contact.confidence,
        lead: isLead(lowestConfidence([perField.full_name ?? 'UNKNOWN', perField.company ?? 'UNKNOWN'])),
        fieldConfidence: perField,
        possibleDuplicateOf: contact.duplicateOfId,
        sources: [...new Set(ev.map((e) => e.sourceAdapter))],
        primarySourceUrl: primary?.sourceUrl ?? null,
        jobPostingUrl: postings.find((p) => p.companyId === company?.id)?.url ?? null,
        collectedAt: contact.collectedAt,
        notes: contact.notes,
      } satisfies ContactRowDto;
    })
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) || (a.fullName ?? '').localeCompare(b.fullName ?? ''));
}
