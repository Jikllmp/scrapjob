const particles = new Set(['de', 'du', 'des', 'van', 'der', 'den', 'le', 'la', 'von', 'di', 'da', "d'", 'ter', 'ten', 'el', 'al']);
const notNames = new Set([
  'notre', 'nos', 'our', 'the', 'team', 'équipe', 'equipe', 'contact', 'contactez', 'nous', 'about', 'qui', 'sommes',
  'meet', 'rencontrez', 'linkedin', 'email', 'mail', 'tel', 'phone', 'read', 'more', 'lire', 'plus', 'en', 'savoir',
  'home', 'accueil', 'news', 'jobs', 'join', 'rejoignez', 'management', 'direction', 'board', 'services', 'solutions',
  'privacy', 'cookies', 'mentions', 'légales', 'legales', 'ons', 'over', 'werken', 'bij', 'all', 'rights', 'reserved',
]);

const capitalised = /^\p{Lu}[\p{Ll}'’-]*(?:-\p{Lu}[\p{Ll}'’]*)*$|^\p{Lu}{2,}$/u;

/**
 * Heuristic: 2–4 words, each capitalised (particles allowed), no digits, no
 * common page words. Rejects anything that reads like a heading.
 */
export function looksLikePersonName(value: string): boolean {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 4 || text.length > 50 || /[\d@:/|•·,;!?()]/.test(text)) return false;
  const words = text.split(' ');
  if (words.length < 2 || words.length > 4) return false;
  let real = 0;
  for (const w of words) {
    const lower = w.toLowerCase();
    if (notNames.has(lower)) return false;
    if (particles.has(lower)) continue;
    if (!capitalised.test(w)) return false;
    real += 1;
  }
  return real >= 2;
}

export function splitName(fullName: string): { first: string; last: string } | null {
  const words = fullName.trim().split(/\s+/);
  if (words.length < 2) return null;
  return { first: words[0]!, last: words.slice(1).join(' ') };
}
