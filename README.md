# ScrapJob

Enter a city and a position, and ScrapJob looks for real, named people worth contacting about that kind of job. Every
value it shows comes with a link to where it was found. It never invents a person, a title or an email address.

**Status: Phase 4 (hardening), feature-complete against the spec.** A search queries Brave, reads employer sites, their
job feeds, conference and press pages and LinkedIn titles seen in search results, keeps only evidenced people, scores
and deduplicates them, and stops at 20 contacts or when the sources run dry. Each contact has a detail page showing
where every value came from, a deep search that adds corroboration with a before/after diff, and an erase button.
Contacts are deleted automatically after 180 days. It has not yet been run against the live web; see
[`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) before judging a result.

## Run it

Requires Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable`).

```bash
pnpm install
cp .env.example .env    # then set BRAVE_API_KEY and USER_AGENT_CONTACT_URL
pnpm dev                # API on :3001, web on http://localhost:5173
```

`pnpm dev` creates `data/scrapjob.db` and applies the migrations on first start. Without `USER_AGENT_CONTACT_URL` it
refuses to send any request.

### Search without an API key

Until you have a Brave key, employers come from your own list in `config/employers.yaml` (name, website, commune,
optional fields; a few examples ship with it, check them). Set `USER_AGENT_CONTACT_URL` (for example
`https://github.com/Jikllmp/scrapjob`) and restart the API after editing the list. A search then:

1. takes the listed employers inside the city (its sections included) and in the position's field;
2. reads their own sites and job feeds for recruiters and managers, as with a key;
3. lists the employers under the results, each with a **Search on LinkedIn** button. It opens a LinkedIn people search
   for that employer's recruiters in your own browser, logged in as you. The app never opens LinkedIn itself.
4. **Add a person** on the same row takes the profile URL, name and title you copy from LinkedIn and adds them as a
   contact (`MEDIUM`, "added by you"). The link is stored, never opened.

If your `.env` sets `ENABLED_SOURCES`, add `employer-list` to it. With neither a key nor a listed employer in the
city, the search stops at once with "no company discovery source is available".

### Try it without a key

```bash
pnpm demo               # same app, but every request is answered from apps/api/test/fixtures
```

Open http://localhost:5173 and search **Développeur .NET** in **Charleroi** (the only search with fixtures). You
should get 5 contacts at fictional `.test` employers: 3 confirmed, 2 unconfirmed leads. Open **Paul Martin** and run a
deep search: a press article confirms his name and employer, and he stops being a lead. The demo uses a throwaway
database and export folder in your temp directory, with a synthetic business register already imported.

### Business register (optional)

The `registry` source needs the Belgian KBO/BCE open data. Register for free on the KBO open-data portal, download the
latest "Full" extract, unzip it, then:

```bash
pnpm registry:import -- path/to/KboOpenData_xxxx_Full
```

Without it the source shows as unavailable and the sector score is simply not awarded.

### Tests

```bash
pnpm test               # unit and API tests on recorded fixtures, no network access
pnpm test:e2e           # one Playwright run in Chromium: search, live log, rows, detail, deep search, download
pnpm typecheck
```

`pnpm test:e2e` starts the demo API on port 3101 and the web app on 5174 by itself. It needs a Chromium that
Playwright can find (`pnpm exec playwright install chromium` once, or set `PLAYWRIGHT_CHROMIUM_PATH`).

### Your data

```bash
pnpm data:purge -- --search <id>   # one search, its contacts, evidence and spreadsheets
pnpm data:purge -- --all           # everything collected; the app keeps running
pnpm data:purge -- --expired       # apply the retention rule now
```

The retention rule (`DATA_RETENTION_DAYS`, 180 by default) also runs when the API starts and every 24 hours while it
runs. `--all` keeps the erasure blocklist, so erased people stay out of later searches.

## Layout

| Path | What lives there |
| --- | --- |
| `packages/schema` | The only declaration of every data shape: Drizzle tables, Zod entity schemas, API contracts, adapter candidates |
| `packages/core` | Domain logic with no server, database or network: query planning, HTML extraction, confidence, scoring, dedup, orchestrator |
| `apps/api` | Fastify server, SQLite through Drizzle, polite HTTP client, Brave client, source adapters, Excel export, SSE stream |
| `apps/web` | React UI: search, results table and live log; contact detail with evidence and deep search; history; source health; privacy |
| `config/` | Editable YAML: position synonyms, role archetypes, Belgian places, and lists of aggregator, media, ATS and agency hosts |
| `e2e/` | The Playwright end-to-end test |
| `docs/` | Analysis, architecture decision records, limitations and the legitimate interest assessment |

## How a search flows

1. `POST /api/searches` stores the search as `queued` and hands it to the in-process worker.
2. The worker runs the orchestrator from `packages/core` against every enabled source adapter.
3. Every event is written to `search_events` first, then pushed to listeners.
4. `GET /api/searches/:id/events` streams those events as Server-Sent Events. A reconnecting client sends
   `Last-Event-ID` and gets exactly what it missed.
5. If the server stops mid-search, the search is run again on the next start. Contacts it had already stored are kept
   and new sightings merge into them; events already written are not sent again.

Inside the orchestrator:

1. Up to 12 search queries are planned from `config/` (careers pages, then job posts, then company lists).
2. **web-search** turns Brave results into employers and job posts, skipping job boards and news sites.
3. For each new employer: **registry** adds its legal name and sector, **job-board** reads its public job feed, then
   **company-site** reads its home page and up to 4 team, contact or careers pages, **linkedin-public** reads LinkedIn
   titles that Brave returns (it never opens linkedin.com), and **press-events** reads press and speaker pages that
   name someone together with the employer.
4. Each person is kept only if their name and employer have evidence, and their title (or a "contact person" line on
   a job post) matches a hiring-relevant role.
5. Duplicates are merged, contacts below `MIN_RELEVANCE_SCORE` are dropped, and the search stops at the target, when
   the sources are exhausted, or when a budget runs out.

### When the web misbehaves

Every request goes through one HTTP client (`apps/api/src/http/client.ts`):

- `robots.txt` is read before the first page of a host and again after 24 hours; a disallowed path, an `X-Robots-Tag`
  or a meta robots `noindex` means the page is skipped. A `robots.txt` that answers 5xx means "disallow everything".
- At most `PER_HOST_RPS` requests per second per host (burst of 3) and `MAX_CONCURRENT_REQUESTS` at once, each with a
  `REQUEST_TIMEOUT_MS` timeout.
- Timeouts and 5xx are retried `RETRY_COUNT` times with exponential backoff and jitter; 4xx never are.
- 429 and 403 back off (honouring `Retry-After`) and count as a failure of the source.
- After 5 consecutive failures on one host, that host is skipped for the rest of the search (circuit breaker).
- A source that fails `SOURCE_FAILURE_THRESHOLD` times in one search is disabled for that search; the others carry on,
  and the search fails only when no discovery source is left.

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

1. Write `apps/api/src/adapters/<id>.ts` with a class that implements `SourceAdapter` from `packages/core`
   (`packages/core/src/adapters/types.ts`). Declare the `capabilities` it has (`companies`, `jobs`, `people`,
   `enrich`) and implement the matching methods; the others yield nothing.
2. Fetch only through the shared `HttpClient` (or `fetchPage` in `adapters/pages.ts` for HTML), so robots.txt, rate
   limits, retries, budgets and the circuit breaker apply.
3. Give every value its own evidence: the URL, a snippet that contains the value, the source kind and the time. The
   orchestrator drops any candidate whose value is not in its snippet, and the database refuses a field without
   evidence.
4. Throw only `SourceFailure` (`sourceFailure(id, kind, message, url)`), and return `false` from `isAvailable()` with an
   `unavailableReason()` when a key or setting is missing.
5. Add it to the list in `apps/api/src/adapters/index.ts` and its id to `ENABLED_SOURCES`.
6. Record a fixture in `apps/api/test/fixtures`, map it in `fixtures/transport.ts`, and test it in
   `test/adapters.test.ts` (results, empty results, malformed pages, 429/403, robots.txt).

## Legal and privacy position

ScrapJob processes personal data of people who never asked to be in it, so it is built to stay inside the rules
rather than to get the most data:

- **Only professional identity** that the person or their employer published: name, title, employer, work location,
  a published work email or phone, a public profile URL. Nothing personal and nothing in the special categories.
- **No fabrication.** Every stored value is backed by evidence (URL, snippet, date), enforced by database triggers. No
  email address is ever derived from a naming pattern or checked against a mail server.
- **Polite and honest crawling.** A User-Agent that names the tool and a contact URL, `robots.txt` honoured, rate limits,
  no login pages, no CAPTCHA bypass, no LinkedIn pages, no commercial job boards.
- **Retention and erasure.** Contacts are deleted after `DATA_RETENTION_DAYS`; the purge command deletes on demand; the
  erase button deletes a person with their evidence and spreadsheets and blocklists them.
- **Transparency.** The `/privacy` page and [`PRIVACY.md`](PRIVACY.md) state the controller, purpose, lawful basis,
  data, sources, retention and how to object. `PRIVACY.md` also has a short notice, in French, Dutch and English, to
  put in your first message to each contact, since they never see the app.
- **Lawful basis.** Legitimate interest, with the balancing test in [`docs/LIA.md`](docs/LIA.md).

This is a personal job-search aid run on your own machine. It is not legal advice, and sharing the tool or its data
changes the assessment.
