import type { Company, CompanyCandidate, Confidence } from '@scrapjob/schema';
import type { ContactDraft } from '../contacts/fields';
import type { Score } from '../contacts/scoring';

export interface ScoredDraft {
  draft: ContactDraft;
  score: Score;
  confidence: Confidence;
}

/** What the pipeline needs from persistence. The API implements it over SQLite. */
export interface PipelineStore {
  upsertCompany(candidate: CompanyCandidate, adapter: string): Company;
  savePostings(company: Company, candidate: CompanyCandidate, adapter: string): number;
  isBlocked(normalisedName: string, companyDomain: string | null): boolean;
  /** Inserts a validated contact with its evidence and returns its id. */
  insertContact(searchId: string, scored: ScoredDraft): string;
  /** Rewrites a contact after a merge: new evidence, chosen values, new score. */
  updateContact(contactId: string, scored: ScoredDraft): void;
  flagPossibleDuplicate(contactId: string, otherId: string): void;
}
