import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { foldText } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import {
  ContactDetailDto,
  ContactIdParams,
  ContactListDto,
  CreateDeepSearchResponse,
  CreateExportBody,
  CreateExportResponse,
  ListContactsQuery,
  SearchIdParams,
} from '@scrapjob/schema/api';
import type { AppContext } from '../context';
import { eraseContact } from '../contacts/erase';
import { loadContactRows } from '../contacts/rows';
import { buildWorkbook, exportFilename } from '../exports/workbook';
import { HttpProblem, parseOr400 } from '../problem';

const { searches, exports, contacts, evidence, deepSearches } = tables;

type EvidenceRow = typeof evidence.$inferSelect;

const evidenceDto = (e: EvidenceRow) => ({
  id: e.id,
  field: e.field,
  value: e.valueSeen,
  sourceAdapter: e.sourceAdapter,
  sourceUrl: e.sourceUrl,
  snippet: e.snippet,
  sourceKind: e.sourceKind,
  publishedAt: e.publishedAt,
  retrievedAt: e.retrievedAt,
});

export function registerContactRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, taxonomy } = ctx;

  const searchOr404 = (id: string) => {
    const row = db.select().from(searches).where(eq(searches.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Search not found', `No search with id ${id}.`);
    return row;
  };

  app.get('/api/searches/:id/contacts', async (request) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const query = parseOr400(ListContactsQuery, request.query, 'query string');
    searchOr404(id);
    let rows = loadContactRows(db, id, taxonomy);
    if (query.q) {
      const needle = foldText(query.q);
      rows = rows.filter((r) => foldText(`${r.fullName} ${r.title} ${r.company?.name ?? ''}`).includes(needle));
    }
    return ContactListDto.parse({
      items: rows.slice(query.offset, query.offset + query.limit),
      total: rows.length,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.post('/api/searches/:id/export', async (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const body = parseOr400(CreateExportBody, request.body ?? {}, 'request body');
    const search = searchOr404(id);
    ctx.events.append(id, 'EXPORT_STARTED', 'info', body.contactIds ? `Exporting ${body.contactIds.length} selected contacts` : 'Exporting all contacts');

    // Built from the database, never from what the browser shows; a selection is an explicit list of ids.
    const rows = loadContactRows(db, id, taxonomy, body.contactIds);
    const now = new Date();
    const filename = exportFilename(search.location, search.position, now);
    const exportId = randomUUID();
    mkdirSync(ctx.exportDir, { recursive: true });
    const path = join(ctx.exportDir, `${exportId}.xlsx`);
    await buildWorkbook({
      location: search.location,
      position: search.position,
      rows,
      retentionDays: ctx.config.DATA_RETENTION_DAYS,
      generatedAt: now,
    }).xlsx.writeFile(path);
    db.insert(exports).values({ id: exportId, searchId: id, filename, path, rowCount: rows.length }).run();
    ctx.events.append(id, 'EXPORT_COMPLETED', 'info', `${filename}: ${rows.length} contacts`, { exportId, rowCount: rows.length });
    return reply.status(201).send(CreateExportResponse.parse({ exportId, filename, rowCount: rows.length }));
  });

  app.get('/api/contacts/:id', async (request) => {
    const { id } = parseOr400(ContactIdParams, request.params, 'path');
    const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
    const [row] = contact && contact.status === 'validated' ? loadContactRows(db, contact.searchId, taxonomy, [id]) : [];
    if (!contact || !row) throw new HttpProblem(404, 'Contact not found', `No contact with id ${id}.`);
    const search = searchOr404(contact.searchId);
    const evidenceRows = db.select().from(evidence).where(eq(evidence.contactId, id)).orderBy(evidence.field, evidence.retrievedAt).all();
    const companyEvidence = contact.companyId
      ? db.select().from(evidence).where(eq(evidence.companyId, contact.companyId)).orderBy(evidence.field, evidence.retrievedAt).all()
      : [];
    const runs = db.select().from(deepSearches).where(eq(deepSearches.contactId, id)).orderBy(desc(deepSearches.createdAt)).all();
    return ContactDetailDto.parse({
      ...row,
      search: { id: search.id, location: search.location, position: search.position },
      fieldFlags: contact.fieldFlags,
      evidence: evidenceRows.map(evidenceDto),
      companyEvidence: companyEvidence.map(evidenceDto),
      deepSearches: runs.map((d) => ({
        id: d.id,
        status: d.status,
        message: d.message,
        requestsSpent: d.requestsSpent,
        createdAt: d.createdAt,
        startedAt: d.startedAt,
        finishedAt: d.finishedAt,
        before: d.fieldsBefore ?? null,
        after: d.fieldsAfter ?? null,
        changes: d.changes,
      })),
    });
  });

  app.delete('/api/contacts/:id', async (request, reply) => {
    const { id } = parseOr400(ContactIdParams, request.params, 'path');
    const result = eraseContact(db, id);
    if (!result.erased) throw new HttpProblem(404, 'Contact not found', `No contact with id ${id}.`);
    request.log.info({ contactId: id, exportsDeleted: result.exportsDeleted }, 'contact erased and blocklisted');
    return reply.status(204).send();
  });

  app.post('/api/contacts/:id/deep-search', async (request, reply) => {
    const { id } = parseOr400(ContactIdParams, request.params, 'path');
    const started = ctx.deepSearch.start(id);
    if (!started.ok) {
      if (started.reason === 'not_found') throw new HttpProblem(404, 'Contact not found', `No contact with id ${id}.`);
      if (started.reason === 'search_running') {
        throw new HttpProblem(409, 'Search still running', 'Wait for the search to finish before deep-searching its contacts.');
      }
      throw new HttpProblem(409, 'Deep search already running', 'This contact already has a deep search in progress.');
    }
    return reply.status(202).send(CreateDeepSearchResponse.parse({ deepSearchId: started.deepSearchId }));
  });

  app.get('/api/exports/:id/download', async (request, reply) => {
    const { id } = parseOr400(SearchIdParams, request.params, 'path');
    const row = db.select().from(exports).where(eq(exports.id, id)).get();
    if (!row) throw new HttpProblem(404, 'Export not found', `No export with id ${id}.`);
    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${row.filename}"`)
      .send(createReadStream(row.path));
  });
}
