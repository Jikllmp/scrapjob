import { ContactCandidate, type Company } from '@scrapjob/schema';
import type { EventSink } from '../adapters/types';
import { contactFields, type AttributedEvidence, type CompanyRef, type ContactDraft, type ContactField } from '../contacts/fields';
import { classifyTitle, postingContactRole } from '../contacts/roles';
import { splitName } from '../extraction/names';
import { valueInSnippet } from '../extraction/snippet';
import { containsPhrase, foldText, normaliseCompanyName } from '../text/normalise';
import type { Taxonomy } from '../taxonomy';

const candidateFieldMap: Record<string, ContactField> = {
  fullName: 'full_name',
  firstName: 'first_name',
  lastName: 'last_name',
  title: 'title',
  department: 'department',
  profileUrl: 'profile_url',
  email: 'email',
  phone: 'phone',
  city: 'city',
  country: 'country',
  companyName: 'company',
};

export type CandidateResult = { ok: true; draft: ContactDraft } | { ok: false; reason: string };

export function companyRef(company: Company): CompanyRef {
  return { id: company.id, name: company.name, domain: company.domain, isAgency: company.isAgency };
}

/** Same employer when either name contains the other as whole words, legal forms ignored. */
export function sameEmployer(a: string, b: string): boolean {
  const x = normaliseCompanyName(a);
  const y = normaliseCompanyName(b);
  return x.length > 0 && y.length > 0 && (containsPhrase(x, y) || containsPhrase(y, x));
}

/**
 * Turns an adapter's raw contact candidate into a draft, enforcing the
 * no-fabrication rules: every kept value has evidence whose snippet contains
 * it, and a value without such evidence is dropped and logged.
 */
export function buildDraft(
  raw: unknown,
  adapter: string,
  company: Company,
  taxonomy: Taxonomy,
  events: EventSink,
): CandidateResult {
  const parsed = ContactCandidate.safeParse(raw);
  if (!parsed.success) {
    events.emit('EXTRACTION_REJECTED', 'warn', `${adapter} returned an invalid contact candidate`, {
      adapter,
      issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return { ok: false, reason: 'invalid candidate' };
  }
  const candidate = parsed.data;

  const evidence: AttributedEvidence[] = [];
  for (const e of candidate.evidence) {
    if (!valueInSnippet(e.value, e.snippet)) {
      events.emit('EXTRACTION_REJECTED', 'warn', `${adapter}: "${e.field}" value is not in its snippet`, {
        adapter,
        field: e.field,
        sourceUrl: e.sourceUrl,
      });
      continue;
    }
    evidence.push({ ...e, sourceAdapter: adapter });
  }

  const fields: ContactDraft['fields'] = {};
  for (const [key, field] of Object.entries(candidateFieldMap)) {
    const value = candidate[key as keyof ContactCandidate];
    if (typeof value !== 'string' || !value.trim()) continue;
    const supported = evidence.some((e) => e.field === field && foldText(e.value) === foldText(value));
    if (supported) fields[field] = value.trim();
    else {
      events.emit('EXTRACTION_REJECTED', 'debug', `${adapter}: "${field}" has no evidence and was dropped`, {
        adapter,
        field,
      });
    }
  }
  if (!fields.full_name) return { ok: false, reason: 'no evidenced name' };

  // First and last name come from the evidenced full name, on the same evidence.
  const split = fields.first_name || fields.last_name ? null : splitName(fields.full_name);
  if (split) {
    const nameEvidence = evidence.filter((e) => e.field === 'full_name' && foldText(e.value) === foldText(fields.full_name!));
    fields.first_name = split.first;
    fields.last_name = split.last;
    for (const e of nameEvidence) {
      evidence.push({ ...e, field: 'first_name', value: split.first }, { ...e, field: 'last_name', value: split.last });
    }
  }

  if (!fields.company) return { ok: false, reason: `no evidence links them to ${company.name}` };
  if (!sameEmployer(fields.company, company.name)) {
    return { ok: false, reason: `listed at "${fields.company}", not ${company.name}` };
  }

  const role = candidate.postingContact
    ? postingContactRole(taxonomy)
    : fields.title
      ? classifyTitle(fields.title, taxonomy)
      : null;
  if (!role) {
    return { ok: false, reason: fields.title ? `"${fields.title}" is not a hiring-relevant role` : 'no job title' };
  }

  const keep = new Set<string>(contactFields.filter((f) => fields[f] !== undefined));
  return {
    ok: true,
    draft: {
      id: null,
      fields,
      company: companyRef(company),
      evidence: evidence.filter((e) => keep.has(e.field)),
      roleArchetype: role.archetype,
      roleTier: role.tier,
      roleGenericOnly: role.genericOnly,
      fieldFlags: {},
    },
  };
}
