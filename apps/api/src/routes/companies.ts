import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  buildDraft,
  dedupDecision,
  identityConfidence,
  isLead,
  linkedInPeopleSearchUrl,
  normaliseName,
  normaliseProfileUrl,
  planQueries,
  scoreDraft,
} from '@scrapjob/core';
import { tables, type Company, type ContactCandidate } from '@scrapjob/schema';
import { AddContactBody, AddContactResponse, SearchCompanyListDto, SearchIdParams, type SearchCompanyDto } from '@scrapjob/schema/api';
import type { AppContext } from '../context';
import { loadStoredContact } from '../contacts/draft';
import { HttpProblem, parseOr400 } from '../problem';

const { searches, companies } = tables;

/** The id of the adapter credited with contacts the user adds by hand. */
const MANUAL_ADAPTER = 'manual';

interface CompanyRow {
  id: string;
  contacts: number;
  has_posting: number;
}

export function registerCompanyRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, taxonomy, store } = ctx;

  const searchOr404 = (id: string) => {
    const row = db.select().from(searches).where(eq(searches.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Search not found', `No search with id ${id}.`);
    return row;
  };

  /** Employers this search discovered, in discovery order, plus any employer of its contacts. */
  const companyRows = (searchId: string): CompanyRow[] =>
    db.$client
      .prepare(
        `WITH seen AS (
           SELECT json_extract(metadata, '$.companyId') AS id, min(seq) AS seq
           FROM search_events
           WHERE search_id = ? AND type = 'COMPANY_DISCOVERED' AND json_extract(metadata, '$.companyId') IS NOT NULL
           GROUP BY 1
           UNION
           SELECT company_id, 1e12 FROM contacts WHERE search_id = ? AND company_id IS NOT NULL
         )
         SELECT c.id,
                (SELECT count(*) FROM contacts k WHERE k.search_id = ? AND k.company_id = c.id AND k.status = 'validated') AS contacts,
                EXISTS (SELECT 1 FROM job_opportunities j WHERE j.company_id = c.id) AS has_posting
         FROM companies c JOIN (SELECT id, min(seq) AS seq FROM seen GROUP BY id) s ON s.id = c.id
         ORDER BY s.seq`,
      )
      .all(searchId, searchId, searchId) as CompanyRow[];

  app.get('/api/searches/:id/companies', async (request) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    searchOr404(id);
    const items: SearchCompanyDto[] = companyRows(id).map((row) => {
      const company = db.select().from(companies).where(eq(companies.id, row.id)).get()!;
      return {
        id: company.id,
        name: company.name,
        website: company.website,
        city: company.city,
        industry: company.industry,
        isAgency: company.isAgency,
        hasPosting: row.has_posting === 1,
        contacts: row.contacts,
        linkedinSearchUrl: linkedInPeopleSearchUrl(company.name),
      };
    });
    return SearchCompanyListDto.parse({ items });
  });

  /**
   * Adds a person the user found on LinkedIn. The values are the user's own,
   * recorded as such (`user` evidence); the profile URL is stored, never opened.
   */
  app.post('/api/searches/:id/contacts', async (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const body = parseOr400(AddContactBody, request.body, 'request body');
    const search = searchOr404(id);
    if (search.status === 'queued' || search.status === 'running') {
      throw new HttpProblem(409, 'Search is still running', 'Add contacts once the search has finished.');
    }
    const row = companyRows(id).find((r) => r.id === body.companyId);
    if (!row) throw new HttpProblem(404, 'Company not found', 'This employer is not part of this search.');
    const company: Company = db.select().from(companies).where(eq(companies.id, row.id)).get()!;

    const profileUrl = normaliseProfileUrl(body.profileUrl)!;
    const fullName = body.fullName.replace(/\s+/g, ' ');
    const title = body.title.replace(/\s+/g, ' ');
    const snippet = `Added by you from ${profileUrl}: ${fullName} · ${title} · ${company.name}`.slice(0, 500);
    const ev = (field: ContactCandidate['evidence'][number]['field'], value: string) => ({
      field,
      value,
      sourceUrl: profileUrl,
      snippet,
      sourceKind: 'user' as const,
      retrievedAt: new Date().toISOString(),
    });
    const raw: ContactCandidate = {
      fullName,
      title,
      profileUrl,
      companyName: company.name,
      evidence: [ev('full_name', fullName), ev('title', title), ev('profile_url', profileUrl), ev('company', company.name)],
    };

    const sink = ctx.events.sinkFor(id);
    const built = buildDraft(raw, MANUAL_ADAPTER, company, taxonomy, sink);
    if (!built.ok) throw new HttpProblem(422, 'Contact not added', capitalise(built.reason) + '.');
    const draft = built.draft;
    if (store.isBlocked(normaliseName(fullName), company)) {
      throw new HttpProblem(409, 'Contact was erased', `${fullName} asked to be erased and cannot be added again.`);
    }
    const existing = (db.$client.prepare(`SELECT id FROM contacts WHERE search_id = ? AND status = 'validated'`).all(id) as { id: string }[])
      .map((r) => loadStoredContact(db, r.id, taxonomy)?.draft)
      .filter((d) => d !== undefined);
    const decision = dedupDecision(draft, existing);
    if (decision.kind === 'merge') {
      throw new HttpProblem(409, 'Already in this search', `${decision.with.fields.full_name ?? 'This person'} is already a contact of this search.`);
    }

    const scored = scoreDraft(
      draft,
      { company, hasPosting: row.has_posting === 1 },
      { plan: planQueries(search.location, search.position, taxonomy), taxonomy, now: new Date() },
    );
    // The user chose this person: kept whatever the relevance score.
    const contactId = store.insertContact(id, scored);
    if (decision.kind === 'flag') store.flagPossibleDuplicate(contactId, decision.with.id!);
    sink.emit('CONTACT_VALIDATED', 'info', `${fullName} — ${title}, ${company.name} (added by you, score ${scored.score.score})`, {
      contactId,
      score: scored.score.score,
      confidence: scored.confidence,
      lead: isLead(identityConfidence(draft, { taxonomy, now: new Date() })),
      adapter: MANUAL_ADAPTER,
    });
    return reply.status(201).send(AddContactResponse.parse({ contactId }));
  });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
