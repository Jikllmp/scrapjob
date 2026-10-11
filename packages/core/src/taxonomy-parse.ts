import { parse } from 'yaml';
import type { z } from 'zod';
import { HostsFile, LocationsFile, RolesFile, SectorsFile, SynonymsFile, type Taxonomy } from './taxonomy';

export interface TaxonomySources {
  synonyms: string;
  roles: string;
  locations: string;
  hosts: string;
  sectors: string;
}

export class TaxonomyError extends Error {
  override name = 'TaxonomyError';
}

function parseFile<S extends z.ZodType>(schema: S, source: string, file: string): z.infer<S> {
  let data: unknown;
  try {
    data = parse(source);
  } catch (err) {
    throw new TaxonomyError(`config/${file}: invalid YAML: ${(err as Error).message}`);
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new TaxonomyError(`config/${file} is malformed:\n${issues}`);
  }
  return result.data;
}

/** Parses and validates the YAML files in `config/`. */
export function parseTaxonomy(sources: TaxonomySources): Taxonomy {
  return {
    synonyms: parseFile(SynonymsFile, sources.synonyms, 'synonyms.yaml'),
    roles: parseFile(RolesFile, sources.roles, 'roles.yaml'),
    locations: parseFile(LocationsFile, sources.locations, 'locations.yaml'),
    hosts: parseFile(HostsFile, sources.hosts, 'hosts.yaml'),
    sectors: parseFile(SectorsFile, sources.sectors, 'sectors.yaml'),
  };
}
