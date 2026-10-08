import type { Confidence, EvidenceRef } from '@scrapjob/schema';

/** Contact fields that carry evidence. `company` stands for the link to the employer. */
export const contactFields = [
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
export type ContactField = (typeof contactFields)[number];

export interface AttributedEvidence extends EvidenceRef {
  sourceAdapter: string;
}

export interface CompanyRef {
  id: string;
  name: string;
  domain: string | null;
  isAgency: boolean;
}

/** A contact as the pipeline builds it, before or after persistence. */
export interface ContactDraft {
  id: string | null;
  fields: Partial<Record<ContactField, string>>;
  company: CompanyRef | null;
  evidence: AttributedEvidence[];
  roleArchetype: string;
  roleTier: number;
  roleGenericOnly: boolean;
  /** Field name → flags such as `contradicted`. */
  fieldFlags: Record<string, string[]>;
}

export const confidenceRank: Record<Confidence, number> = { VERIFIED: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 };

export function lowestConfidence(values: Confidence[]): Confidence {
  return values.reduce<Confidence>((min, c) => (confidenceRank[c] < confidenceRank[min] ? c : min), 'VERIFIED');
}

/**
 * An unconfirmed lead (ADR 0002): who the person is, or where they work, rests
 * on nothing better than a search snippet. Pass the lower of the `full_name`
 * and `company` field confidences. A missing title alone does not make a lead.
 */
export function isLead(identityConfidence: Confidence): boolean {
  return confidenceRank[identityConfidence] <= confidenceRank.LOW;
}
