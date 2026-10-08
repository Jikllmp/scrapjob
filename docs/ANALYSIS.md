# Phase 0 — Analysis

Spec: *Professional Contact Finder — Master Prompt v2* (Oct 8, 2026).
Status: answered on 2026-10-08. Leads count toward the target, Brave only, docs in English, code in `Jikllmp/scrapjob`. See `docs/ADR/0002-product-decisions.md`.

Claims marked **(verify)** are from my knowledge of third-party services and may have changed; I will check each one against the live documentation before the code depends on it.

---

## 1. Summary

The spec is strong. The no-fabrication design (evidence rows, substring check, no pattern-guessed emails) is the right backbone, and the stop-per-phase plan is sound. My main concerns are:

1. **Realistic yield.** For a Belgian city and a technical role, the sources the spec allows will produce mostly `LOW`/`MEDIUM` contacts, and probably fewer than 20. The single biggest source of *named* people will be LinkedIn titles seen through the search API, which the spec rightly treats as weak. Expect "8–15 / 20" to be the normal result, not the exception.
2. **SerpAPI is not licensed access.** It scrapes Google on your behalf. That conflicts with the spirit of §2.1. I recommend Brave only, with the adapter interface left open for another licensed index.
3. **The scoring lets a single unconfirmed LinkedIn snippet pass the threshold** (55 points against a threshold of 35). That contradicts "every row is a person they could plausibly write to tomorrow" unless the UI separates leads from confirmed contacts.
4. **Schema gaps.** Several things the spec asks for later (agency flag, role tier, possible duplicate, contradicted flag, job link, evidence date, per-budget counters) have no column in §4.1.
5. **"Enforce with a database constraint"** needs a concrete design in SQLite, which cannot express "every non-null column has an evidence row" as a plain constraint. I propose one below.

---

## 2. Ambiguities, and the default I will use

| # | Ambiguity | Default I will apply |
|---|---|---|
| A1 | **What is "inside the requested area"?** Charleroi is a merged commune: Gosselies (Aéropole, Biopark), Marcinelle, Jumet, Montignies-sur-Sambre, etc. are all Charleroi but rarely written as such. | The area is the commune plus its sections, from `config/locations.yaml`. The province (Hainaut) and region (Wallonie) are used for query expansion only and score as "same country, different city" (7). No geocoding in MVP. |
| A2 | **Where do location aliases come from?** The spec gives `Charleroi → Hainaut, Wallonie, FR + NL` but no data source. | Ship a small hand-written `config/locations.yaml` for Belgium (major communes, their sections, province, region, languages). An unknown location is used verbatim with country detection from the search results. |
| A3 | **12 seed queries vs. 40 search-API calls.** Per-company people queries (`"Company" recruteur IT`) also cost API calls. | The 12-query cap applies to *discovery* seed queries. Per-company people/enrichment queries draw from the remaining `MAX_SEARCH_API_CALLS` budget. Both are counted and shown. |
| A4 | **`targetCount` vs `MAX_CONTACTS_PER_SEARCH`.** | `targetCount` is per search, default 20, clamped to `MAX_CONTACTS_PER_SEARCH`. |
| A5 | **"Independent sources"** for `HIGH` confidence. | Independent means different registrable domains (eTLD+1). A search-API snippet is attributed to the domain of the result URL, not to Brave. Two pages on the same news site count once. |
| A6 | **Is a search snippet of the employer's own page `VERIFIED`?** | No. `VERIFIED` requires that the page itself was fetched and the value is a substring of it. A snippet alone is `LOW`. |
| A7 | **Is a career page on an ATS (`acme.recruitee.com`, `careers.teamtailor.com/acme`, Workable, Lever, SmartRecruiters) "the employer's own domain"?** | Yes, when the ATS account is linked from the employer's own site or carries the same company name. These are employer-published. Known ATS hosts live in a config list. |
| A8 | **How is evidence dated for the 24-month staleness rule?** Most team pages have no date. | Use, in order: a date in the document (article `datePublished`, JSON-LD, job `datePosted`), then `Last-Modified`. Undated evidence is **not** treated as stale. A new `published_at` column on `Evidence` holds it. |
| A9 | **Dedup scope.** `Contact` has `search_id`, so the same person found in two searches is two rows. | Dedup runs within one search. The blocklist is global. Cross-search linking is out of scope. |
| A10 | **Do company fields need evidence too?** §2.3 talks about contacts. | Yes, for `name`, `website`, `domain`, `industry`. Same table, `company_id` side. |
| A11 | **Generic mailboxes** (`jobs@`, `rh@`) are never contacts, but they are useful. | Stored on the company (with evidence), shown in the export's Notes column. Never a row of its own. |
| A12 | **What does deep search do to status?** A contradiction downgrades a field to `UNKNOWN`, which can push the score under 35. | Deep search never changes a contact's status. It updates fields and the score, sets `contradicted`, and the UI shows it. Only the user removes a contact. |
| A13 | **LLM use.** §2.3 allows an LLM for classification/extraction with a substring check, but the stack has no LLM and no key in `.env`. | No LLM in Phase 1–2. Extraction is rule-based (see R6). An optional extractor behind `ANTHROPIC_API_KEY` is a Phase 3 candidate if yields are poor, and it would still go through the substring check. |
| A14 | **Purge command.** §2.2 says `npm run data:purge`, §10.3 says `pnpm data:purge`. | `pnpm data:purge`. |
| A15 | **"Scheduled" retention job** on an app that only runs while `pnpm dev` is up. | Retention runs at boot and then every 24 h while the API runs. |
| A16 | **React Query** is named as allowed in §3 but missing from the stack table. | TanStack Query is part of the stack; this is not a deviation. |

---

## 3. Risks

### 3.1 Which sources will realistically yield named people

Estimated for *Charleroi / Développeur .NET*. "People" means a named individual in a hiring-relevant role.

| Source | Companies | Jobs | Named people | Typical confidence | Notes |
|---|---|---|---|---|---|
| `web-search` (Brave) | High | Medium | Medium, almost all via LinkedIn titles in results | `LOW` | Backbone of discovery. Snippets like *"Marie Dupont – Talent Acquisition – Acme \| LinkedIn"* are the most common way a name appears. |
| `linkedin-public` (titles from Brave results only) | — | — | **The largest people source** | `LOW` until corroborated | As specified, corroboration on the employer's site will succeed only occasionally. Most of these stay `LOW`. |
| `company-site` (team / about / careers pages) | — | Medium | Low for mid/large firms, medium for small firms | `VERIFIED` | Large employers almost never list recruiters. Small IT firms list founders and CTOs (tier 4). Belgian sites must show the company number but, unlike German *Impressum* pages, do not name directors, so the "imprint" route yields little in Belgium. |
| ATS career pages (part of `company-site`) | — | High for firms that use one | Low–medium | `VERIFIED` | Some ATS job pages show a named recruiter as the posting contact (tier 5, sometimes tier 1). Several ATS have documented public job-feed endpoints meant for embedding **(verify per vendor)**. |
| `job-board` | Medium | High | Low | `MEDIUM` | Indeed, StepStone, Jobat and LinkedIn Jobs disallow automated access in robots or terms and offer no public search API **(verify)**, so they are out. **Le Forem and VDAB publish job offers as open data / via APIs (verify)**, and Le Forem offers sometimes carry a named contact person. These are the realistic Belgian job sources. |
| `registry` (BCE/KBO) | Validation, not discovery | — | ~None | — | The KBO open-data dump has enterprises, addresses, NACE codes and contacts, but as far as I know **not** directors/functions **(verify)**. Directors appear on the public search site and in the Moniteur belge, neither of which is meant for bulk access. Use the registry for legal name, address and sector (which feeds the +10 sector score), not for people. Requires a free registration and a periodic bulk import. |
| `press-events` | Low | — | Low volume, high quality | `MEDIUM` | Conference speakers (Techorama is the obvious one for .NET in Belgium), local meetups, press releases. Meetup.com's API needs a paid Pro account **(verify)**; public event pages are fine within robots. |

**Expected outcome:** a typical search returns somewhere around 8–15 people, of whom a minority are `VERIFIED`/`MEDIUM`. Reaching 20 at ≥ `MEDIUM` will be rare for a city the size of Charleroi. The spec already says this is acceptable; the UI and README must make it feel intended, not broken.

### 3.2 Other risks

- **R1 — Search API terms.** Storing snippets as evidence, and how long, may depend on the Brave plan **(verify the current plans and storage rights)**. 40 calls per search is fine on a free/low tier for personal use, but will need a paid plan if searches are frequent.
- **R2 — Bing and Google alternatives are going away.** Bing Search APIs were retired in 2025, and Google's Custom Search JSON API is closed to new customers **(verify)**. If Brave fails, the remaining licensed options are limited. Keep the adapter interface clean so another one can be dropped in.
- **R3 — Windows + native modules.** Your device runs Windows. `better-sqlite3` ships prebuilt binaries for current Node LTS releases; on a brand-new Node major it may need Visual Studio Build Tools. I will pin the Node LTS version in `.nvmrc` / `engines` and document it.
- **R4 — Company → domain resolution** is error-prone (homonyms, groups with several brands, agencies reposting). A wrong domain silently turns a third-party page into a `VERIFIED` source. Mitigation: a domain is accepted only when the company name appears on that site's home or about page, and the resolution itself is stored as company evidence.
- **R5 — Staffing agencies and consultancies** dominate .NET postings in Wallonia. Many postings will resolve to an agency, not the employer. The spec's answer (keep the agency recruiter, flag `is_agency`) is good, but expect agency recruiters to be a large share of results.
- **R6 — Rule-based name extraction is brittle.** Without an LLM, people extraction relies on: schema.org `Person` JSON-LD, team-page card patterns (name + title siblings), the `Name – Title – Company` pattern in search titles, and ATS contact blocks. Expect misses on custom-designed team pages. This is the place where an optional LLM extractor (still substring-checked) would pay off most.
- **R7 — Name/title language mix.** Titles appear in FR, NL and EN (*Talent Acquisition Specialist*, *Chargée de recrutement*, *Recruteur IT*, *HR Business Partner*, *Responsable RH*, *Teamleider*, *Directeur technique*). `config/roles.yaml` must be multilingual from day one or tier matching will fail quietly.
- **R8 — `User-Agent` contact URL** is required. You need a URL (the repo page or a one-page site) before the first live run.

---

## 4. Decisions I am making on your behalf

Each will be recorded as an ADR in Phase 1. Tell me if you want any changed.

1. **D1 — Brave Search API only; SerpAPI dropped.** SerpAPI scrapes Google results, which is the thing §2.1 exists to avoid. `SERPAPI_KEY` is removed from `.env.example`. This is not a stack deviation (the adapter interface is unchanged), only a source choice.
2. **D2 — LOW contacts are kept but labelled as leads.** The table and export show them, with a "Lead — unconfirmed" badge, and the counter reads `9 confirmed + 6 leads / 20`. The target of 20 counts both, so the search does not run until the budget is gone chasing `MEDIUM` contacts. *(This is the one product decision I would most like you to confirm; see §6.)*
3. **D3 — Evidence enforcement in SQLite** (see §5.2): contacts are inserted as empty shells, fields are set by update, and a `BEFORE UPDATE` trigger rejects any non-null field without a matching evidence row. A repository-level assertion does the same in TypeScript.
4. **D4 — No LLM** in Phases 1–2 (A13).
5. **D5 — Belgium first.** `locations.yaml`, `synonyms.yaml` and `roles.yaml` ship with Belgian (FR/NL/EN) content. Other countries work with degraded query expansion.
6. **D6 — Job sources:** ATS public feeds and Le Forem / VDAB official data; no commercial job boards.
7. **D7 — Registry is a Phase 3 enrichment** for legal name and NACE sector, from the KBO open-data dump, not a people source.
8. **D8 — Playwright only in tests.** `ENABLE_HEADLESS` stays in config but no headless fetching is built unless a phase shows a real need.
9. **D9 — Node LTS pinned**, pnpm via Corepack, everything runnable on Windows without WSL.

---

## 5. What I think is wrong or incomplete in the spec

### 5.1 Corrections

1. **SerpAPI is described as "licensed access to the index".** It is not: it scrapes Google results pages for you. See D1.
2. **The scoring contradicts the LinkedIn rule.** A tier-1 recruiter seen only in a LinkedIn snippet scores 30 (tier) + 15 (in area) + 10 (profile URL from that same snippet) = **55**, well above 35. The spec calls this a weak lead but the score validates it. Options: (a) keep and label as leads (D2, my default); (b) require contact-level ≥ `MEDIUM` to be validated; (c) do not award the +10 channel bonus when the only channel comes from the same `LOW` source.
3. **The `/privacy` page does not satisfy GDPR Art. 14.** Art. 14 is about informing the *people whose data you hold*, and they never see your app. In practice the notice has to go in your first message to each contact (one or two sentences plus a link to `PRIVACY.md` hosted somewhere public), or you rely on the disproportionate-effort exception, which is weak for a handful of people you are about to email anyway. I will add a short outreach notice template to `PRIVACY.md`. Legitimate interest also needs a written balancing test; I will add `docs/LIA.md`. *(Not legal advice; worth a check if you ever share the tool with others, because then each user becomes a controller.)*
4. **"Contact-level confidence = lowest of `full_name`, `title` and `company`"** — but `company` is not a field on `Contact`; it is `company_id`. The link between person and company needs its own evidence (`field = 'company'`).
5. **"Enforce with a database constraint"** is not expressible as a SQLite `CHECK` (no cross-table checks, no commit-time triggers). It needs the trigger design in D3.

### 5.2 Schema gaps in §4.1

Things later sections rely on that have no column:

| Needed by | Missing | Proposed |
|---|---|---|
| §5.2 agencies | `Company.is_agency` | boolean |
| §8.1 export "Role Tier", §5.4 scoring | `Contact.role_tier`, `role_archetype` | int 1–5, text |
| §5.5 possible duplicates | status `possible_duplicate`, link to the other contact | `Contact.duplicate_of_id` + flag |
| §8.2 contradictions | `contradicted` flag | per field, in `Contact.field_flags` JSON |
| §8.1 "Job Posting URL" | link contact → job | `Contact.job_opportunity_id` (nullable) |
| §4.2 staleness | evidence publication date | `Evidence.published_at` |
| §5.6 budgets | `Search.budget_spent` is one number for four budgets | JSON `{http, searchApi, deepSearch, ms}` |
| §9.1 resume | interrupted state | status `interrupted`, resumed on boot |
| A11 | generic company mailbox | `Company.generic_email` (with evidence) |
| §5.4 sector match | position → field mapping | `field` key in `synonyms.yaml`, NACE → field map in config |

### 5.3 Smaller points

- The dedup scoring can never merge or flag two records whose normalised names differ (max 50 without a name match), so "J-M Dupont" and "Jean-Marc Dupont" stay separate. That is consistent with "conservative", just worth knowing.
- "Employer's sector matches the position's field" (+10) has no data source until the registry adapter exists, so Phase 2 scores will be up to 10 points lower than Phase 3 scores for the same person.
- `pnpm data:purge -- --all`: depending on the pnpm version, the `--` is passed through to the script. I will make the script accept both forms.
- The success criterion says "watch the engine work for a few minutes". With 1 request/second per host and the default budgets that is realistic; the 10-minute cap is the right ceiling.

---

## 6. Questions for you

Only the first one changes the product. For the rest, I will go with my default unless you say otherwise.

1. **Unconfirmed leads (D2).** Count `LOW` contacts toward the 20 and label them as leads *(my recommendation)*, or only count contacts confirmed by a second source?
2. **Drop SerpAPI (D1)?** Default: yes.
3. **Brave API key and a User-Agent contact URL.** Do you have a Brave Search API key, and what URL should identify the bot? Needed before Phase 2's first live run, not for Phase 1.
4. **Where should the code live?** A new GitHub repository, or a folder on your device.
