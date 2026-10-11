# ADR 0005 — Phase 3: deep search, new sources, interface changes

Status: accepted (Phase 3)

## Deep search (spec §8.2)

`runDeepSearch` in `packages/core` asks every enabled source with the `enrich` capability for evidence about one
contact, then applies it with `applyPatches`:

- Evidence is always appended; the contact row is updated, never duplicated.
- A value is replaced only by one with strictly higher confidence.
- A different **title** (unless it is the same job, e.g. "Senior …") or a different **employer** is a contradiction:
  both values stay in evidence, the field is flagged `contradicted` and shows as `UNKNOWN`. Nothing picks a winner.
- The person's name never changes; evidence about someone else is ignored.
- `MAX_DEEP_SEARCH_REQUESTS` caps page fetches and search-API calls together.
- `deep_searches` stores a snapshot before and after (values, per-field confidence, score, lead) and the list of
  changes, which the detail page shows as a diff. Deep-search events go to the search's own stream, tagged with
  `deepSearchId`.

A deep search cannot start while its search is still running (409), because the running search holds the contact in
memory and would overwrite the enrichment.

## Sources

| Source | What it does | Why this way |
| --- | --- | --- |
| `job-board` | Reads the public job feeds that Recruitee, Lever and Greenhouse document for embedding (per employer). | Commercial job boards forbid automated access. The Le Forem open-data portal (`odwb.be`) disallows `/api/` for every crawler except Googlebot in its `robots.txt` (checked 2026-10-10), so it is not used. VDAB requires an API agreement. |
| `registry` | Matches an employer to the KBO/BCE register (imported locally with `pnpm registry:import`) for its enterprise number and main NACE activity. Feeds the +10 sector score through `config/sectors.yaml`. | Open data, no network at search time. Never a people source (the open data has no directors). Homonyms outside the searched area are not guessed. |
| `press-events` | Searches for the employer with speaker / meetup / press words, reads up to two non-employer pages, keeps people whose own card names the employer and whose title is hiring-relevant. | A neighbour's card on the same page must not lend its employer to someone else. |
| `web-search`, `company-site`, `linkedin-public` | Gain `enrich`: name + employer lookup on third-party pages; re-reading the employer's site; the current LinkedIn title as the index shows it. | Only a work address on the employer's own domain is ever taken from a third-party page. |

KBO open-data column names are taken from the published extract layout; the importer checks the header of every file
and stops with the file and column name if the layout differs.

## Interface changes from spec §6

- `discoverJobs(ctx, company)`: job feeds exist per employer, not per search.
- `enrich(ctx, target)` receives the contact's values and its employer, and returns `{ patches, postings }`, so a
  posting found during a deep search can be linked to the contact.
- Optional `enrichCompany(ctx, company)` for register facts, asked right after an employer is discovered and before
  its people are scored.
- Evidence gains `source_kind = 'dataset'` for open-data records.
