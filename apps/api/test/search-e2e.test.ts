import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tables } from '@scrapjob/schema';
import type { ContactRowDto } from '@scrapjob/schema/api';
import type { BuiltApp } from '../src/app';
import { CONTACT_COLUMNS } from '../src/exports/workbook';
import { fixtureTransport } from './fixtures/transport';
import { testApp } from './helpers';

let built: BuiltApp;
afterEach(async () => built?.app.close());

const live = {
  ENABLED_SOURCES: 'web-search,company-site,linkedin-public',
  BRAVE_API_KEY: 'test-key',
  USER_AGENT_CONTACT_URL: 'https://example.org/scrapjob-bot',
};

async function runFixtureSearch(env: Record<string, string> = live) {
  const fixtures = fixtureTransport();
  built = testApp(env, { transport: fixtures.transport });
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
      message: '4 / 20 contacts (2 confirmed, 2 unconfirmed leads) — stopped: sources exhausted',
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
