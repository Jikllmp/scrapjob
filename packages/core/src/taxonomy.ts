import { z } from 'zod';
import { foldText } from './text/normalise';

const lang = z.enum(['fr', 'nl', 'en', 'de']);
export type Lang = z.infer<typeof lang>;

export const SynonymsFile = z.object({
  positions: z.array(
    z.object({
      key: z.string(),
      field: z.string(),
      match: z.array(z.string()).min(1),
      synonyms: z.partialRecord(lang, z.array(z.string())),
    }),
  ),
});

export const RolesFile = z.object({
  archetypes: z.array(
    z.object({
      key: z.string(),
      tier: z.number().int().min(1).max(5),
      keywords: z.array(z.string()).default([]),
      generic_keywords: z.array(z.string()).default([]),
    }),
  ),
});

export const LocationsFile = z.object({
  countries: z.record(
    z.string(),
    z.object({
      name: z.partialRecord(lang, z.string()),
      languages: z.array(lang).min(1),
      search_country: z.string(),
    }),
  ),
  places: z.array(
    z.object({
      name: z.string(),
      country: z.string(),
      province: z.string().optional(),
      region: z.string().optional(),
      languages: z.array(lang).min(1),
      aliases: z.array(z.string()).default([]),
      sections: z.array(z.string()).default([]),
    }),
  ),
});

export const HostsFile = z.object({
  aggregators: z.array(z.string()),
  media: z.array(z.string()),
  ats: z.array(z.string()),
  agencies: z.array(z.string()),
});

export const SectorsFile = z.object({
  fields: z.record(z.string(), z.object({ nace: z.array(z.string().regex(/^\d{2}(\.\d{1,3})?$/)).min(1) })),
});

export interface Taxonomy {
  synonyms: z.infer<typeof SynonymsFile>;
  roles: z.infer<typeof RolesFile>;
  locations: z.infer<typeof LocationsFile>;
  hosts: z.infer<typeof HostsFile>;
  sectors: z.infer<typeof SectorsFile>;
}

/** Digits of a NACE code, "62.010" → "62010". */
function naceDigits(code: string): string {
  return code.replace(/\D/g, '');
}

/**
 * Whether an employer's NACE code belongs to the position's field. null when
 * either is unknown, so the score neither rewards nor punishes it.
 */
export function sectorMatches(field: string | null, naceCode: string | null, taxonomy: Taxonomy): boolean | null {
  if (!field || !naceCode) return null;
  const prefixes = taxonomy.sectors.fields[field]?.nace;
  if (!prefixes) return null;
  const digits = naceDigits(naceCode);
  return prefixes.some((p) => digits.startsWith(naceDigits(p)));
}

export type Place = z.infer<typeof LocationsFile>['places'][number];

export interface ResolvedLocation {
  /** What the user typed, trimmed. */
  input: string;
  place: Place | null;
  countryCode: string | null;
  countryName: string | null;
  languages: Lang[];
  /** Names that count as inside the requested area. */
  areaNames: string[];
}

export function resolveLocation(input: string, taxonomy: Taxonomy): ResolvedLocation {
  const folded = foldText(input);
  const place =
    taxonomy.locations.places.find((p) => [p.name, ...p.aliases].some((n) => foldText(n) === folded)) ?? null;
  if (!place) {
    return { input: input.trim(), place: null, countryCode: null, countryName: null, languages: ['fr', 'en'], areaNames: [input.trim()] };
  }
  const country = taxonomy.locations.countries[place.country];
  return {
    input: input.trim(),
    place,
    countryCode: place.country,
    countryName: country?.name.fr ?? country?.name.en ?? null,
    languages: place.languages,
    areaNames: [...new Set([place.name, ...place.aliases, ...place.sections])],
  };
}
