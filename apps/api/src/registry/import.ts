import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { normaliseCompanyName } from '@scrapjob/core';
import type { Db } from '../db/client';

/** Splits one line of the KBO/BCE open-data CSV (comma-separated, double-quoted, "" escapes a quote). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

export class RegistryImportError extends Error {
  override name = 'RegistryImportError';
}

/** Streams a CSV file as records keyed by its header, after checking the columns it needs. */
async function* records(dir: string, file: string, required: readonly string[]): AsyncGenerator<Record<string, string>> {
  const path = join(dir, file);
  if (!existsSync(path)) throw new RegistryImportError(`${file} is missing from ${dir}`);
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const raw of lines) {
    const line = raw.replace(/^﻿/, '');
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells;
      const missing = required.filter((c) => !header!.includes(c));
      if (missing.length) throw new RegistryImportError(`${file} has no column ${missing.join(', ')}: is this the KBO open-data extract?`);
      continue;
    }
    const record: Record<string, string> = {};
    header.forEach((name, i) => (record[name] = cells[i] ?? ''));
    yield record;
  }
}

const enterpriseNumber = /^\d{4}\.\d{3}\.\d{3}$/;
const BATCH = 5000;

const requiredFiles: [string, string[]][] = [
  ['enterprise.csv', ['EnterpriseNumber', 'Status']],
  ['denomination.csv', ['EntityNumber', 'TypeOfDenomination', 'Denomination']],
  ['activity.csv', ['EntityNumber', 'NaceVersion', 'NaceCode', 'Classification']],
  ['address.csv', ['EntityNumber', 'TypeOfAddress', 'Zipcode', 'MunicipalityFR', 'MunicipalityNL']],
];

export interface ImportSummary {
  enterprises: number;
  names: number;
  activities: number;
  addresses: number;
  naceCodes: number;
}

/**
 * Imports the KBO/BCE open-data extract (the unzipped "Full" files) into the
 * registry tables, replacing what was there. Keeps active enterprises, every
 * registered name, the main NACE activity and the registered-office address.
 */
export async function importRegistry(db: Db, dir: string, log: (line: string) => void = () => {}): Promise<ImportSummary> {
  const sqlite = db.$client;
  const summary: ImportSummary = { enterprises: 0, names: 0, activities: 0, addresses: 0, naceCodes: 0 };

  const batched = async (source: AsyncGenerator<Record<string, string>>, apply: (r: Record<string, string>) => boolean) => {
    let n = 0;
    let pending: Record<string, string>[] = [];
    const flush = sqlite.transaction((rows: Record<string, string>[]) => {
      for (const r of rows) if (apply(r)) n += 1;
    });
    for await (const r of source) {
      pending.push(r);
      if (pending.length >= BATCH) {
        flush(pending);
        pending = [];
      }
    }
    flush(pending);
    return n;
  };

  // Check every file before touching the current register, so a wrong folder changes nothing.
  for (const [file, columns] of requiredFiles) {
    for await (const _ of records(dir, file, columns)) break;
  }
  const clear = () => sqlite.exec('DELETE FROM registry_names; DELETE FROM registry_enterprises; DELETE FROM registry_nace;');
  clear();
  try {
    await importFiles();
  } catch (err) {
    // A half-loaded register would answer with wrong or nameless companies: better none at all.
    clear();
    throw err;
  }
  sqlite.exec("DELETE FROM registry_enterprises WHERE name = ''");
  return summary;

  async function importFiles(): Promise<void> {
    // 1. Active enterprises. Names come later; the legal name fills `name`.
    const insertEnterprise = sqlite.prepare("INSERT OR IGNORE INTO registry_enterprises (enterprise_number, name) VALUES (?, '')");
    summary.enterprises = await batched(records(dir, 'enterprise.csv', ['EnterpriseNumber', 'Status']), (r) => {
      if (r.Status !== 'AC' || !enterpriseNumber.test(r.EnterpriseNumber!)) return false;
      return insertEnterprise.run(r.EnterpriseNumber).changes > 0;
    });
    log(`${summary.enterprises} active enterprises`);

    // 2. Names: legal name (001), abbreviation (002), commercial name (003), in every language.
    const insertName = sqlite.prepare(
      'INSERT OR IGNORE INTO registry_names (normalised_name, enterprise_number) SELECT ?, enterprise_number FROM registry_enterprises WHERE enterprise_number = ?',
    );
    const setLegalName = sqlite.prepare("UPDATE registry_enterprises SET name = ? WHERE enterprise_number = ? AND name = ''");
    summary.names = await batched(
      records(dir, 'denomination.csv', ['EntityNumber', 'TypeOfDenomination', 'Denomination']),
      (r) => {
        const normalised = normaliseCompanyName(r.Denomination ?? '');
        if (!normalised) return false;
        if (r.TypeOfDenomination === '001') setLegalName.run(r.Denomination, r.EntityNumber);
        return insertName.run(normalised, r.EntityNumber).changes > 0;
      },
    );
    log(`${summary.names} names`);

    // 3. Main activity: the newest NACE version wins.
    const setNace = sqlite.prepare(
      'UPDATE registry_enterprises SET nace_code = ?, nace_version = ? WHERE enterprise_number = ? AND (nace_version IS NULL OR nace_version < ?)',
    );
    summary.activities = await batched(
      records(dir, 'activity.csv', ['EntityNumber', 'NaceVersion', 'NaceCode', 'Classification']),
      (r) => {
        if (r.Classification !== 'MAIN' || !/^\d{4,5}$/.test(r.NaceCode ?? '')) return false;
        const code = `${r.NaceCode!.slice(0, 2)}.${r.NaceCode!.slice(2)}`;
        return setNace.run(code, r.NaceVersion, r.EntityNumber, r.NaceVersion).changes > 0;
      },
    );
    log(`${summary.activities} main activities`);

    // 4. Registered office.
    const setAddress = sqlite.prepare('UPDATE registry_enterprises SET zipcode = ?, municipality = ? WHERE enterprise_number = ?');
    summary.addresses = await batched(
      records(dir, 'address.csv', ['EntityNumber', 'TypeOfAddress', 'Zipcode', 'MunicipalityFR', 'MunicipalityNL']),
      (r) => {
        if (r.TypeOfAddress !== 'REGO') return false;
        return setAddress.run(r.Zipcode || null, r.MunicipalityFR || r.MunicipalityNL || null, r.EntityNumber).changes > 0;
      },
    );
    log(`${summary.addresses} addresses`);

    // 5. NACE descriptions, French first, Dutch as fallback.
    if (existsSync(join(dir, 'code.csv'))) {
      const setDescription = sqlite.prepare('INSERT INTO registry_nace (code, description) VALUES (?, ?) ON CONFLICT(code) DO NOTHING');
      const rows: Record<string, string>[] = [];
      for await (const r of records(dir, 'code.csv', ['Category', 'Code', 'Language', 'Description'])) {
        if (/^Nace(2008|2025)$/.test(r.Category ?? '') && /^\d{4,5}$/.test(r.Code ?? '')) rows.push(r);
      }
      const rank = (r: Record<string, string>) => (r.Category === 'Nace2025' ? 0 : 3) + (r.Language === 'FR' ? 0 : r.Language === 'NL' ? 1 : 2);
      rows.sort((a, b) => rank(a) - rank(b));
      summary.naceCodes = await batched(
        (async function* () {
          yield* rows;
        })(),
        (r) => setDescription.run(`${r.Code!.slice(0, 2)}.${r.Code!.slice(2)}`, r.Description).changes > 0,
      );
    }
  }
}
