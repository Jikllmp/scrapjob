import type {
  Company,
  CompanyCandidateInput,
  CompanyPatch,
  ContactCandidate,
  EnrichResultInput,
  EventLevel,
  EventType,
  JobCandidate,
  SourceCapability,
} from '@scrapjob/schema';
import type { Budget } from '../budget';
import type { ContactField } from '../contacts/fields';
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

/** The contact a deep search works on: its current values and its employer. */
export interface EnrichTarget {
  contactId: string;
  fields: Partial<Record<ContactField, string>>;
  company: Company | null;
}

/**
 * Differences from the spec's interface (ADR 0005): `discoverJobs` is asked per
 * employer, because job feeds are per employer; `enrich` receives the employer
 * and may return a relevant posting; `enrichCompany` adds register facts.
 */
export interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ReadonlySet<SourceCapability>;
  isAvailable(): Promise<boolean>;
  /** Why the adapter is unavailable, shown in the log and the sources view. */
  unavailableReason?(): string;
  discoverCompanies(ctx: SearchContext): AsyncIterable<CompanyCandidateInput>;
  discoverJobs(ctx: SearchContext, company: Company): AsyncIterable<JobCandidate>;
  discoverPeople(ctx: SearchContext, company: Company): AsyncIterable<ContactCandidate>;
  enrich(ctx: SearchContext, target: EnrichTarget): Promise<EnrichResultInput>;
  /** Facts about the employer itself (register, sector). Only sources with the `enrich` capability are asked. */
  enrichCompany?(ctx: SearchContext, company: Company): Promise<CompanyPatch | null>;
}

export const discoveryCapabilities: readonly SourceCapability[] = ['companies', 'jobs', 'people'];

export function isDiscoveryCapable(adapter: SourceAdapter): boolean {
  return discoveryCapabilities.some((c) => adapter.capabilities.has(c));
}
