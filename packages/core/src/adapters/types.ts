import type {
  Company,
  CompanyCandidateInput,
  Contact,
  ContactCandidate,
  EventLevel,
  EventType,
  EvidencePatch,
  JobCandidate,
  SourceCapability,
} from '@scrapjob/schema';
import type { Budget } from '../budget';
import type { QueryPlan } from '../planning/queries';
import type { Taxonomy } from '../taxonomy';

export interface EventSink {
  emit(type: EventType, level: EventLevel, message: string, metadata?: Record<string, unknown>): void;
}

export interface SearchContext {
  readonly searchId: string;
  readonly location: string;
  readonly position: string;
  readonly targetCount: number;
  readonly signal: AbortSignal;
  readonly budget: Budget;
  readonly events: EventSink;
  readonly plan: QueryPlan;
  readonly taxonomy: Taxonomy;
  /** True once the search must stop issuing new work (target, budget, cancel). */
  shouldStop(): boolean;
}

export interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<SourceCapability>;
  isAvailable(): Promise<boolean>;
  /** Why the adapter is unavailable, shown in the log. */
  unavailableReason?(): string;
  discoverCompanies(ctx: SearchContext): AsyncIterable<CompanyCandidateInput>;
  discoverJobs(ctx: SearchContext): AsyncIterable<JobCandidate>;
  discoverPeople(ctx: SearchContext, company: Company): AsyncIterable<ContactCandidate>;
  enrich(ctx: SearchContext, contact: Contact): Promise<EvidencePatch[]>;
}

export const discoveryCapabilities: readonly SourceCapability[] = ['companies', 'jobs', 'people'];

export function isDiscoveryCapable(adapter: SourceAdapter): boolean {
  return discoveryCapabilities.some((c) => adapter.capabilities.has(c));
}
