import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { foldText } from '@scrapjob/core';
import { tables } from '@scrapjob/schema';
import {
  ContactListDto,
  CreateExportBody,
  CreateExportResponse,
  ListContactsQuery,
  SearchIdParams,
} from '@scrapjob/schema/api';
import type { AppContext } from '../context';
import { loadContactRows } from '../contacts/rows';
import { buildWorkbook, exportFilename } from '../exports/workbook';
import { HttpProblem, parseOr400 } from '../problem';

const { searches, exports } = tables;

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
