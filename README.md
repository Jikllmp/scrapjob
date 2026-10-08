# ScrapJob

Enter a city and a position, and ScrapJob looks for real, named people worth contacting about that kind of job. Every
value it shows comes with a link to where it was found. It never invents a person, a title or an email address.

**Status: Phase 2 (MVP).** A search queries Brave, reads employer sites and LinkedIn titles seen in search results,
keeps only evidenced people, scores and deduplicates them, and stops at 20 contacts or when the sources run dry. The
results table filters, sorts and exports to `.xlsx`. See `docs/ANALYSIS.md` for the plan and its limits.

## Run it

Requires Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env    # then set BRAVE_API_KEY and USER_AGENT_CONTACT_URL
pnpm dev                # API on :3001, web on http://localhost:5173
```

`pnpm dev` creates `data/scrapjob.db` and applies the migrations on first start. Without `BRAVE_API_KEY` the search
fails at once with "no company discovery source is available"; without `USER_AGENT_CONTACT_URL` it refuses to send any
request.

### Try it without a key

```bash
pnpm demo               # same app, but every request is answered from apps/api/test/fixtures
```

Open http://localhost:5173 and search **Développeur .NET** in **Charleroi** (the only search with fixtures). You
should get 4 contacts at fictional `.test` employers: 2 confirmed, 2 unconfirmed leads. The demo uses a throwaway
database and export folder in your temp directory.

```bash
pnpm test               # all tests, no network access
pnpm typecheck
```

## Layout

| Path | What lives there |
| --- | --- |
| `packages/schema` | The only declaration of every data shape: Drizzle tables, Zod entity schemas, API contracts, adapter candidates |
| `packages/core` | Domain logic with no server, database or network: query planning, HTML extraction, confidence, scoring, dedup, orchestrator |
| `apps/api` | Fastify server, SQLite through Drizzle, polite HTTP client, Brave client, source adapters, Excel export, SSE stream |
| `apps/web` | React UI: the search form, the counter strip, the results table and the live log panel |
| `config/` | Editable YAML: position synonyms, role archetypes, Belgian places, and lists of aggregator, media, ATS and agency hosts |
| `docs/` | Analysis and architecture decision records |

## How a search flows

1. `POST /api/searches` stores the search as `queued` and hands it to the in-process worker.
2. The worker runs the orchestrator from `packages/core` against every enabled source adapter.
3. Every event is written to `search_events` first, then pushed to listeners.
4. `GET /api/searches/:id/events` streams those events as Server-Sent Events. A reconnecting client sends
   `Last-Event-ID` and gets exactly what it missed.
5. If the server stops mid-search, the search is run again on the next start.

Inside the orchestrator:

1. Up to 12 search queries are planned from `config/` (careers pages, then job posts, then company lists).
2. **web-search** turns Brave results into employers and job posts, skipping job boards and news sites.
3. For each new employer, **company-site** reads the home page and up to 4 team, contact or careers pages, and
   **linkedin-public** reads LinkedIn titles that Brave returns (it never opens linkedin.com).
4. Each person is kept only if their name and employer have evidence, and their title (or a "contact person" line on
   a job post) matches a hiring-relevant role.
5. Duplicates are merged, contacts below `MIN_RELEVANCE_SCORE` are dropped, and the search stops at the target, when
   the sources are exhausted, or when a budget runs out.

### Confidence and leads

| Level | Meaning |
| --- | --- |
| VERIFIED | Read on the employer's own site, or its job board page |
| HIGH | Two independent sites agree |
| MEDIUM | One page that is not a job board or aggregator |
| LOW | Only a search result snippet, or an aggregator |
| UNKNOWN | Older than 24 months, contradicted, or no evidence |

A contact is an **unconfirmed lead** when their name or employer is only LOW. Leads count toward the 20 and are marked
in the table and the export.

## Changing what counts as relevant

Edit the YAML files in `config/` and restart the API. A file that does not parse stops the server with the file name
and the reason.

## Adding a source

Write a file in `apps/api/src/adapters/` that implements `SourceAdapter` from `packages/core`, add it to the list in
`apps/api/src/adapters/index.ts`, and name its id in `ENABLED_SOURCES`. Nothing else changes.

An adapter only throws `SourceFailure`, and every value it yields carries its own evidence (URL, snippet, timestamp).
The orchestrator rejects anything else.

## Legal and privacy position

ScrapJob collects only professional identity data that a person or their employer published, never guesses email
addresses, and respects `robots.txt` and rate limits. The full position (`PRIVACY.md`, `LIMITATIONS.md`) is written in
Phase 4. Until then, see the hard constraints in the spec and `docs/ANALYSIS.md` §5.1.
