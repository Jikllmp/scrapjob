import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  normaliseCompanyName,
  type AttributedEvidence,
  type ContactDraft,
  type ContactField,
  type PipelineStore,
  type ScoredDraft,
} from '@scrapjob/core';
import { tables, type Company, type CompanyCandidate } from '@scrapjob/schema';
import type { Db } from '../db/client';

const { companies, contacts, evidence, jobOpportunities, blocklist } = tables;

type ContactColumns = Partial<Record<'firstName' | 'lastName' | 'fullName' | 'title' | 'department' | 'profileUrl' | 'email' | 'phone' | 'city' | 'country' | 'companyId', string>>;

const columnOf: Record<Exclude<ContactField, 'company'>, keyof ContactColumns> = {
  first_name: 'firstName',
  last_name: 'lastName',
  full_name: 'fullName',
  title: 'title',
  department: 'department',
  profile_url: 'profileUrl',
  email: 'email',
  phone: 'phone',
  city: 'city',
  country: 'country',
};

export class EvidenceMissingError extends Error {
  override name = 'EvidenceMissingError';
}

/** Repository-level twin of the database triggers (ADR 0003): fail before SQLite has to. */
export function assertEvidence(draft: ContactDraft): void {
  for (const [field, value] of Object.entries(draft.fields)) {
    if (value === undefined) continue;
    if (!draft.evidence.some((e) => e.field === field)) {
      throw new EvidenceMissingError(`contact field "${field}" has no evidence`);
    }
  }
}

function columns(draft: ContactDraft): ContactColumns {
  const out: ContactColumns = {};
  for (const [field, value] of Object.entries(draft.fields) as [ContactField, string][]) {
    if (field === 'company') continue;
    out[columnOf[field]] = value;
  }
  if (draft.fields.company && draft.company) out.companyId = draft.company.id;
  return out;
}

/** PipelineStore over SQLite. Every write that touches contact fields runs in one transaction with its evidence. */
export class DrizzlePipelineStore implements PipelineStore {
  constructor(private readonly db: Db) {}

  upsertCompany(candidate: CompanyCandidate, adapter: string): Company {
    const normalisedName = normaliseCompanyName(candidate.name);
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(companies)
        .where(
          candidate.domain
            ? eq(companies.domain, candidate.domain)
            : and(isNull(companies.domain), eq(companies.normalisedName, normalisedName)),
        )
        .get();
      let company: Company;
      if (existing) {
        const patch: Partial<Company> = {};
        if (!existing.website && candidate.website) patch.website = candidate.website;
        if (!existing.city && candidate.city) patch.city = candidate.city;
        if (candidate.isAgency && !existing.isAgency) patch.isAgency = true;
        company = Object.keys(patch).length
          ? tx.update(companies).set(patch).where(eq(companies.id, existing.id)).returning().get()
          : existing;
      } else {
        company = tx
          .insert(companies)
          .values({
            id: randomUUID(),
            name: candidate.name,
            normalisedName,
            website: candidate.website ?? null,
            domain: candidate.domain ?? null,
            city: candidate.city ?? null,
            country: candidate.country ?? null,
            isAgency: candidate.isAgency ?? false,
          })
          .returning()
          .get();
      }
      for (const e of candidate.evidence) {
        tx.insert(evidence).values(this.evidenceRow(e, adapter, { companyId: company.id })).run();
      }
      return company;
    });
  }

  savePostings(company: Company, candidate: CompanyCandidate, adapter: string): number {
    for (const p of candidate.postings) {
      const exists = postingExists(this.db, company.id, p.url);
      if (exists) continue;
      this.db
        .insert(jobOpportunities)
        .values({
          id: randomUUID(),
          companyId: company.id,
          title: p.title,
          url: p.url,
          postedAt: p.postedAt ?? null,
          sourceAdapter: adapter,
          location: candidate.city ?? null,
        })
        .run();
    }
    return candidate.postings.length;
  }

  isBlocked(normalisedName: string, companyDomain: string | null): boolean {
    const row = this.db
      .select({ name: blocklist.normalisedName })
      .from(blocklist)
      .where(
        and(
          eq(blocklist.normalisedName, normalisedName),
          or(eq(blocklist.companyDomain, companyDomain ?? ''), eq(blocklist.companyDomain, '')),
        ),
      )
      .get();
    return row !== undefined;
  }

  insertContact(searchId: string, scored: ScoredDraft): string {
    const { draft } = scored;
    assertEvidence(draft);
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(contacts)
        .values({ id, searchId, status: 'validated', ...this.meta(scored) })
        .run();
      for (const e of draft.evidence) tx.insert(evidence).values(this.evidenceRow(e, e.sourceAdapter, { contactId: id })).run();
      tx.update(contacts).set(columns(draft)).where(eq(contacts.id, id)).run();
    });
    return id;
  }

  updateContact(contactId: string, scored: ScoredDraft): void {
    const { draft } = scored;
    assertEvidence(draft);
    this.db.transaction((tx) => {
      const stored = tx
        .select({ field: evidence.field, url: evidence.sourceUrl, value: evidence.valueSeen })
        .from(evidence)
        .where(eq(evidence.contactId, contactId))
        .all();
      const known = new Set(stored.map((r) => `${r.field}\u0000${r.url}\u0000${r.value}`));
      for (const e of draft.evidence) {
        if (known.has(`${e.field}\u0000${e.sourceUrl}\u0000${e.value}`)) continue;
        tx.insert(evidence).values(this.evidenceRow(e, e.sourceAdapter, { contactId })).run();
      }
      tx.update(contacts)
        .set({ ...columns(draft), ...this.meta(scored) })
        .where(eq(contacts.id, contactId))
        .run();
    });
  }

  flagPossibleDuplicate(contactId: string, otherId: string): void {
    this.db.update(contacts).set({ duplicateOfId: otherId }).where(eq(contacts.id, contactId)).run();
  }

  private meta(scored: ScoredDraft) {
    return {
      roleTier: scored.draft.roleTier,
      roleArchetype: scored.draft.roleArchetype,
      relevanceScore: scored.score.score,
      relevanceReasons: scored.score.reasons,
      confidence: scored.confidence,
      fieldFlags: scored.draft.fieldFlags,
    };
  }

  private evidenceRow(
    e: Omit<AttributedEvidence, 'sourceAdapter'>,
    adapter: string,
    owner: { contactId: string } | { companyId: string },
  ) {
    return {
      id: randomUUID(),
      ...owner,
      field: e.field,
      valueSeen: e.value,
      sourceAdapter: adapter,
      sourceUrl: e.sourceUrl,
      snippet: e.snippet,
      sourceKind: e.sourceKind,
      publishedAt: e.publishedAt ?? null,
      retrievedAt: e.retrievedAt,
    };
  }
}

function postingExists(db: Db, companyId: string, url: string): boolean {
  return (
    db
      .select({ id: jobOpportunities.id })
      .from(jobOpportunities)
      .where(and(eq(jobOpportunities.companyId, companyId), eq(jobOpportunities.url, url)))
      .get() !== undefined
  );
}
