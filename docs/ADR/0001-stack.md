# ADR 0001 — Stack

Status: accepted (Phase 1)

The stack in spec §3 is used as written, with one deviation and two clarifications.

## Deviation (1 of the 2 allowed)

**Search API: Brave only, no SerpAPI fallback.** SerpAPI scrapes Google results pages on the caller's behalf. That is the
practice §2.1 exists to rule out, so it cannot be described as licensed access. `SERPAPI_KEY` is not part of the
configuration. Another licensed index can be added later as a separate adapter.

## Clarifications (not deviations)

- **Zod and Drizzle share one declaration.** No library derives Drizzle tables from Zod. The reverse is well supported,
  so the tables are declared once in `packages/schema/src/tables.ts`, and the entity Zod schemas are derived from them
  with `drizzle-zod`. The API contracts and adapter candidates are hand-written Zod schemas in the same package.
  Nothing outside `packages/schema` declares a contact shape.
- **TanStack Query** is the server-state library allowed by "React Query + local state".

## Versions

Node 22 LTS (`.nvmrc`), pnpm 10 through Corepack, TypeScript 6.0, Vite 7, Vitest 4, better-sqlite3 12. The latest
majors of Vite (8), Vitest (5) and TypeScript (7) are only weeks old, so they are not used yet. better-sqlite3 12
ships prebuilt binaries for Node 20 to 26 on Windows, macOS and Linux.
