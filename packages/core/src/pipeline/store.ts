import type { Company, CompanyCandidate, CompanyPatch, Confidence, JobCandidate } from '@scrapjob/schema';
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
  /** Stores a posting from a job feed; false when it was already known. */
  saveJob(company: Company, job: JobCandidate, adapter: string): boolean;
  /** Adds register facts to an employer, with their evidence, and returns it updated. */
  applyCompanyPatch(company: Company, patch: CompanyPatch, adapter: string): Company;
  /** True when this person, at this employer, asked to be erased. */
  isBlocked(normalisedName: string, company: Company): boolean;
  /** Inserts a validated contact with its evidence and returns its id. */
  insertContact(searchId: string, scored: ScoredDraft): string;
  /** Rewrites a contact after a merge or a deep search: new evidence, chosen values, new score. */
  updateContact(contactId: string, scored: ScoredDraft): void;
  flagPossibleDuplicate(contactId: string, otherId: string): void;
}
