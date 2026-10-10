import { z } from 'zod';
import { EvidenceField, EvidenceSourceKind } from './enums';

const url = z.url({ protocol: /^https?$/ });
const isoDate = z.iso.datetime({ offset: true });

/** What an adapter saw, where, and when. Every candidate value must be backed by one. */
export const EvidenceRef = z.object({
  field: EvidenceField,
  value: z.string().min(1),
  sourceUrl: url,
  snippet: z.string().min(1).max(500),
  /**
   * `page`: the adapter fetched the page itself. `search_snippet`: seen only in
   * a search result. `dataset`: a record of an open-data file such as the business register.
   */
  sourceKind: EvidenceSourceKind,
  retrievedAt: isoDate,
  publishedAt: isoDate.optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/** An open position seen while discovering a company. */
export const PostingCandidate = z.object({
  title: z.string().min(1),
  url,
  postedAt: isoDate.optional(),
});
export type PostingCandidate = z.infer<typeof PostingCandidate>;

export const CompanyCandidate = z.object({
  name: z.string().min(1),
  website: url.optional(),
  domain: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  isAgency: z.boolean().optional(),
  postings: z.array(PostingCandidate).default([]),
  evidence: z.array(EvidenceRef).min(1),
});
export type CompanyCandidate = z.infer<typeof CompanyCandidate>;
export type CompanyCandidateInput = z.input<typeof CompanyCandidate>;

export const JobCandidate = z.object({
  companyName: z.string().min(1),
  title: z.string().min(1),
  url,
  postedAt: isoDate.optional(),
  location: z.string().optional(),
  evidence: z.array(EvidenceRef).min(1),
});
export type JobCandidate = z.infer<typeof JobCandidate>;

export const ContactCandidate = z.object({
  fullName: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  department: z.string().optional(),
  profileUrl: url.optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  companyName: z.string().optional(),
  /** Named as the contact person on a job posting (role tier 5 whatever the title). */
  postingContact: z.boolean().optional(),
  evidence: z.array(EvidenceRef).min(1),
});
export type ContactCandidate = z.infer<typeof ContactCandidate>;

export const EvidencePatch = z.object({
  field: EvidenceField,
  evidence: EvidenceRef,
});
export type EvidencePatch = z.infer<typeof EvidencePatch>;

/** What a deep-search source found about one contact: evidence per field, and any relevant posting. */
export const EnrichResult = z.object({
  patches: z.array(EvidencePatch).default([]),
  postings: z.array(PostingCandidate).default([]),
});
export type EnrichResult = z.infer<typeof EnrichResult>;
export type EnrichResultInput = z.input<typeof EnrichResult>;

/** Register facts about an employer. Every value is backed by evidence. */
export const CompanyPatch = z.object({
  registryId: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  naceCode: z.string().regex(/^\d{2}(\.\d{1,3})?$/).optional(),
  evidence: z.array(EvidenceRef).min(1),
});
export type CompanyPatch = z.infer<typeof CompanyPatch>;
