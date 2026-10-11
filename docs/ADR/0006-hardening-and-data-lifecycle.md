# ADR 0006 — Phase 4: hardening and data lifecycle

Status: accepted (Phase 4)

## Context

Phase 4 of the spec asks for circuit breakers, resumable searches, retention, a purge command and the privacy
documents. A few of those had choices the spec leaves open.

## Decisions

1. **Circuit breaker per host and per search.** The HTTP client counts consecutive failed requests (5xx after
   retries, timeouts, network errors, 429/403) per host. At 5 it emits a `WARNING` with `circuitBreaker: "open"` and
   refuses that host for the rest of the search. The state is keyed by the search's budget object in a `WeakMap`, so
   the next search starts closed and nothing leaks. A success resets the count. This sits below the per-source
   `SOURCE_FAILURE_THRESHOLD`, which still disables a whole adapter.
2. **A disabled source no longer hides the others.** The orchestrator stopped asking the remaining enrichers, job and
   people sources for an employer as soon as it met a disabled one. Found while writing the failure-path test; it now
   skips only the disabled source.
3. **Resume keeps what was found.** A search interrupted by a restart is run again from the start (the orchestrator
   has no resumable cursor), but the contacts already stored are loaded first. They count toward the target and new
   sightings of the same people merge into them, so no row is duplicated and no `CONTACT_VALIDATED` is sent twice.
   The cost is that requests are spent again.
4. **robots.txt is cached for 24 hours** (RFC 9309), not for the life of the process.
5. **Retention deletes contacts, not searches.** The daily job deletes contacts older than `DATA_RETENTION_DAYS` with
   their evidence and deep searches, and the spreadsheets of their searches. It does not blocklist anyone: expiry is
   housekeeping, not an objection. The search rows stay as history.
6. **`data:purge -- --all` keeps the blocklist and the business register.** Deleting the blocklist would let erased
   people come back; the register holds only company data. Everything else (searches, contacts, evidence, events,
   employers, postings, spreadsheets) goes. The command accepts `--search <id>`, `--search=<id>`, `--all` and
   `--expired`, with or without the `--` that pnpm and npm pass through.
7. **Playwright for one end-to-end run**, as the spec asks, against the demo server on fixtures. It is a dev
   dependency only; no source uses a headless browser.
8. **Review fixes.** A full review before release found and fixed, among others: the export module was never
   committed (the `exports/` ignore rule matched `apps/api/src/exports`); redirects were followed by the transport
   without a robots.txt check on each hop, so the HTTP client now follows them itself and refuses LinkedIn hosts at
   every hop; personal addresses on team pages were kept; erased and expired people stayed named in the event log,
   which is now blanked; shutdown recorded running searches as cancelled; and the Cancel button used the DELETE route,
   so a late click could delete a finished search. Cancel now has its own route, `POST /api/searches/:id/cancel`.
