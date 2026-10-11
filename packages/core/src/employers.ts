import { parse } from 'yaml';
import { z } from 'zod';
import type { ResolvedLocation } from './taxonomy';
import { TaxonomyError } from './taxonomy-parse';
import { containsPhrase } from './text/normalise';

export const EmployersFile = z.object({
  employers: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        website: z.url({ protocol: /^https?$/ }).optional(),
        /** Commune or section, as in locations.yaml, e.g. "Gosselies". */
        city: z.string().trim().min(1),
        /** Fields from synonyms.yaml (software, engineering…). Empty: listed for every position. */
        fields: z.array(z.string()).default([]),
      }),
    )
    .nullable()
    .default([])
    .transform((v) => v ?? []),
});

export type Employer = z.infer<typeof EmployersFile>['employers'][number];

/** Parses `config/employers.yaml`, the employer list the user keeps by hand. */
export function parseEmployers(source: string): Employer[] {
  let data: unknown;
  try {
    data = parse(source) ?? {};
  } catch (err) {
    throw new TaxonomyError(`config/employers.yaml: invalid YAML: ${(err as Error).message}`);
  }
  const result = EmployersFile.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new TaxonomyError(`config/employers.yaml is malformed:\n${issues}`);
  }
  return result.data.employers;
}

/** The listed employers inside the searched area, and in the position's field when both are known. */
export function employersFor(employers: readonly Employer[], location: ResolvedLocation, field: string | null): Employer[] {
  return employers.filter(
    (e) =>
      location.areaNames.some((a) => containsPhrase(e.city, a)) &&
      (e.fields.length === 0 || field === null || e.fields.includes(field)),
  );
}

const hiringRoles = ['recruiter', 'recruteur', 'talent acquisition', 'RH', 'HR', 'ressources humaines'];

/**
 * A LinkedIn people search for an employer's recruiters, opened in the user's
 * own browser and account. The app never fetches LinkedIn itself.
 */
export function linkedInPeopleSearchUrl(companyName: string): string {
  const roles = hiringRoles.map((r) => (r.includes(' ') ? `"${r}"` : r)).join(' OR ');
  const keywords = `"${companyName.replace(/"/g, '')}" (${roles})`;
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}
