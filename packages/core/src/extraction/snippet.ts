import { collapseWhitespace } from '../text/normalise';

export const MAX_SNIPPET = 500;

/** The anti-fabrication check: a value is accepted only if it is literally in its snippet. */
export function valueInSnippet(value: string, snippet: string): boolean {
  const v = collapseWhitespace(value).toLowerCase();
  return v.length > 0 && collapseWhitespace(snippet).toLowerCase().includes(v);
}

/** A window of `text` around the first occurrence of `value`, at most 500 characters. Null if absent. */
export function snippetAround(text: string, value: string, max = MAX_SNIPPET): string | null {
  const clean = collapseWhitespace(text);
  const v = collapseWhitespace(value);
  const at = clean.toLowerCase().indexOf(v.toLowerCase());
  if (at === -1 || v.length > max) return null;
  const room = max - v.length;
  let start = Math.max(0, at - Math.floor(room / 2));
  const end = Math.min(clean.length, start + max);
  start = Math.max(0, end - max);
  return clean.slice(start, end);
}

export function clip(text: string, max = MAX_SNIPPET): string {
  const clean = collapseWhitespace(text);
  return clean.length <= max ? clean : clean.slice(0, max);
}
