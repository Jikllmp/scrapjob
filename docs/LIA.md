# Legitimate interest assessment

ScrapJob relies on legitimate interest (GDPR Art. 6(1)(f)) to process the professional data of people who did not ask
to be in it. This is the three-part test that basis requires, written for one person using the tool for their own job
search. *Not legal advice; redo it if the use changes, for example if the tool is shared or used for recruitment or
sales.*

## 1. Purpose: is there a legitimate interest?

**Yes.** The user is looking for a job and wants to write to the people who hire for it. Finding work is a lawful and
recognised interest, and approaching a company's recruiters or managers directly is ordinary professional practice.
The tool serves no other purpose: no marketing, no resale, no profiling beyond "is this person relevant to this job
search".

## 2. Necessity: is the processing needed for that purpose, and is there a less intrusive way?

The user needs a name, a role and an employer to write a relevant message. Applying only through job boards is the
less intrusive alternative, and the user still does that; direct contact is a complement, not a replacement.

What keeps the processing to the minimum:

- **Only professional identity** is collected (name, title, employer, work location, published work contact, public
  profile URL). Personal contact details and Art. 9 data are excluded by design, not filtered afterwards.
- **No guessing.** A work email is stored only if that exact string was published; most contacts have none, and that
  is the expected outcome.
- **Small volume.** A search stops at 20 people and within fixed request budgets.
- **Hiring-relevant roles only.** A person is kept only if their title matches a recruiting, HR, management or
  founder role, or they are named as the contact on a job posting.
- **Short retention.** Contacts are deleted after 180 days by default, automatically.

## 3. Balancing: do the person's interests override the user's?

| Factor | Assessment |
| --- | --- |
| Nature of the data | Professional data the person or their employer chose to publish, in a professional context. Low sensitivity. |
| Reasonable expectations | A recruiter or hiring manager whose role is on their employer's site, a job posting or a public profile can expect to be contacted about jobs. A speaker at a tech conference can expect to be approached by people in that field. |
| Impact | At most one unsolicited, relevant message. No decision is made about the person, nothing is published, and the data is not combined with other personal data. |
| Power balance | A job seeker writing to an employer's staff; no dependence or vulnerability on the contact's side. |
| Transparency | The first message carries a short notice saying where the data came from and how to have it deleted (template in `PRIVACY.md`). |
| Control | One reply is enough to have the data deleted. Erasure also blocklists the person so later searches skip them. |
| Safeguards | Robots.txt and rate limits honoured; no login pages, CAPTCHAs or LinkedIn pages; every value traceable to its source; contradicted values flagged rather than chosen. |

**Conclusion:** with the safeguards above, the user's interest is not overridden by the contacts' interests or rights,
and the processing can rely on legitimate interest. The conclusion depends on the tool staying a personal job-search
aid; mass outreach, sharing the data, or keeping it beyond the retention period would change it.

## Review

Review this assessment when a new source is added, when the kinds of data collected change, or when the tool is used
by anyone other than its owner.
