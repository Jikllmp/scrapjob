import { employersFor, registrableDomain, type Employer, type SearchContext, type SourceAdapter } from '@scrapjob/core';
import type { CompanyCandidateInput, EvidenceRef } from '@scrapjob/schema';

/**
 * The employers the user lists by hand in `config/employers.yaml`. Needs no
 * API key and makes no request: it only names employers, whose own sites and
 * job feeds the other sources then read.
 */
export class EmployerListAdapter implements SourceAdapter {
  readonly id = 'employer-list';
  readonly displayName = 'Your employer list';
  readonly capabilities = new Set(['companies'] as const);

  constructor(private readonly employers: readonly Employer[]) {}

  async isAvailable(): Promise<boolean> {
    return this.employers.length > 0;
  }

  unavailableReason(): string {
    return 'config/employers.yaml lists no employer';
  }

  async *discoverCompanies(ctx: SearchContext): AsyncGenerator<CompanyCandidateInput> {
    const matches = employersFor(this.employers, ctx.plan.location, ctx.plan.field);
    if (matches.length === 0) {
      ctx.events.emit('WARNING', 'info', `Your employer list has no employer in ${ctx.location}`, { adapter: this.id });
    }
    for (const employer of matches) {
      if (ctx.shouldStop()) return;
      yield candidate(employer);
    }
  }

  async *discoverJobs() {}

  async *discoverPeople() {}

  async enrich() {
    return {};
  }
}

function candidate(employer: Employer): CompanyCandidateInput {
  const snippet = ['Employer list', employer.name, employer.city, employer.website].filter(Boolean).join(' · ');
  const ev = (field: EvidenceRef['field'], value: string): EvidenceRef => ({
    field,
    value,
    // The list cites no page of its own; the employer's site is where the user can check it.
    sourceUrl: employer.website ?? listUrl,
    snippet,
    sourceKind: 'user',
    retrievedAt: new Date().toISOString(),
  });
  return {
    name: employer.name,
    city: employer.city,
    ...(employer.website ? { website: employer.website, domain: registrableDomain(employer.website) } : {}),
    evidence: [
      ev('name', employer.name),
      ev('city', employer.city),
      ...(employer.website ? [ev('website', employer.website)] : []),
    ],
  };
}

/** Stands in as the source of an employer listed without a website. */
const listUrl = 'https://github.com/Jikllmp/scrapjob/blob/main/config/employers.yaml';
