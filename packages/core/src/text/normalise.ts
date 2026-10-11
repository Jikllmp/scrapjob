/** Lowercase, strip accents, turn punctuation into spaces, collapse whitespace. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#+.@]+/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])\.|\.(?![\p{L}\p{N}])/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `phrase` appears in `text` as whole tokens, ignoring case, accents and punctuation. */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = foldText(phrase);
  if (!needle) return false;
  return ` ${foldText(text)} `.includes(` ${needle} `);
}

/** Collapses whitespace so that values copied from HTML compare equal to their snippet. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Name key for dedup: accents, case and punctuation ignored, tokens sorted so
 * that "Dupont Marie" and "Marie Dupont" compare equal.
 */
export function normaliseName(name: string): string {
  return foldText(name.replace(/[.,'’\-]/g, ' '))
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

export function normaliseCompanyName(name: string): string {
  const legalForms = new Set(['sa', 'srl', 'sprl', 'nv', 'bv', 'bvba', 'scrl', 'cv', 'asbl', 'vzw', 'sas', 'gmbh', 'ltd', 'inc', 'llc']);
  return foldText(name.replace(/[.,'’\-]/g, ' '))
    .split(' ')
    .filter((t) => t && !legalForms.has(t))
    .join(' ');
}

/** Canonical form of a profile URL: https, no www, no query or fragment, no trailing slash, lowercase path for LinkedIn. */
export function normaliseProfileUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|[a-z]{2})\.(?=linkedin\.com$)/, '').replace(/^www\./, '');
  let path = safeDecode(url.pathname).replace(/\/+$/, '');
  if (host === 'linkedin.com') path = path.toLowerCase();
  return `https://${host}${path}`;
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    // A malformed escape in a scraped URL: compare it as written.
    return path;
  }
}

const twoLevelSuffixes = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'co.nz', 'com.br', 'co.jp', 'com.tr', 'co.za']);

/** eTLD+1 for the hosts this tool meets. Good enough without a public-suffix list. */
export function registrableDomain(hostOrUrl: string): string {
  let host = hostOrUrl;
  try {
    host = new URL(hostOrUrl).hostname;
  } catch {
    // already a host
  }
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return twoLevelSuffixes.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** ASCII-safe, path-traversal-safe slug for file names. */
export function slugify(value: string, max = 40): string {
  const slug = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'x';
}
