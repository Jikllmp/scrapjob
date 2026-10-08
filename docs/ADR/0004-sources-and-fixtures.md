# ADR 0004 — Phase 2 sources, confidence rules and test fixtures

Status: accepted (Phase 2)

## Sources

1. **web-search** discovers employers and job posts from Brave results. Job boards and aggregators (`config/hosts.yaml`)
   are never treated as employers, news sites are skipped, and staffing agencies are kept but flagged. An employer found
   only through an ATS host (Recruitee, Teamtailor…) gets no domain of its own, so its ATS page counts as employer
   evidence only when the subdomain or path slug matches its name.
2. **company-site** reads the employer's home page, then at most 4 linked pages ranked by how likely they are to name
   people (team, about, contact, careers). It reads visible text and JSON-LD `Person` and `JobPosting` data. It stores
   personal professional emails only when they appear next to the person; generic mailboxes (`info@`, `jobs@`) are not
   stored as contacts.
3. **linkedin-public** asks Brave for `site:linkedin.com/in "Employer"` and parses the result titles. It never opens
   linkedin.com, so what it finds is `LOW` confidence and becomes a lead unless another source confirms it.

Every outbound request goes through one HTTP client that sends an honest User-Agent with the contact URL, obeys
`robots.txt`, `X-Robots-Tag` and `noindex`, limits each host to `PER_HOST_RPS`, retries only timeouts and 5xx, and
counts against the search budget.

## Confidence

Confidence is computed per field from its evidence (spec §4.2), and a contact's confidence is its weakest of name, title
and employer. Evidence now records whether it came from a fetched page or a search snippet (`evidence.source_kind`,
migration `0002`), because a snippet can never be more than `LOW`.

## Fixtures are synthetic

The tests and `pnpm demo` replay files in `apps/api/test/fixtures`: fictional employers on the reserved `.test` domain,
shaped like real Brave responses and Belgian SME sites. Recording real pages would put real people's names into a public
repository, which the privacy position forbids. The cost is that the fixtures cannot catch layout quirks of real sites;
the first live searches are the check for that.
