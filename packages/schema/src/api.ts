import { z } from 'zod';
import { Confidence, DeepSearchStatus, EventLevel, EventType, EvidenceSourceKind, SearchStatus } from './enums';

export const BudgetSpent = z.object({
  httpRequests: z.number().int().nonnegative().default(0),
  searchApiCalls: z.number().int().nonnegative().default(0),
  deepSearchRequests: z.number().int().nonnegative().default(0),
  elapsedMs: z.number().int().nonnegative().default(0),
});
export type BudgetSpent = z.infer<typeof BudgetSpent>;

const trimmedText = (max: number) => z.string().trim().min(2).max(max);

export const CreateSearchBody = z.object({
  location: trimmedText(100),
  position: trimmedText(120),
  targetCount: z.number().int().min(1).max(100).optional(),
});
export type CreateSearchBody = z.infer<typeof CreateSearchBody>;

export const CreateSearchResponse = z.object({ searchId: z.string() });
export type CreateSearchResponse = z.infer<typeof CreateSearchResponse>;

export const SearchIdParams = z.object({ id: z.string().min(1).max(64) });

export const SearchDto = z.object({
  id: z.string(),
  location: z.string(),
  position: z.string(),
  targetCount: z.number().int(),
  status: SearchStatus,
  budgetSpent: BudgetSpent,
  stopReason: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  counters: z.object({
    events: z.number().int(),
    contactsValidated: z.number().int(),
    companies: z.number().int(),
  }),
});
export type SearchDto = z.infer<typeof SearchDto>;

export const ListSearchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const SearchListDto = z.object({
  items: z.array(SearchDto),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type SearchListDto = z.infer<typeof SearchListDto>;

export const SearchEventDto = z.object({
  seq: z.number().int().positive(),
  type: EventType,
  level: EventLevel,
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SearchEventDto = z.infer<typeof SearchEventDto>;

export const SourceCapability = z.enum(['companies', 'jobs', 'people', 'enrich']);
export type SourceCapability = z.infer<typeof SourceCapability>;

export const SourceDto = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: z.array(SourceCapability),
  enabled: z.boolean(),
  available: z.boolean(),
  /** Why it is not available, when it is not. */
  unavailableReason: z.string().nullable(),
  /** Contacts that carry at least one piece of evidence from this source, across all searches. */
  contacts: z.number().int(),
  /** How the source behaved in the most recent search that ran. */
  lastSearch: z
    .object({
      searchId: z.string(),
      createdAt: z.string(),
      failures: z.number().int(),
      disabled: z.boolean(),
      lastError: z.string().nullable(),
    })
    .nullable(),
});
export type SourceDto = z.infer<typeof SourceDto>;
export const SourceListDto = z.object({ items: z.array(SourceDto) });

export const HealthDto = z.object({ status: z.literal('ok'), version: z.string() });

/** What the privacy page shows about the data this copy of the tool holds. */
export const PrivacyDto = z.object({
  retentionDays: z.number().int(),
  contacts: z.number().int(),
  oldestCollectedAt: z.string().nullable(),
  blocklistEntries: z.number().int(),
});
export type PrivacyDto = z.infer<typeof PrivacyDto>;

/** RFC 9457 problem details. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;

export const ContactRowDto = z.object({
  id: z.string(),
  fullName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  roleTier: z.number().int().nullable(),
  roleArchetype: z.string().nullable(),
  company: z
    .object({
      id: z.string(),
      name: z.string(),
      website: z.string().nullable(),
      domain: z.string().nullable(),
      city: z.string().nullable(),
      country: z.string().nullable(),
      industry: z.string().nullable(),
      isAgency: z.boolean(),
    })
    .nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  profileUrl: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  relevanceScore: z.number().int().nullable(),
  relevanceReasons: z.array(z.string()),
  confidence: Confidence,
  /** Name or employer rests only on a search snippet: an unconfirmed lead (ADR 0002). */
  lead: z.boolean(),
  fieldConfidence: z.record(z.string(), Confidence),
  possibleDuplicateOf: z.string().nullable(),
  /** Fields a deep search found evidence against (spec §8.2): shown as UNKNOWN until the user decides. */
  contradicted: z.array(z.string()),
  sources: z.array(z.string()),
  primarySourceUrl: z.string().nullable(),
  jobPostingUrl: z.string().nullable(),
  collectedAt: z.string(),
  notes: z.string().nullable(),
});
export type ContactRowDto = z.infer<typeof ContactRowDto>;

export const ListContactsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const ContactListDto = z.object({
  items: z.array(ContactRowDto),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ContactListDto = z.infer<typeof ContactListDto>;

export const CreateExportBody = z
  .object({ contactIds: z.array(z.string().min(1).max(64)).min(1).max(500).optional() })
  .default({});
export const CreateExportResponse = z.object({ exportId: z.string(), filename: z.string(), rowCount: z.number().int() });
export type CreateExportResponse = z.infer<typeof CreateExportResponse>;

export const ContactIdParams = z.object({ id: z.string().min(1).max(64) });

export const EvidenceDto = z.object({
  id: z.string(),
  field: z.string(),
  value: z.string(),
  sourceAdapter: z.string(),
  sourceUrl: z.string(),
  snippet: z.string(),
  sourceKind: EvidenceSourceKind,
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
});
export type EvidenceDto = z.infer<typeof EvidenceDto>;

export const ContactSnapshotDto = z.object({
  fields: z.record(z.string(), z.object({ value: z.string(), confidence: Confidence })),
  score: z.number().int(),
  confidence: Confidence,
  lead: z.boolean(),
});
export type ContactSnapshotDto = z.infer<typeof ContactSnapshotDto>;

export const FieldChangeDto = z.object({
  field: z.string(),
  kind: z.enum(['added', 'updated', 'corroborated', 'contradicted']),
  before: z.string().nullable(),
  after: z.string().nullable(),
  confidenceBefore: Confidence,
  confidenceAfter: Confidence,
});
export type FieldChangeDto = z.infer<typeof FieldChangeDto>;

export const DeepSearchDto = z.object({
  id: z.string(),
  status: DeepSearchStatus,
  message: z.string().nullable(),
  requestsSpent: z.number().int(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  before: ContactSnapshotDto.nullable(),
  after: ContactSnapshotDto.nullable(),
  changes: z.array(FieldChangeDto),
});
export type DeepSearchDto = z.infer<typeof DeepSearchDto>;

export const ContactDetailDto = ContactRowDto.extend({
  search: z.object({ id: z.string(), location: z.string(), position: z.string() }),
  /** Field name → flags such as `contradicted`. */
  fieldFlags: z.record(z.string(), z.array(z.string())),
  evidence: z.array(EvidenceDto),
  companyEvidence: z.array(EvidenceDto),
  deepSearches: z.array(DeepSearchDto),
});
export type ContactDetailDto = z.infer<typeof ContactDetailDto>;

export const CreateDeepSearchResponse = z.object({ deepSearchId: z.string() });
export type CreateDeepSearchResponse = z.infer<typeof CreateDeepSearchResponse>;
