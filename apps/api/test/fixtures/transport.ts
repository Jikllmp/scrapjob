import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transport, TransportRequest, TransportResponse } from '../../src/http/transport';

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), 'utf8');

const html = { 'content-type': 'text/html; charset=utf-8' };
const text = { 'content-type': 'text/plain' };
const json = { 'content-type': 'application/json' };

/** URL → fixture. Anything else answers 404, like a site without that page. */
const sites: Record<string, { file: string; headers: Record<string, string> }> = {
  'https://www.acme-software.test/robots.txt': { file: 'sites/acme-robots.txt', headers: text },
  'https://www.acme-software.test/': { file: 'sites/acme-home.html', headers: html },
  'https://www.acme-software.test/equipe': { file: 'sites/acme-equipe.html', headers: html },
  'https://www.acme-software.test/carrieres': { file: 'sites/acme-carrieres.html', headers: html },
  'https://globex-it.recruitee.com/': { file: 'sites/globex-home.html', headers: html },
  'https://globex-it.recruitee.com/o/developpeur-net': { file: 'sites/globex-job.html', headers: html },
  'https://www.initech.test/robots.txt': { file: 'sites/initech-robots.txt', headers: text },
};

function braveFixture(q: string): string {
  if (q === '"Développeur .NET" Charleroi emploi') return 'brave/dotnet-charleroi-emploi.json';
  if (q.startsWith('site:linkedin.com/in "Acme Software"')) return 'brave/linkedin-acme.json';
  if (q.startsWith('site:linkedin.com/in "Initech"')) return 'brave/linkedin-initech.json';
  return 'brave/empty.json';
}

export interface FixtureTransport {
  transport: Transport;
  requests: TransportRequest[];
  /** Answers a URL with a fixed status instead of its fixture. */
  override(url: string, response: Partial<TransportResponse> & { status: number }): void;
}

export function fixtureTransport(): FixtureTransport {
  const requests: TransportRequest[] = [];
  const overrides = new Map<string, Partial<TransportResponse> & { status: number }>();
  const transport: Transport = async (request) => {
    requests.push(request);
    const forced = overrides.get(request.url);
    if (forced) return { url: request.url, headers: {}, body: '', ...forced };
    const url = new URL(request.url);
    if (url.hostname === 'api.search.brave.com') {
      return { status: 200, url: request.url, headers: json, body: read(braveFixture(url.searchParams.get('q') ?? '')) };
    }
    const site = sites[request.url];
    if (!site) return { status: 404, url: request.url, headers: html, body: '<h1>Not found</h1>' };
    return { status: 200, url: request.url, headers: site.headers, body: read(site.file) };
  };
  return { transport, requests, override: (url, response) => overrides.set(url, response) };
}

/** A clock that only moves when the code under test sleeps, so rate limits cost no real time. */
export function virtualClock() {
  let t = Date.parse('2026-10-08T09:00:00Z');
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}
