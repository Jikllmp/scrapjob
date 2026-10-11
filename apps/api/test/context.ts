import { Budget, planQueries, type SearchContext } from '@scrapjob/core';
import type { EventLevel, EventType } from '@scrapjob/schema';
import { loadTaxonomy } from '../src/taxonomy';
import { configDir } from './helpers';

export const taxonomy = loadTaxonomy(configDir);

export interface CollectedEvent {
  type: EventType;
  level: EventLevel;
  message: string;
  metadata: Record<string, unknown>;
}

/** A SearchContext for driving adapters and the HTTP client directly. */
export function searchContext(overrides: Partial<{ maxHttpRequests: number; maxSearchApiCalls: number }> = {}) {
  const events: CollectedEvent[] = [];
  const budget = new Budget({
    maxDurationMs: 600_000,
    maxHttpRequests: overrides.maxHttpRequests ?? 300,
    maxSearchApiCalls: overrides.maxSearchApiCalls ?? 40,
  });
  const ctx: SearchContext = {
    searchId: 'test-search',
    location: 'Charleroi',
    position: 'Développeur .NET',
    targetCount: 20,
    signal: new AbortController().signal,
    budget,
    events: { emit: (type, level, message, metadata = {}) => void events.push({ type, level, message, metadata }) },
    plan: planQueries('Charleroi', 'Développeur .NET', taxonomy),
    taxonomy,
    shouldStop: () => budget.exhausted() !== null,
  };
  return { ctx, events, budget };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
