const genericLocalParts = new Set([
  'info', 'contact', 'jobs', 'job', 'careers', 'career', 'carriere', 'carrieres', 'emploi', 'rh', 'hr', 'recrutement',
  'recruitment', 'recruiting', 'talent', 'hello', 'hallo', 'bonjour', 'admin', 'office', 'secretariat', 'accueil',
  'sales', 'support', 'noreply', 'no-reply', 'webmaster', 'privacy', 'gdpr', 'dpo', 'vacatures', 'werken', 'team',
]);

const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Role mailboxes (`jobs@`, `info@`) are never a contact (spec §1). */
export function isGenericMailbox(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return genericLocalParts.has(local) || genericLocalParts.has(local.split(/[.+_-]/)[0] ?? '');
}

/** Email addresses written in the text. Never derived, never guessed. */
export function emailsInText(text: string): string[] {
  return [...new Set(text.match(emailPattern) ?? [])].map((e) => e.replace(/\.$/, ''));
}
