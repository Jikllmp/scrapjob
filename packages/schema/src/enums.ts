import { z } from 'zod';

export const searchStatuses = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export const SearchStatus = z.enum(searchStatuses);
export type SearchStatus = z.infer<typeof SearchStatus>;

export const terminalSearchStatuses: readonly SearchStatus[] = ['completed', 'failed', 'cancelled'];

export const confidences = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export const Confidence = z.enum(confidences);
export type Confidence = z.infer<typeof Confidence>;

export const contactStatuses = ['candidate', 'validated', 'rejected', 'merged'] as const;
export const ContactStatus = z.enum(contactStatuses);
export type ContactStatus = z.infer<typeof ContactStatus>;

export const deepSearchStatuses = ['queued', 'running', 'completed', 'failed'] as const;
export const DeepSearchStatus = z.enum(deepSearchStatuses);

export const eventLevels = ['debug', 'info', 'warn', 'error'] as const;
export const EventLevel = z.enum(eventLevels);
export type EventLevel = z.infer<typeof EventLevel>;

export const eventTypes = [
  'SEARCH_STARTED',
  'SEARCH_COMPLETED',
  'SEARCH_FAILED',
  'SEARCH_CANCELLED',
  'SOURCE_INITIALIZED',
  'SOURCE_DISABLED',
  'ROBOTS_DISALLOWED',
  'RATE_LIMITED',
  'QUERY_PLANNED',
  'QUERY_STARTED',
  'QUERY_COMPLETED',
  'COMPANY_DISCOVERED',
  'JOB_DISCOVERED',
  'CONTACT_CANDIDATE_FOUND',
  'EXTRACTION_REJECTED',
  'CONTACT_VALIDATED',
  'CONTACT_REJECTED',
  'DUPLICATE_MERGED',
  'POSSIBLE_DUPLICATE',
  'ENRICHMENT_STARTED',
  'ENRICHMENT_COMPLETED',
  'PROGRESS',
  'BUDGET_WARNING',
  'EXPORT_STARTED',
  'EXPORT_COMPLETED',
  'WARNING',
  'ERROR',
] as const;
export const EventType = z.enum(eventTypes);
export type EventType = z.infer<typeof EventType>;

/** Fields on a contact that must be backed by evidence. `company` stands for `company_id`. */
export const contactEvidenceFields = [
  'first_name',
  'last_name',
  'full_name',
  'title',
  'department',
  'profile_url',
  'email',
  'phone',
  'city',
  'country',
  'company',
] as const;
export const ContactEvidenceField = z.enum(contactEvidenceFields);

export const companyEvidenceFields = ['name', 'website', 'domain', 'city', 'industry', 'generic_email', 'registry_id'] as const;
export const CompanyEvidenceField = z.enum(companyEvidenceFields);

export const EvidenceField = z.enum([...contactEvidenceFields, ...companyEvidenceFields]);
export type EvidenceField = z.infer<typeof EvidenceField>;

export const evidenceSourceKinds = ['page', 'search_snippet', 'dataset'] as const;
export const EvidenceSourceKind = z.enum(evidenceSourceKinds);
export type EvidenceSourceKind = z.infer<typeof EvidenceSourceKind>;
