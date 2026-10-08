export const sourceErrorKinds = [
  'SourceUnavailable',
  'RateLimited',
  'RobotsDisallowed',
  'Timeout',
  'ParseFailed',
  'QuotaExceeded',
  'AuthRequired',
  'Unknown',
] as const;
export type SourceErrorKind = (typeof sourceErrorKinds)[number];

export interface SourceError {
  kind: SourceErrorKind;
  adapter: string;
  url: string | null;
  retryable: boolean;
  message: string;
}

/** The only exception an adapter is allowed to throw. */
export class SourceFailure extends Error {
  readonly error: SourceError;

  constructor(error: SourceError) {
    super(`${error.adapter}: ${error.kind}: ${error.message}`);
    this.name = 'SourceFailure';
    this.error = error;
  }
}

const retryableKinds: ReadonlySet<SourceErrorKind> = new Set(['Timeout', 'SourceUnavailable']);

export function sourceFailure(
  adapter: string,
  kind: SourceErrorKind,
  message: string,
  url: string | null = null,
): SourceFailure {
  return new SourceFailure({ kind, adapter, url, message, retryable: retryableKinds.has(kind) });
}

/** Turns anything an adapter threw into a SourceError. Anything but a SourceFailure is an adapter bug. */
export function normaliseSourceError(adapter: string, thrown: unknown): SourceError {
  if (thrown instanceof SourceFailure) return thrown.error;
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return { kind: 'Unknown', adapter, url: null, retryable: false, message };
}
