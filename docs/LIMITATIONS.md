# Limitations

What ScrapJob does not do, does badly, or has not been checked against the real web yet. Read this before judging a
result: `12 / 20 contacts` with twelve verifiable people is the tool working as intended.

## Which sources produce how much

**No live search has been run yet.** The build was done without a Brave API key, so every number below comes from the
synthetic fixtures in `apps/api/test/fixtures` (fictional employers on `.test` domains). They show that each source
works end to end, not how much it yields in Charleroi. The **Sources** page (`/sources`) counts, for your own
database, how many contacts each source contributed to; after a few real searches, replace this table with those
numbers.

| Source | What it gives | Contacts in the fixture search (5 in total) | Expected on the real web |
| --- | --- | --- | --- |
| `employer-list` | Employers you list in `config/employers.yaml` | 0 people by design (it names employers) | As good as your list. The only discovery source without a key. People you add from LinkedIn are `MEDIUM`. |
| `web-search` | Employers and job posts from Brave results | 0 people (it finds the 3 employers) | The backbone of discovery. Without it, only your employer list is searched. |
| `linkedin-public` | Names and titles from LinkedIn results in Brave, never from linkedin.com | 3 (2 of them only here, so `LOW` leads) | The largest people source, and almost all `LOW`. Most of your 20 will be leads from here. |
| `company-site` | Team, about, contact and careers pages, and ATS job pages | 2 (`VERIFIED`) | Few for medium and large employers, which rarely list recruiters. Small IT firms list founders and CTOs. |
| `press-events` | Press releases and conference speaker pages naming a person with their employer | 1 (`MEDIUM`) | Low volume, good quality. Depends on what Brave indexes for the employer. |
| `job-board` | Postings from Recruitee, Lever and Greenhouse public feeds | 0 people, 1 posting for the position | Only for employers using one of those three ATS. Raises scores (+20 for an open posting); rarely names a person. |
| `registry` | Legal name and NACE sector from the KBO/BCE open data | 0 people by design | Adds +10 to the score when the sector matches. Needs `pnpm registry:import`. |

Expect somewhere around 8 to 15 people for a city like Charleroi, with a minority confirmed. Reaching 20 confirmed
contacts will be rare.

## Sources that are not used, and why

- **Commercial job boards** (Indeed, StepStone, Jobat, LinkedIn Jobs): their terms or `robots.txt` forbid automated
  access, and none has a public search API.
- **Le Forem** open data (`odwb.be`): its `robots.txt` disallows `/api/` for every crawler except Googlebot (checked
  2026-10-10).
- **VDAB**: needs a signed API agreement.
- **LinkedIn pages**: never fetched. Only what Brave shows in its results is read, and what you add by hand from a
  people search you open yourself.
- **OpenStreetMap**: the public Overpass API's `robots.txt` disallows `/api/` for every crawler (checked 2026-10-11).
  Running your own Overpass instance or importing an extract would work but is not built.
- **Google and Bing**: Bing's search APIs were retired and Google's Custom Search API is closed to new customers. SerpAPI
  was dropped because it scrapes Google results.
- **Headless browsers**: none. Pages that need JavaScript to show their team list are read as empty.

## Known weaknesses

- **Extraction is rule-based.** People are found through schema.org `Person` data, team-card patterns (a name next to
  a title), `Name – Title – Company` in search titles, and contact blocks on job pages. Custom-designed team pages are
  missed.
- **Titles in other languages.** Role matching covers French, Dutch and English titles in `config/roles.yaml`. A title
  outside that list is rejected as "not a hiring role"; add it to the file.
- **Employer domain.** A domain is accepted only when the company name appears on that site. Groups with several brands
  and employers whose site uses another name are missed rather than guessed.
- **Agencies.** Staffing agencies and consultancies post many .NET jobs in Wallonia. Their recruiters are kept and the
  employer is flagged as an agency.
- **Duplicates across spellings.** Dedup compares normalised names, so "J-M Dupont" and "Jean-Marc Dupont" stay two rows.
  Dedup runs within one search; the same person found in two searches is two rows.
- **Generic mailboxes** (`jobs@`, `rh@`) are never stored as contacts. They are not stored on the employer either yet.
- **Business register columns.** The import checks the CSV headers of the KBO "Full" extract as documented. It has not
  been run on a real extract; if a column was renamed, it stops and names the file and column.
- **Brave terms.** How long search-result excerpts may be stored depends on the Brave plan. Check yours; the default
  retention of 180 days may need to be shorter.
- **Resume after a crash** reruns the search's queries from the start. Contacts already stored are kept, their
  employers are not asked again, and new sightings merge into them, but the search API calls are spent twice.
- **One search at a time.** Searches are queued and run one after another in the API process. Nothing runs while the API
  is stopped, including the daily retention check (it runs again at the next start).
- **Local use only.** The API listens on `127.0.0.1` with no login. Do not expose it to a network.
