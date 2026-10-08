import { z } from 'zod';
import { EventLevel, EventType, SearchStatus } from './enums';

export const BudgetSpent = z.object({
  httpRequests: z.number().int().nonnegative().default(0),
  searchApiCalls: z.number().int().nonnegative().default(0),
  deepSearchRequests: z.number().int().nonnegative().default(0),
  elapsedMs: z.number().int().nonnegative().default(0),
});
export type BudgetSpent = z.infer<typeof BudgetSpent>;

const trimmedText = (max: number) => z.string().trim().min(2).max(max);

export const CreateSearchBody = z.object({
  location: trimmedText(100),
  position: trimmedText(120),
  targetCount: z.number().int().min(1).max(100).optional(),
});
export type CreateSearchBody = z.infer<typeof CreateSearchBody>;

export const CreateSearchResponse = z.object({ searchId: z.string() });
export type CreateSearchResponse = z.infer<typeof CreateSearchResponse>;

export const SearchIdParams = z.object({ id: z.string().min(1).max(64) });

export const SearchDto = z.object({
  id: z.string(),
  location: z.string(),
  position: z.string(),
  targetCount: z.number().int(),
  status: SearchStatus,
  budgetSpent: BudgetSpent,
  stopReason: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
  counters: z.object({
    events: z.number().int(),
    contactsValidated: z.number().int(),
    companies: z.number().int(),
  }),
});
export type SearchDto = z.infer<typeof SearchDto>;

export const ListSearchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const SearchListDto = z.object({
  items: z.array(SearchDto),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type SearchListDto = z.infer<typeof SearchListDto>;

export const SearchEventDto = z.object({
  seq: z.number().int().positive(),
  type: EventType,
  level: EventLevel,
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type SearchEventDto = z.infer<typeof SearchEventDto>;

export const SourceCapability = z.enum(['companies', 'jobs', 'people', 'enrich']);
export type SourceCapability = z.infer<typeof SourceCapability>;

export const SourceDto = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: z.array(SourceCapability),
  enabled: z.boolean(),
  available: z.boolean(),
});
export type SourceDto = z.infer<typeof SourceDto>;

export const HealthDto = z.object({ status: z.literal('ok'), version: z.string() });

/** RFC 9457 problem details. */
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof Problem>;
