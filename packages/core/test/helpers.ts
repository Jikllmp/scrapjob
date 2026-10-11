import { randomUUID } from 'node:crypto';
import type {
  Company,
  CompanyCandidate,
  CompanyCandidateInput,
  CompanyPatch,
  ContactCandidate,
  JobCandidate,
  EventLevel,
  EventType,
  SourceCapability,
} from '@scrapjob/schema';
import hosts from '../../../config/hosts.yaml?raw';
import locations from '../../../config/locations.yaml?raw';
import roles from '../../../config/roles.yaml?raw';
import sectors from '../../../config/sectors.yaml?raw';
import synonyms from '../../../config/synonyms.yaml?raw';
import { parseTaxonomy, type EnrichTarget, type EventSink, type PipelineStore, type ScoredDraft, type SourceAdapter } from '../src';

export const taxonomy = parseTaxonomy({ synonyms, roles, locations, hosts, sectors });

export interface RecordedEvent {
  type: EventType;
  level: EventLevel;
  message: string;
  metadata: Record<string, unknown>;
}

export class RecordingSink implements EventSink {
  readonly events: RecordedEvent[] = [];

  emit(type: EventType, level: EventLevel, message: string, metadata: Record<string, unknown> = {}): void {
    this.events.push({ type, level, message, metadata });
  }

  types(): EventType[] {
    return this.events.map((e) => e.type);
  }

  ofType(type: EventType): RecordedEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

/** In-memory PipelineStore for tests. */
export class MemoryStore implements PipelineStore {
  readonly companies = new Map<string, Company>();
  readonly contacts = new Map<string, ScoredDraft>();
  readonly flagged: [string, string][] = [];
  readonly blocked = new Set<string>();
  readonly jobs: JobCandidate[] = [];

  upsertCompany(candidate: CompanyCandidate): Company {
    const existing = [...this.companies.values()].find(
      (c) => (candidate.domain && c.domain === candidate.domain) || c.name === candidate.name,
    );
    if (existing) return existing;
    const company: Company = {
      id: randomUUID(),
      name: candidate.name,
      normalisedName: candidate.name.toLowerCase(),
      website: candidate.website ?? null,
      domain: candidate.domain ?? null,
      city: candidate.city ?? null,
      country: candidate.country ?? null,
      industry: null,
      sizeBucket: null,
      registryId: null,
      naceCode: null,
      isAgency: candidate.isAgency ?? false,
      genericEmail: null,
    };
    this.companies.set(company.id, company);
    return company;
  }

  savePostings(_company: Company, candidate: CompanyCandidate): number {
    return candidate.postings.length;
  }

  saveJob(_company: Company, job: JobCandidate): boolean {
    if (this.jobs.some((j) => j.url === job.url)) return false;
    this.jobs.push(job);
    return true;
  }

  applyCompanyPatch(company: Company, patch: CompanyPatch): Company {
    const updated = { ...company, ...(patch.registryId ? { registryId: patch.registryId } : {}), ...(patch.industry ? { industry: patch.industry } : {}), ...(patch.naceCode ? { naceCode: patch.naceCode } : {}) };
    this.companies.set(company.id, updated);
    return updated;
  }

  isBlocked(normalisedName: string): boolean {
    return this.blocked.has(normalisedName);
  }

  insertContact(_searchId: string, scored: ScoredDraft): string {
    const id = randomUUID();
    this.contacts.set(id, scored);
    return id;
  }

  updateContact(id: string, scored: ScoredDraft): void {
    this.contacts.set(id, scored);
  }

  flagPossibleDuplicate(id: string, otherId: string): void {
    this.flagged.push([id, otherId]);
  }
}

export const T = '2026-10-08T00:00:00.000Z';

export function company(name: string, extra: Partial<CompanyCandidateInput> = {}): CompanyCandidateInput {
  const domain = `${name.toLowerCase().replace(/[^a-z]/g, '')}.test`;
  return {
    name,
    domain,
    website: `https://${domain}/`,
    evidence: [
      {
        field: 'name',
        value: name,
        sourceUrl: `https://${domain}/`,
        snippet: `${name} is hiring in Charleroi`,
        sourceKind: 'search_snippet',
        retrievedAt: T,
      },
    ],
    ...extra,
  };
}

/** A person published on the employer's own team page. */
export function teamPagePerson(companyName: string, fullName: string, title: string, extra: Partial<ContactCandidate> = {}): ContactCandidate {
  const domain = `${companyName.toLowerCase().replace(/[^a-z]/g, '')}.test`;
  const url = `https://${domain}/equipe`;
  const snippet = `${fullName} ${title} ${companyName}`;
  return {
    fullName,
    title,
    companyName,
    evidence: (['full_name', 'title', 'company'] as const).map((field) => ({
      field,
      value: field === 'full_name' ? fullName : field === 'title' ? title : companyName,
      sourceUrl: url,
      snippet,
      sourceKind: 'page' as const,
      retrievedAt: T,
    })),
    ...extra,
  };
}

interface FakeAdapterOptions {
  id: string;
  capabilities?: SourceCapability[];
  available?: boolean | (() => Promise<boolean>);
  companies?: () => AsyncIterable<unknown>;
  people?: (company: Company) => AsyncIterable<unknown>;
  jobs?: (company: Company) => AsyncIterable<unknown>;
  enrich?: (target: EnrichTarget) => Promise<unknown>;
  enrichCompany?: (company: Company) => Promise<unknown>;
}

export function fakeAdapter(options: FakeAdapterOptions): SourceAdapter {
  const empty = async function* () {};
  const available = options.available ?? true;
  return {
    id: options.id,
    displayName: options.id,
    capabilities: new Set(options.capabilities ?? ['companies']),
    isAvailable: typeof available === 'function' ? available : async () => available,
    discoverCompanies: (options.companies ?? empty) as SourceAdapter['discoverCompanies'],
    discoverJobs: ((_ctx: unknown, c: Company) => (options.jobs ?? empty)(c)) as SourceAdapter['discoverJobs'],
    discoverPeople: ((_ctx: unknown, c: Company) => (options.people ?? empty)(c)) as SourceAdapter['discoverPeople'],
    enrich: (async (_ctx: unknown, t: EnrichTarget) => (options.enrich ? options.enrich(t) : {})) as SourceAdapter['enrich'],
    ...(options.enrichCompany
      ? { enrichCompany: ((_ctx: unknown, c: Company) => options.enrichCompany!(c)) as NonNullable<SourceAdapter['enrichCompany']> }
      : {}),
  };
}
