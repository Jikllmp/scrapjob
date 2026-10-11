import { resolveLocation, type Lang, type ResolvedLocation, type Taxonomy } from '../taxonomy';
import { containsPhrase } from '../text/normalise';

export const MAX_SEED_QUERIES = 12;

export type QueryIntent = 'careers' | 'jobs' | 'companies';

export interface PlannedQuery {
  id: number;
  intent: QueryIntent;
  text: string;
  lang: Lang;
}

export interface QueryPlan {
  location: ResolvedLocation;
  positionKey: string | null;
  field: string | null;
  /** Position phrasings, the user's own first. */
  positionTerms: string[];
  seeds: PlannedQuery[];
}

const careerWords: Record<Lang, string> = { fr: 'emploi', nl: 'vacature', en: 'jobs', de: 'stellen' };
const jobWords: Record<Lang, string> = { fr: 'offre d’emploi', nl: 'vacature', en: 'job opening', de: 'stellenangebot' };
const companyWords: Record<Lang, string> = { fr: 'société informatique', nl: 'IT bedrijf', en: 'software company', de: 'softwarefirma' };

/**
 * Builds at most 12 seed queries, best expected yield first: employer career
 * pages, then job postings, then local companies in the field. Same input,
 * same output.
 */
export function planQueries(location: string, position: string, taxonomy: Taxonomy): QueryPlan {
  const loc = resolveLocation(location, taxonomy);
  const entry = taxonomy.synonyms.positions.find((p) => p.match.some((m) => containsPhrase(position, m))) ?? null;
  const langs: Lang[] = [...new Set<Lang>([...loc.languages, 'en'])];

  const termsByLang = (l: Lang): string[] => entry?.synonyms[l] ?? [];
  const positionTerms = dedupe([position.trim(), ...langs.flatMap(termsByLang)]);
  const where = loc.place?.name ?? loc.input;
  const wider = loc.place?.province ?? loc.countryName;

  const raw: Omit<PlannedQuery, 'id'>[] = [];
  const primaryLang = langs[0]!;
  // 1. Careers pages in the area, user's phrasing and each local-language synonym.
  raw.push({ intent: 'careers', lang: primaryLang, text: `"${position.trim()}" ${where} ${careerWords[primaryLang]}` });
  for (const l of loc.languages) {
    for (const term of termsByLang(l).slice(0, 2)) {
      raw.push({ intent: 'careers', lang: l, text: `"${term}" ${where} ${careerWords[l]}` });
    }
  }
  // 2. Job postings, also in the wider area.
  for (const l of loc.languages) {
    const term = termsByLang(l)[0] ?? position.trim();
    raw.push({ intent: 'jobs', lang: l, text: `${jobWords[l]} "${term}" ${where}` });
    if (wider) raw.push({ intent: 'jobs', lang: l, text: `${jobWords[l]} "${term}" ${wider}` });
  }
  raw.push({ intent: 'jobs', lang: 'en', text: `"${termsByLang('en')[0] ?? position.trim()}" job ${where}` });
  // 3. Local companies in the field.
  for (const l of loc.languages) raw.push({ intent: 'companies', lang: l, text: `${companyWords[l]} ${where}` });
  if (wider) raw.push({ intent: 'companies', lang: primaryLang, text: `${companyWords[primaryLang]} ${wider}` });

  const seen = new Set<string>();
  const seeds: PlannedQuery[] = [];
  for (const q of raw) {
    const key = q.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ ...q, id: seeds.length + 1 });
    if (seeds.length === MAX_SEED_QUERIES) break;
  }
  return { location: loc, positionKey: entry?.key ?? null, field: entry?.field ?? null, positionTerms, seeds };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = v.toLowerCase();
    if (!v || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
