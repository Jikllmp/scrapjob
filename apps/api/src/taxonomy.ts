import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTaxonomy, type Taxonomy } from '@scrapjob/core';

/** Loads and validates `config/*.yaml`. A malformed file stops the server at boot with its name. */
export function loadTaxonomy(configDir: string): Taxonomy {
  const read = (name: string) => readFileSync(join(configDir, name), 'utf8');
  return parseTaxonomy({
    synonyms: read('synonyms.yaml'),
    roles: read('roles.yaml'),
    locations: read('locations.yaml'),
    hosts: read('hosts.yaml'),
    sectors: read('sectors.yaml'),
  });
}
