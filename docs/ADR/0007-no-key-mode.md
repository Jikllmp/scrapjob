# ADR 0007 — Searching without an API key

Status: accepted

## Context

Without `BRAVE_API_KEY` no employer was ever found, so the app did nothing. The user wants a version that works now
and a 2.0 with the key later. The hard rules still hold: LinkedIn is never fetched, `robots.txt` is respected, and
every value has evidence.

## Decisions

1. **OpenStreetMap is not used.** The public Overpass API's `robots.txt` disallows `/api/` for every user agent
   (checked 2026-10-11), and its usage policy asks applications to run their own instance. Running one, or importing
   a Geofabrik extract, is possible later but heavy for a first version.
2. **A hand-kept employer list is the no-key discovery source.** `config/employers.yaml` names employers with their
   website, commune and optional fields. The `employer-list` adapter yields those inside the searched area (sections
   included, from `locations.yaml`) and in the position's field. It makes no request. The employer's own site, job
   feed and the other sources then work as before, so `company-site` and `job-board` still find people without a key
   when `USER_AGENT_CONTACT_URL` is set. It is first in the adapter list, so the user's list comes before Brave results
   once a key exists.
3. **LinkedIn is searched by the user, not by the app.** Each employer of a search gets a "Search on LinkedIn" link to
   a LinkedIn people search (`/search/results/people/?keywords="<employer>" (recruiter OR … )`). It opens in the
   user's own browser and account; the app never requests linkedin.com, and the HTTP client still refuses it.
4. **A person found there is added by hand.** `POST /api/searches/:id/contacts` takes a LinkedIn profile URL
   (`/in/…` only), a name, a title and one of the search's employers. The values are stored with evidence of a new
   kind, `user`, whose snippet says "Added by you from <url>". The URL is normalised and stored, never opened. The
   usual rules apply: the title must be a hiring-relevant role, a person on the erasure blocklist is refused, and a
   person already in the search (same profile URL or name) is refused as a duplicate. The relevance threshold does not
   apply: the user chose this person. Adding is refused while the search runs, so the orchestrator's in-memory list
   stays right.
5. **`user` evidence is MEDIUM.** One source, but a person read it. It sits under two independent sources (HIGH) and
   the employer's own site (VERIFIED), so a contact added by hand is a confirmed contact, not a lead, and a later deep
   search can still raise it. No migration was needed: `source_kind` has no check constraint in SQLite.
6. **The employers of a search** are listed by `GET /api/searches/:id/companies`, from its `COMPANY_DISCOVERED`
   events plus the employers of its contacts. No table was added. A search purged by retention or erased loses this
   list with its events, which is the intended lifecycle.
