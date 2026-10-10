import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tables } from '@scrapjob/schema';
import type { ContactDetailDto, ContactRowDto, SourceDto } from '@scrapjob/schema/api';
import type { BuiltApp } from '../src/app';
import { CONTACT_COLUMNS } from '../src/exports/workbook';
import { importRegistry } from '../src/registry/import';
import { runPurgeCommand } from '../src/privacy/purge-cli';
import { fixtureTransport } from './fixtures/transport';
import { testApp } from './helpers';

let built: BuiltApp;
afterEach(async () => built?.app.close());

const live = {
  ENABLED_SOURCES: 'web-search,registry,job-board,company-site,linkedin-public,press-events',
  BRAVE_API_KEY: 'test-key',
  USER_AGENT_CONTACT_URL: 'https://example.org/scrapjob-bot',
};

async function runFixtureSearch(env: Record<string, string> = live, beforeSearch?: (b: BuiltApp) => Promise<unknown>) {
  const fixtures = fixtureTransport();
  built = testApp(env, { transport: fixtures.transport });
  await beforeSearch?.(built);
  const res = await built.app.inject({
    method: 'POST',
    url: '/api/searches',
    payload: { location: 'Charleroi', position: 'Développeur .NET' },
  });
  const { searchId } = res.json() as { searchId: string };
  await built.ctx.runner.idle();
  const search = (await built.app.inject({ url: `/api/searches/${searchId}` })).json();
  const contacts = (await built.app.inject({ url: `/api/searches/${searchId}/contacts` })).json().items as ContactRowDto[];
  return { searchId, search, contacts, fixtures };
}

describe('a full search on recorded fixtures', () => {
  it('finds the evidenced people and only them', async () => {
    const { search, contacts } = await runFixtureSearch();
    expect(search.status).toBe('completed');
    expect(
      contacts.map((c) => [c.fullName, c.title, c.company?.name, c.confidence, c.lead, c.relevanceScore]),
    ).toEqual([
      ['Marie Dupont', 'Talent Acquisition Manager', 'Acme Software', 'VERIFIED', false, 90],
      ['Anne Petit', null, 'Globex IT', 'UNKNOWN', false, 45],
      ['Hugo Lambert', 'HR Business Partner', 'Initech', 'LOW', true, 45],
      ['Paul Martin', 'Engineering Manager', 'Acme Software', 'LOW', true, 70],
      ['Sophie Leroy', 'CTO', 'Initech', 'MEDIUM', false, 35],
    ].sort((a, b) => (b[5] as number) - (a[5] as number)));
  });

  it('merges the LinkedIn sighting of a person into their team-page entry', async () => {
    const { contacts } = await runFixtureSearch();
    const marie = contacts.find((c) => c.fullName === 'Marie Dupont')!;
    expect(marie.sources.sort()).toEqual(['company-site', 'linkedin-public']);
    expect([marie.firstName, marie.lastName]).toEqual(['Marie', 'Dupont']);
    expect(marie.profileUrl).toBe('https://be.linkedin.com/in/marie-dupont-acme');
    expect(marie.email).toBe('marie.dupont@acme-software.test');
    expect(marie.fieldConfidence.email).toBe('VERIFIED');
    expect(marie.jobPostingUrl).toBe('https://www.acme-software.test/carrieres/developpeur-net');
  });

  it('stores evidence for every populated field', async () => {
    const { searchId } = await runFixtureSearch();
    const rows = built.ctx.db.select().from(tables.contacts).where(eq(tables.contacts.searchId, searchId)).all();
    const columns: [keyof (typeof rows)[number], string][] = [
      ['fullName', 'full_name'],
      ['title', 'title'],
      ['email', 'email'],
      ['profileUrl', 'profile_url'],
      ['city', 'city'],
      ['companyId', 'company'],
    ];
    for (const row of rows) {
      const ev = built.ctx.db.select().from(tables.evidence).where(eq(tables.evidence.contactId, row.id)).all();
      for (const [column, field] of columns) {
        if (row[column] !== null) expect(ev.some((e) => e.field === field), `${row.fullName}.${field}`).toBe(true);
      }
      for (const e of ev) expect(e.snippet.toLowerCase()).toContain(e.valueSeen.toLowerCase());
    }
  });

  it('logs real rejections: wrong role, wrong employer, robots', async () => {
    const { searchId } = await runFixtureSearch();
    const log = built.ctx.events.listAfter(searchId);
    const messages = log.map((e) => `${e.type} ${e.message}`);
    expect(messages).toContain('CONTACT_REJECTED linkedin-public: "Comptable" is not a hiring-relevant role');
    expect(messages.some((m) => m.startsWith('ROBOTS_DISALLOWED') && m.includes('initech.test'))).toBe(true);
    expect(log.filter((e) => e.type === 'DUPLICATE_MERGED').length).toBeGreaterThan(0);
    expect(log.at(-1)).toMatchObject({
      type: 'SEARCH_COMPLETED',
      message: '5 / 20 contacts (3 confirmed, 2 unconfirmed leads) — stopped: sources exhausted',
    });
  });

  it('still completes with a partial result when employer sites cannot be crawled', async () => {
    const { search, contacts } = await runFixtureSearch({ ...live, USER_AGENT_CONTACT_URL: '' });
    expect(search.status).toBe('completed');
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((c) => c.sources.join() === 'linkedin-public')).toBe(true);
  });

  it('fails fast with a clear message when web search is not configured', async () => {
    const { search } = await runFixtureSearch({ ...live, BRAVE_API_KEY: '' });
    expect(search).toMatchObject({ status: 'failed', error: '0 / 20 contacts — stopped: no company discovery source is available' });
  });

  it('filters contacts by text', async () => {
    const { searchId } = await runFixtureSearch();
    const res = (await built.app.inject({ url: `/api/searches/${searchId}/contacts?q=globex` })).json();
    expect(res.items.map((c: ContactRowDto) => c.fullName)).toEqual(['Anne Petit']);
  });
});

describe('resume after a restart', () => {
  it('keeps the contacts already found instead of storing them twice', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    built.ctx.db.update(tables.searches).set({ status: 'running' }).where(eq(tables.searches.id, searchId)).run();

    expect(built.ctx.runner.resumeInterrupted()).toBe(1);
    await built.ctx.runner.idle();

    const after = (await built.app.inject({ url: `/api/searches/${searchId}/contacts` })).json().items as ContactRowDto[];
    expect(after.map((c) => c.id).sort()).toEqual(contacts.map((c) => c.id).sort());
    const search = (await built.app.inject({ url: `/api/searches/${searchId}` })).json();
    expect(search.status).toBe('completed');
    const types = built.ctx.events.listAfter(searchId).map((e) => e.type);
    expect(types.filter((t) => t === 'CONTACT_VALIDATED')).toHaveLength(contacts.length);
    expect(types.filter((t) => t === 'SEARCH_COMPLETED')).toHaveLength(2);
  });
});

describe('spreadsheet export', () => {
  async function exportAndOpen(body?: object) {
    const { searchId, contacts } = await runFixtureSearch();
    const created = await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/export`, payload: body ?? {} });
    expect(created.statusCode).toBe(201);
    const { exportId, filename, rowCount } = created.json();
    const download = await built.app.inject({ url: `/api/exports/${exportId}/download` });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toBe(`attachment; filename="${filename}"`);
    const wb = new ExcelJS.Workbook();
    // ExcelJS's typings predate Node's generic Buffer; the runtime accepts it as is.
    await wb.xlsx.load(download.rawPayload as unknown as ArrayBuffer);
    return { wb, filename, rowCount, contacts };
  }

  it('round-trips: README first, one row per person, columns in order', async () => {
    const { wb, filename, rowCount, contacts } = await exportAndOpen();
    expect(filename).toMatch(/^contacts_charleroi_developpeur-net_\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['README', 'Contacts']);
    const sheet = wb.getWorksheet('Contacts')!;
    expect(sheet.getRow(1).values).toEqual([undefined, ...CONTACT_COLUMNS]);
    expect(rowCount).toBe(contacts.length);
    expect(sheet.rowCount).toBe(contacts.length + 1);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBeDefined();
  });

  it('keeps accents, writes real hyperlinks, and leaves unknown values empty', async () => {
    const { wb } = await exportAndOpen();
    const sheet = wb.getWorksheet('Contacts')!;
    const col = (name: (typeof CONTACT_COLUMNS)[number]) => CONTACT_COLUMNS.indexOf(name) + 1;
    const rows = [2, 3, 4, 5].map((r) => sheet.getRow(r));
    const marie = rows.find((r) => r.getCell(col('Full Name')).value === 'Marie Dupont')!;
    expect(marie.getCell(col('Profile URL')).value).toEqual({
      text: 'be.linkedin.com/in/marie-dupont-acme',
      hyperlink: 'https://be.linkedin.com/in/marie-dupont-acme',
    });
    expect(marie.getCell(col('Email Confidence')).value).toBe('VERIFIED');
    const anne = rows.find((r) => r.getCell(col('Full Name')).value === 'Anne Petit')!;
    expect(anne.getCell(col('Title')).value).toBeNull();
    expect(anne.getCell(col('Email')).value).toBeNull();
    const paul = rows.find((r) => r.getCell(col('Full Name')).value === 'Paul Martin')!;
    expect(String(paul.getCell(col('Notes')).value)).toContain('Unconfirmed lead');
    const readme = wb.getWorksheet('README')!;
    expect(String(readme.getRow(2).getCell(1).value)).toContain('"Développeur .NET" in Charleroi');
  });

  it('exports only an explicit selection when one is given', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    const pick = contacts.slice(0, 2).map((c) => c.id);
    const res = await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/export`, payload: { contactIds: pick } });
    expect(res.json().rowCount).toBe(2);
  });
});

describe('Phase 3 sources', () => {
  const kbo = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/kbo');

  it('names a conference speaker only with the employer on their own card', async () => {
    const { contacts, searchId } = await runFixtureSearch();
    const sophie = contacts.find((c) => c.fullName === 'Sophie Leroy')!;
    expect(sophie.sources).toEqual(['press-events']);
    expect(sophie.primarySourceUrl).toBe('https://www.devday-charleroi.test/speakers');
    // Nadia Benali is on the same page but works at Globex IT; Thomas Petit is not in a hiring role.
    expect(contacts.map((c) => c.fullName)).not.toContain('Nadia Benali');
    expect(contacts.map((c) => c.fullName)).not.toContain('Thomas Petit');
    const log = built.ctx.events.listAfter(searchId).map((e) => e.message);
    expect(log).toContain('2 results, 1 people representing Initech');
  });

  it('reads the employer job feed and stores postings for the position only', async () => {
    const { searchId } = await runFixtureSearch();
    const jobs = built.ctx.db.select().from(tables.jobOpportunities).all();
    expect(jobs.map((j) => j.url).sort()).toEqual([
      'https://globex-it.recruitee.com/o/developpeur-net',
      'https://globex-it.recruitee.com/o/senior-net-developer',
      'https://www.acme-software.test/carrieres/developpeur-net',
      'https://www.randstad.be/fr/emplois/developpeur-net-charleroi/',
    ]);
    const events = built.ctx.events.listAfter(searchId).filter((e) => e.type === 'JOB_DISCOVERED' && e.metadata.adapter === 'job-board');
    expect(events.map((e) => e.message)).toEqual(['Senior .NET Developer — Globex IT']);
  });

  it('imports the business register and scores the employer sector from it', async () => {
    const imported = await runFixtureSearch(live, (b) => importRegistry(b.ctx.db, kbo));
    const acme = imported.contacts.find((c) => c.fullName === 'Marie Dupont')!;
    expect(acme.company?.industry).toBe('Programmation informatique');
    expect(acme.relevanceReasons).toContain("+10 employer's sector matches the position");
    // Two enterprises are called Initech; the one registered in Charleroi is chosen.
    const initech = built.ctx.db.select().from(tables.companies).where(eq(tables.companies.name, 'Initech')).get();
    expect(initech).toMatchObject({ registryId: '0999.000.202', naceCode: '62.020', industry: 'Conseil informatique' });
    const ev = built.ctx.db.select().from(tables.evidence).where(eq(tables.evidence.companyId, initech!.id)).all();
    expect(ev.find((e) => e.field === 'registry_id')).toMatchObject({
      sourceKind: 'dataset',
      sourceUrl: 'https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=0999000202',
    });
  });

  it('reports each source with its availability, yield and last-search health', async () => {
    await runFixtureSearch();
    const { items } = (await built.app.inject({ url: '/api/sources' })).json() as { items: SourceDto[] };
    const byId = Object.fromEntries(items.map((s) => [s.id, s]));
    expect(byId['company-site']).toMatchObject({ enabled: true, available: true, contacts: 2 });
    expect(byId['linkedin-public']).toMatchObject({ contacts: 3 });
    expect(byId['press-events']).toMatchObject({ contacts: 1 });
    expect(byId.registry).toMatchObject({
      available: false,
      unavailableReason: 'the business register is not imported yet (pnpm registry:import -- <folder>)',
    });
    expect(byId.noop).toMatchObject({ enabled: false });
  });
});

describe('deep search', () => {
  async function deepSearch(fullName: string) {
    const { contacts } = await runFixtureSearch();
    const contact = contacts.find((c) => c.fullName === fullName)!;
    const started = await built.app.inject({ method: 'POST', url: `/api/contacts/${contact.id}/deep-search` });
    expect(started.statusCode).toBe(202);
    await built.ctx.deepSearch.idle();
    const detail = (await built.app.inject({ url: `/api/contacts/${contact.id}` })).json() as ContactDetailDto;
    return { contact, detail };
  }

  it('confirms an unconfirmed lead from a press article and records before and after', async () => {
    const { contact, detail } = await deepSearch('Paul Martin');
    expect(contact).toMatchObject({ lead: true, confidence: 'LOW' });
    expect(detail.lead).toBe(false);
    expect(detail.fieldConfidence).toMatchObject({ full_name: 'HIGH', company: 'HIGH' });
    const [run] = detail.deepSearches;
    expect(run).toMatchObject({ status: 'completed' });
    expect(run!.before).toMatchObject({ lead: true, confidence: 'LOW' });
    expect(run!.after).toMatchObject({ lead: false });
    expect(run!.changes.map((c) => [c.field, c.kind, c.confidenceBefore, c.confidenceAfter])).toEqual([
      ['full_name', 'corroborated', 'LOW', 'HIGH'],
      ['company', 'corroborated', 'LOW', 'HIGH'],
    ]);
    expect(detail.evidence.some((e) => e.sourceUrl === 'https://www.charleroi-tech.test/2026/acme-ouvre-gosselies')).toBe(true);
    // Still one row: a deep search never creates a second contact.
    const rows = (await built.app.inject({ url: `/api/searches/${detail.search.id}/contacts` })).json().items as ContactRowDto[];
    expect(rows.filter((r) => r.fullName === 'Paul Martin')).toHaveLength(1);
  });

  it('flags a contradicted title instead of picking a winner', async () => {
    const { detail } = await deepSearch('Hugo Lambert');
    expect(detail.title).toBe('HR Business Partner');
    expect(detail.fieldFlags.title).toEqual(['contradicted']);
    expect(detail.contradicted).toEqual(['title']);
    expect(detail.fieldConfidence.title).toBe('UNKNOWN');
    expect(detail.evidence.filter((e) => e.field === 'title').map((e) => e.value).sort()).toEqual(['Directeur commercial', 'HR Business Partner']);
    expect(detail.deepSearches[0]!.changes).toEqual([
      expect.objectContaining({ field: 'full_name', kind: 'corroborated', confidenceAfter: 'HIGH' }),
      expect.objectContaining({ field: 'company', kind: 'corroborated', confidenceAfter: 'HIGH' }),
      expect.objectContaining({ field: 'title', kind: 'contradicted', before: 'HR Business Partner', confidenceAfter: 'UNKNOWN' }),
    ]);
  });

  it('streams its events on the search stream, tagged with the deep search', async () => {
    const { detail } = await deepSearch('Paul Martin');
    const events = built.ctx.events.listAfter(detail.search.id).filter((e) => e.metadata.deepSearchId === detail.deepSearches[0]!.id);
    expect(events[0]?.type).toBe('ENRICHMENT_STARTED');
    expect(events.at(-1)).toMatchObject({ type: 'ENRICHMENT_COMPLETED' });
    expect(events.at(-1)!.message).toMatch(/^Deep search: Paul Martin: 0 fields added, 0 updated, 2 corroborated, 0 contradicted, posting found \(\d+ requests\)$/);
  });

  it('answers 404 for an unknown contact and 409 while its search is still running', async () => {
    built = testApp({});
    expect((await built.app.inject({ method: 'POST', url: '/api/contacts/nope/deep-search' })).statusCode).toBe(404);
    expect((await built.app.inject({ url: '/api/contacts/nope' })).statusCode).toBe(404);
    built.ctx.db.insert(tables.searches).values({ id: 'busy', location: 'Namur', position: 'Dev', status: 'running' }).run();
    built.ctx.db.insert(tables.contacts).values({ id: 'c1', searchId: 'busy', status: 'validated' }).run();
    const busy = await built.app.inject({ method: 'POST', url: '/api/contacts/c1/deep-search' });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().title).toBe('Search still running');
  });
});

describe('erasure', () => {
  it('deletes the contact, its evidence and exports, and keeps them out of later searches', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    const marie = contacts.find((c) => c.fullName === 'Marie Dupont')!;
    const exported = (await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/export`, payload: {} })).json();
    const file = built.ctx.db.select().from(tables.exports).where(eq(tables.exports.id, exported.exportId)).get()!.path;
    expect(existsSync(file)).toBe(true);

    expect((await built.app.inject({ method: 'DELETE', url: `/api/contacts/${marie.id}` })).statusCode).toBe(204);
    expect((await built.app.inject({ url: `/api/contacts/${marie.id}` })).statusCode).toBe(404);
    expect(built.ctx.db.select().from(tables.evidence).where(eq(tables.evidence.contactId, marie.id)).all()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect((await built.app.inject({ url: `/api/exports/${exported.exportId}/download` })).statusCode).toBe(404);
    expect(built.ctx.db.select().from(tables.blocklist).all()).toEqual([
      expect.objectContaining({ normalisedName: 'dupont marie', companyDomain: 'acme-software.test' }),
    ]);

    const again = await built.app.inject({
      method: 'POST',
      url: '/api/searches',
      payload: { location: 'Charleroi', position: 'Développeur .NET' },
    });
    await built.ctx.runner.idle();
    const second = again.json().searchId as string;
    const names = ((await built.app.inject({ url: `/api/searches/${second}/contacts` })).json().items as ContactRowDto[]).map((c) => c.fullName);
    expect(names).not.toContain('Marie Dupont');
    expect(built.ctx.events.listAfter(second).map((e) => e.message)).toContain('Marie Dupont is on the erasure blocklist');
  });
});

describe('retention and purge', () => {
  async function exportFile(searchId: string) {
    const { exportId } = (await built.app.inject({ method: 'POST', url: `/api/searches/${searchId}/export`, payload: {} })).json();
    return built.ctx.db.select().from(tables.exports).where(eq(tables.exports.id, exportId)).get()!.path;
  }

  function purge(...argv: string[]) {
    const lines: string[] = [];
    const code = runPurgeCommand(argv, { db: built.ctx.db, exportDir: built.ctx.exportDir, retentionDays: 180, out: (l) => lines.push(l) });
    return { code, output: lines.join('\n') };
  }

  it('deletes contacts collected more than DATA_RETENTION_DAYS ago, with their search spreadsheets', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    const file = await exportFile(searchId);
    const old = contacts.find((c) => c.fullName === 'Paul Martin')!;
    built.ctx.db.update(tables.contacts).set({ collectedAt: '2020-01-01T00:00:00.000Z' }).where(eq(tables.contacts.id, old.id)).run();

    expect(built.ctx.retention.runOnce()).toBe(1);

    const left = (await built.app.inject({ url: `/api/searches/${searchId}/contacts` })).json().items as ContactRowDto[];
    expect(left.map((c) => c.id).sort()).toEqual(contacts.filter((c) => c.id !== old.id).map((c) => c.id).sort());
    expect(built.ctx.db.select().from(tables.evidence).where(eq(tables.evidence.contactId, old.id)).all()).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(built.ctx.db.select().from(tables.blocklist).all()).toEqual([]);
    expect(built.ctx.retention.runOnce()).toBe(0);
  });

  it('purges one search with --search <id>, in both argument forms', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    const file = await exportFile(searchId);
    expect(purge('--', '--search', searchId)).toEqual({
      code: 0,
      output: `Deleted search ${searchId}: ${contacts.length} contacts, 1 spreadsheets.`,
    });
    expect(existsSync(file)).toBe(false);
    expect((await built.app.inject({ url: `/api/searches/${searchId}` })).statusCode).toBe(404);
    expect(built.ctx.db.select().from(tables.contacts).all()).toEqual([]);
    expect(built.ctx.db.select().from(tables.evidence).all().filter((e) => e.contactId !== null)).toEqual([]);
    expect(purge(`--search=${searchId}`)).toEqual({ code: 1, output: `No search with id ${searchId}.` });
  });

  it('empties the database with --all, keeps the blocklist, and the app still runs', async () => {
    const { searchId, contacts } = await runFixtureSearch();
    const file = await exportFile(searchId);
    await built.app.inject({ method: 'DELETE', url: `/api/contacts/${contacts[0]!.id}` });

    const { code, output } = purge('--all');
    expect(code).toBe(0);
    expect(output).toMatch(/^Deleted 1 searches, \d+ contacts and \d+ spreadsheets\. Kept the erasure blocklist \(1 entries\)/);
    expect(existsSync(file)).toBe(false);
    for (const table of [tables.searches, tables.contacts, tables.evidence, tables.companies, tables.jobOpportunities, tables.searchEvents]) {
      expect(built.ctx.db.select().from(table).all()).toEqual([]);
    }
    expect(built.ctx.db.select().from(tables.blocklist).all()).toHaveLength(1);
    expect((await built.app.inject({ url: '/api/searches' })).json()).toMatchObject({ total: 0, items: [] });

    const again = await built.app.inject({ method: 'POST', url: '/api/searches', payload: { location: 'Charleroi', position: 'Développeur .NET' } });
    expect(again.statusCode).toBe(201);
    await built.ctx.runner.idle();
    const rows = (await built.app.inject({ url: `/api/searches/${again.json().searchId}/contacts` })).json().items as ContactRowDto[];
    expect(rows.map((c) => c.fullName)).not.toContain(contacts[0]!.fullName);
    expect(rows).toHaveLength(contacts.length - 1);
  });

  it('prints the usage and exits 2 on bad arguments', () => {
    built = testApp();
    for (const argv of [[], ['--search'], ['--everything'], ['--all', '--search', 'x']]) {
      const { code, output } = purge(...argv);
      expect(code).toBe(2);
      expect(output).toMatch(/^Usage:/);
    }
  });
});
