# ScrapJob

Enter a city and a position, and ScrapJob looks for real, named people worth contacting about that kind of job. Every
value it shows comes with a link to where it was found. It never invents a person, a title or an email address.

**Status: Phase 1 (skeleton).** The pipeline runs end to end with a source that finds nothing on purpose. Real sources,
contacts and the spreadsheet export arrive in Phase 2. See `docs/ANALYSIS.md` for the plan and its limits.

## Run it

Requires Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env    # optional in Phase 1; every key has a default
pnpm dev                # API on :3001, web on http://localhost:5173
```

`pnpm dev` creates `data/scrapjob.db` and applies the migrations on first start.

```bash
pnpm test               # all tests, no network access
pnpm typecheck
```

## Layout

| Path | What lives there |
| --- | --- |
| `packages/schema` | The only declaration of every data shape: Drizzle tables, Zod entity schemas, API contracts, adapter candidates |
| `packages/core` | Domain logic with no server, database or network: adapter interface, error taxonomy, registry, budget, orchestrator |
| `apps/api` | Fastify server, SQLite through Drizzle, persisted event log, SSE stream, in-process search worker |
| `apps/web` | React UI: the search form, the counter strip and the live log panel |
| `docs/` | Analysis and architecture decision records |

## How a search flows

1. `POST /api/searches` stores the search as `queued` and hands it to the in-process worker.
2. The worker runs the orchestrator from `packages/core` against every enabled source adapter.
3. Every event is written to `search_events` first, then pushed to listeners.
4. `GET /api/searches/:id/events` streams those events as Server-Sent Events. A reconnecting client sends
   `Last-Event-ID` and gets exactly what it missed.
5. If the server stops mid-search, the search is run again on the next start.

## Adding a source

Write a file in `apps/api/src/adapters/` that implements `SourceAdapter` from `packages/core`, add it to the list in
`apps/api/src/adapters/index.ts`, and name its id in `ENABLED_SOURCES`. Nothing else changes.

An adapter only throws `SourceFailure`, and every value it yields carries its own evidence (URL, snippet, timestamp).
The orchestrator rejects anything else.

## Legal and privacy position

ScrapJob collects only professional identity data that a person or their employer published, never guesses email
addresses, and respects `robots.txt` and rate limits. The full position (`PRIVACY.md`, `LIMITATIONS.md`) is written in
Phase 4. Until then, see the hard constraints in the spec and `docs/ANALYSIS.md` §5.1.
