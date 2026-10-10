import { containsPhrase, normaliseCompanyName, type SearchContext, type SourceAdapter } from '@scrapjob/core';
import type { Company, CompanyPatch, EvidenceRef } from '@scrapjob/schema';
import type { Db } from '../db/client';

interface RegistryRow {
  enterprise_number: string;
  name: string;
  nace_code: string | null;
  zipcode: string | null;
  municipality: string | null;
  description: string | null;
}

/** The register's own public page for an enterprise, so a reader can check the record. */
export function kboPublicUrl(enterpriseNumber: string): string {
  return `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${enterpriseNumber.replace(/\D/g, '')}`;
}

/**
 * The Belgian business register (KBO/BCE open data), imported locally with
 * `pnpm registry:import`. It gives an employer's enterprise number and main
 * activity, which feeds the sector score. It is never a source of people.
 * No network request is made: the data is a local copy.
 */
export class RegistryAdapter implements SourceAdapter {
  readonly id = 'registry';
  readonly displayName = 'Business register (KBO/BCE)';
  readonly capabilities = new Set(['enrich'] as const);

  constructor(private readonly db: Db) {}

  async isAvailable(): Promise<boolean> {
    const row = this.db.$client.prepare('SELECT 1 FROM registry_enterprises LIMIT 1').get();
    return row !== undefined;
  }

  unavailableReason(): string {
    return 'the business register is not imported yet (pnpm registry:import -- <folder>)';
  }

  async *discoverCompanies() {}

  async *discoverJobs() {}

  async *discoverPeople() {}

  async enrich() {
    return {};
  }

  async enrichCompany(ctx: SearchContext, company: Company): Promise<CompanyPatch | null> {
    const normalised = normaliseCompanyName(company.name);
    if (!normalised) return null;
    let rows = this.db.$client
      .prepare(
        `SELECT e.enterprise_number, e.name, e.nace_code, e.zipcode, e.municipality, n.description
         FROM registry_names r
         JOIN registry_enterprises e ON e.enterprise_number = r.enterprise_number
         LEFT JOIN registry_nace n ON n.code = e.nace_code
         WHERE r.normalised_name = ?
         LIMIT 20`,
      )
      .all(normalised) as RegistryRow[];
    // Homonyms are common: prefer an enterprise registered in the searched area, and give up when still ambiguous.
    if (rows.length > 1) {
      const local = rows.filter((r) => r.municipality && ctx.plan.location.areaNames.some((a) => containsPhrase(r.municipality!, a)));
      rows = local;
    }
    if (rows.length !== 1) {
      if (rows.length > 1) {
        ctx.events.emit('WARNING', 'debug', `${company.name}: several register entries match, none used`, { adapter: this.id });
      }
      return null;
    }
    const row = rows[0]!;
    const industry = row.nace_code ? (row.description ?? `NACE ${row.nace_code}`) : null;
    const snippet = [
      row.enterprise_number,
      row.name,
      row.nace_code ? `NACE ${row.nace_code}${row.description ? ` ${row.description}` : ''}` : null,
      [row.zipcode, row.municipality].filter(Boolean).join(' ') || null,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500);
    const ev = (field: EvidenceRef['field'], value: string): EvidenceRef => ({
      field,
      value,
      sourceUrl: kboPublicUrl(row.enterprise_number),
      snippet,
      sourceKind: 'dataset',
      retrievedAt: new Date().toISOString(),
    });
    return {
      registryId: row.enterprise_number,
      ...(row.nace_code ? { naceCode: row.nace_code } : {}),
      ...(industry ? { industry } : {}),
      evidence: [ev('registry_id', row.enterprise_number), ...(industry ? [ev('industry', industry)] : [])],
    };
  }
}
