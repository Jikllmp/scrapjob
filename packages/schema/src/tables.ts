import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { confidences, contactStatuses, deepSearchStatuses, eventLevels, eventTypes, searchStatuses } from './enums';

const id = () => text('id').primaryKey();
const timestamp = (name: string) => text(name);
const now = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const searches = sqliteTable('searches', {
  id: id(),
  location: text('location').notNull(),
  position: text('position').notNull(),
  targetCount: integer('target_count').notNull().default(20),
  status: text('status', { enum: searchStatuses }).notNull().default('queued'),
  /** JSON: { httpRequests, searchApiCalls, deepSearchRequests, elapsedMs } */
  budgetSpent: text('budget_spent', { mode: 'json' }).notNull().default(sql`'{}'`),
  stopReason: text('stop_reason'),
  createdAt: timestamp('created_at').notNull().default(now()),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  error: text('error'),
});

export const companies = sqliteTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    normalisedName: text('normalised_name').notNull(),
    website: text('website'),
    domain: text('domain'),
    city: text('city'),
    country: text('country'),
    industry: text('industry'),
    sizeBucket: text('size_bucket'),
    registryId: text('registry_id'),
    isAgency: integer('is_agency', { mode: 'boolean' }).notNull().default(false),
    genericEmail: text('generic_email'),
  },
  (t) => [index('companies_domain_idx').on(t.domain), index('companies_normalised_name_idx').on(t.normalisedName)],
);

export const jobOpportunities = sqliteTable('job_opportunities', {
  id: id(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  postedAt: timestamp('posted_at'),
  sourceAdapter: text('source_adapter').notNull(),
  location: text('location'),
});

/**
 * Contact rows are inserted as empty shells and filled by UPDATE once their
 * evidence rows exist. Triggers in the migrations enforce that no field is set
 * without evidence (see docs/ADR/0003-evidence-enforcement.md).
 */
export const contacts = sqliteTable(
  'contacts',
  {
    id: id(),
    searchId: text('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }),
    jobOpportunityId: text('job_opportunity_id').references(() => jobOpportunities.id, { onDelete: 'set null' }),
    firstName: text('first_name'),
    lastName: text('last_name'),
    fullName: text('full_name'),
    title: text('title'),
    department: text('department'),
    profileUrl: text('profile_url'),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    country: text('country'),
    roleTier: integer('role_tier'),
    roleArchetype: text('role_archetype'),
    relevanceScore: integer('relevance_score'),
    relevanceReasons: text('relevance_reasons', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    confidence: text('confidence', { enum: confidences }).notNull().default('UNKNOWN'),
    status: text('status', { enum: contactStatuses }).notNull().default('candidate'),
    duplicateOfId: text('duplicate_of_id'),
    /** JSON map of field name to flags, e.g. { "title": ["contradicted"] } */
    fieldFlags: text('field_flags', { mode: 'json' }).$type<Record<string, string[]>>().notNull().default(sql`'{}'`),
    collectedAt: timestamp('collected_at').notNull().default(now()),
    notes: text('notes'),
  },
  (t) => [
    index('contacts_search_idx').on(t.searchId),
    check('contacts_role_tier_range', sql`${t.roleTier} IS NULL OR ${t.roleTier} BETWEEN 1 AND 5`),
    check(
      'contacts_score_range',
      sql`${t.relevanceScore} IS NULL OR ${t.relevanceScore} BETWEEN 0 AND 100`,
    ),
  ],
);

export const evidence = sqliteTable(
  'evidence',
  {
    id: id(),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    companyId: text('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    valueSeen: text('value_seen').notNull(),
    sourceAdapter: text('source_adapter').notNull(),
    sourceUrl: text('source_url').notNull(),
    snippet: text('snippet').notNull(),
    publishedAt: timestamp('published_at'),
    retrievedAt: timestamp('retrieved_at').notNull(),
  },
  (t) => [
    index('evidence_contact_field_idx').on(t.contactId, t.field),
    index('evidence_company_field_idx').on(t.companyId, t.field),
    check('evidence_one_owner', sql`(${t.contactId} IS NULL) <> (${t.companyId} IS NULL)`),
    check('evidence_snippet_length', sql`length(${t.snippet}) <= 500`),
  ],
);

export const searchEvents = sqliteTable(
  'search_events',
  {
    id: id(),
    searchId: text('search_id')
      .notNull()
      .references(() => searches.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type', { enum: eventTypes }).notNull(),
    level: text('level', { enum: eventLevels }).notNull(),
    message: text('message').notNull(),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [uniqueIndex('search_events_search_seq_idx').on(t.searchId, t.seq)],
);

export const deepSearches = sqliteTable('deep_searches', {
  id: id(),
  contactId: text('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  status: text('status', { enum: deepSearchStatuses }).notNull().default('queued'),
  fieldsBefore: text('fields_before', { mode: 'json' }),
  fieldsAfter: text('fields_after', { mode: 'json' }),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
});

export const exports = sqliteTable('exports', {
  id: id(),
  searchId: text('search_id')
    .notNull()
    .references(() => searches.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  path: text('path').notNull(),
  rowCount: integer('row_count').notNull(),
  createdAt: timestamp('created_at').notNull().default(now()),
});

export const blocklist = sqliteTable(
  'blocklist',
  {
    normalisedName: text('normalised_name').notNull(),
    companyDomain: text('company_domain').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at').notNull().default(now()),
  },
  (t) => [primaryKey({ columns: [t.normalisedName, t.companyDomain] })],
);
