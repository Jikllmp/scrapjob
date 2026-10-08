import { createSelectSchema } from 'drizzle-zod';
import { z } from 'zod';
import { BudgetSpent } from './api';
import * as t from './tables';

const jsonObject = z.record(z.string(), z.unknown());

export const Search = createSelectSchema(t.searches, { budgetSpent: BudgetSpent });
export type Search = z.infer<typeof Search>;

export const Company = createSelectSchema(t.companies);
export type Company = z.infer<typeof Company>;

export const JobOpportunity = createSelectSchema(t.jobOpportunities);
export type JobOpportunity = z.infer<typeof JobOpportunity>;

export const Contact = createSelectSchema(t.contacts, {
  relevanceReasons: z.array(z.string()),
  fieldFlags: z.record(z.string(), z.array(z.string())),
});
export type Contact = z.infer<typeof Contact>;

export const Evidence = createSelectSchema(t.evidence, { snippet: z.string().max(500) });
export type Evidence = z.infer<typeof Evidence>;

export const SearchEvent = createSelectSchema(t.searchEvents, { metadata: jsonObject });
export type SearchEvent = z.infer<typeof SearchEvent>;

export const DeepSearch = createSelectSchema(t.deepSearches, {
  fieldsBefore: jsonObject.nullable(),
  fieldsAfter: jsonObject.nullable(),
});
export type DeepSearch = z.infer<typeof DeepSearch>;

export const Export = createSelectSchema(t.exports);
export type Export = z.infer<typeof Export>;

export const BlocklistEntry = createSelectSchema(t.blocklist);
export type BlocklistEntry = z.infer<typeof BlocklistEntry>;
