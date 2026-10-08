import type { CompanyCandidate, EventLevel, EventType, SourceCapability } from '@scrapjob/schema';
import type { EventSink, SourceAdapter } from '../src';

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
}

export function company(name: string): CompanyCandidate {
  return {
    name,
    evidence: [
      {
        field: 'name',
        value: name,
        sourceUrl: `https://example.test/${encodeURIComponent(name)}`,
        snippet: `${name} is hiring`,
        retrievedAt: '2026-10-08T00:00:00.000Z',
      },
    ],
  };
}

interface FakeAdapterOptions {
  id: string;
  capabilities?: SourceCapability[];
  available?: boolean | (() => Promise<boolean>);
  companies?: () => AsyncIterable<unknown>;
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
    discoverJobs: empty,
    discoverPeople: empty,
    enrich: async () => [],
  };
}
