import { z } from 'zod';
import { EvidenceField } from './enums';

const url = z.url({ protocol: /^https?$/ });
const isoDate = z.iso.datetime({ offset: true });

/** What an adapter saw, where, and when. Every candidate value must be backed by one. */
export const EvidenceRef = z.object({
  field: EvidenceField,
  value: z.string().min(1),
  sourceUrl: url,
  snippet: z.string().min(1).max(500),
  retrievedAt: isoDate,
  publishedAt: isoDate.optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const CompanyCandidate = z.object({
  name: z.string().min(1),
  website: url.optional(),
  domain: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  isAgency: z.boolean().optional(),
  evidence: z.array(EvidenceRef).min(1),
});
export type CompanyCandidate = z.infer<typeof CompanyCandidate>;

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
  evidence: z.array(EvidenceRef).min(1),
});
export type ContactCandidate = z.infer<typeof ContactCandidate>;

export const EvidencePatch = z.object({
  field: EvidenceField,
  evidence: EvidenceRef,
});
export type EvidencePatch = z.infer<typeof EvidencePatch>;
