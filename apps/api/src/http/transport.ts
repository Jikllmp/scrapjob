import { fetch } from 'undici';

export interface TransportRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Thrown by a transport when the request timed out. */
export class TransportTimeout extends Error {
  override name = 'TransportTimeout';
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

const MAX_BODY_BYTES = 3 * 1024 * 1024;

/** The real network, through undici. Tests replace it with recorded fixtures. */
export const undiciTransport: Transport = async (request) => {
  const timeout = AbortSignal.timeout(request.timeoutMs);
  try {
    const res = await fetch(request.url, {
      headers: request.headers,
      redirect: 'follow',
      signal: AbortSignal.any([request.signal, timeout]),
    });
    const length = Number(res.headers.get('content-length') ?? 0);
    const body = length > MAX_BODY_BYTES ? '' : (await res.text()).slice(0, MAX_BODY_BYTES);
    return { status: res.status, url: res.url || request.url, headers: Object.fromEntries(res.headers), body };
  } catch (err) {
    if (timeout.aborted) throw new TransportTimeout(`timed out after ${request.timeoutMs} ms`);
    throw err;
  }
};
