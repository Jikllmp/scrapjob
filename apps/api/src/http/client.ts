import robotsParser from 'robots-parser';
import { SourceFailure, sourceFailure, type SearchContext } from '@scrapjob/core';
import { HostRateLimiter, Semaphore } from './limits';
import { TransportTimeout, type Transport, type TransportResponse } from './transport';

export const BOT_NAME = 'ScrapJob';

export interface HttpClientOptions {
  transport: Transport;
  contactUrl: string | undefined;
  perHostRps: number;
  maxConcurrent: number;
  timeoutMs: number;
  retryCount: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface GetOptions {
  /** Adapter id, for errors and events. */
  adapter: string;
  ctx: SearchContext;
  headers?: Record<string, string>;
  /** Licensed APIs have no robots.txt to honour; every crawled page does. */
  robots?: boolean;
  /** Counts against the search-API budget instead of the HTTP request budget. */
  budget?: 'http' | 'search_api';
}

type Robots = ReturnType<typeof robotsParser>;
type RobotsEntry = { robots: Robots | null; disallowAll: boolean; ttlMs: number };
type Circuit = { failures: number; open: boolean };

/** Consecutive failed requests to one host before the client stops calling it for the rest of the search. */
export const CIRCUIT_BREAKER_THRESHOLD = 5;
/** A cached robots.txt is re-read after a day (RFC 9309 asks for at most 24 hours). */
export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
/** An unreachable or failing robots.txt means "disallow", but only for a few minutes. */
const ROBOTS_ERROR_TTL_MS = 10 * 60 * 1000;
/** Redirects followed per request, each hop checked like a fresh URL (RFC 9309 asks for at least 5). */
export const MAX_REDIRECTS = 5;
/** Longest wait accepted from a Retry-After header or the backoff. */
export const MAX_BACKOFF_MS = 60_000;
/** Hosts never fetched, whoever links to them (spec §2.1). Their pages are read only through search results. */
const forbiddenHost = (host: string) => /(^|\.)linkedin\.com$/i.test(host) || /(^|\.)lnkd\.in$/i.test(host);

/**
 * The only way adapters reach the network. It sends an honest User-Agent,
 * honours robots.txt and X-Robots-Tag, rate-limits per host, caps concurrency,
 * retries only timeouts and 5xx, backs off on 429/403, and opens a per-host
 * circuit breaker after repeated failures within one search.
 */
export class HttpClient {
  private readonly limiter: HostRateLimiter;
  private readonly semaphore: Semaphore;
  private readonly robotsCache = new Map<string, { entry: Promise<RobotsEntry>; at: number }>();
  /** Keyed by the search's budget, so a finished search's breakers are garbage-collected with it. */
  private readonly circuits = new WeakMap<object, Map<string, Circuit>>();
  private readonly backoffs = new Map<string, number>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  readonly userAgent: string;

  constructor(private readonly options: HttpClientOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.limiter = new HostRateLimiter(options.perHostRps, 3, this.now, this.sleep);
    this.semaphore = new Semaphore(options.maxConcurrent);
    this.userAgent = `${BOT_NAME}/0.2 (+${options.contactUrl ?? 'contact URL not configured'})`;
  }

  get canCrawl(): boolean {
    return this.options.contactUrl !== undefined;
  }

  /**
   * Fetches a URL. Follows redirects itself, so every hop is checked against
   * robots.txt, the forbidden hosts and the rate limits. Returns non-error
   * statuses (2xx, 404, …) for the caller to judge.
   */
  async get(url: string, opts: GetOptions): Promise<TransportResponse> {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      const res = await this.getOne(current, opts);
      const location = res.headers['location'];
      if (res.status < 300 || res.status >= 400 || !location) return res;
      if (hop >= MAX_REDIRECTS) throw sourceFailure(opts.adapter, 'SourceUnavailable', `more than ${MAX_REDIRECTS} redirects`, url);
      current = new URL(location, current).toString();
    }
  }

  private async getOne(url: string, opts: GetOptions): Promise<TransportResponse> {
    const parsed = new URL(url);
    if (forbiddenHost(parsed.hostname)) {
      throw sourceFailure(opts.adapter, 'RobotsDisallowed', `${parsed.hostname} pages are never fetched`, url);
    }
    if (opts.robots !== false && !this.canCrawl) {
      throw sourceFailure(opts.adapter, 'AuthRequired', 'USER_AGENT_CONTACT_URL is not set, and no page is read without one', url);
    }
    const circuit = this.circuitFor(parsed.host, opts);
    if (circuit.open) throw sourceFailure(opts.adapter, 'SourceUnavailable', `${parsed.host} failed repeatedly; skipped for this search`, url);
    try {
      const res = await this.getChecked(url, parsed, opts);
      circuit.failures = 0;
      return res;
    } catch (err) {
      if (isHostFailure(err)) this.recordFailure(circuit, parsed.host, opts);
      throw err;
    }
  }

  private circuitFor(host: string, opts: GetOptions): Circuit {
    let byHost = this.circuits.get(opts.ctx.budget);
    if (!byHost) {
      byHost = new Map();
      this.circuits.set(opts.ctx.budget, byHost);
    }
    let circuit = byHost.get(host);
    if (!circuit) {
      circuit = { failures: 0, open: false };
      byHost.set(host, circuit);
    }
    return circuit;
  }

  private recordFailure(circuit: Circuit, host: string, opts: GetOptions): void {
    circuit.failures += 1;
    if (circuit.open || circuit.failures < CIRCUIT_BREAKER_THRESHOLD) return;
    circuit.open = true;
    opts.ctx.events.emit('WARNING', 'warn', `${host} failed ${circuit.failures} times in a row; skipping it for the rest of this search`, {
      adapter: opts.adapter,
      host,
      circuitBreaker: 'open',
    });
  }

  private async getChecked(url: string, parsed: URL, opts: GetOptions): Promise<TransportResponse> {
    let crawlDelayMs = 0;
    if (opts.robots !== false) {
      const entry = await this.robotsFor(parsed.origin, opts);
      const allowed = !entry.disallowAll && (entry.robots?.isAllowed(url, BOT_NAME) ?? true);
      if (!allowed) {
        opts.ctx.events.emit('ROBOTS_DISALLOWED', 'info', `robots.txt disallows ${url}`, { adapter: opts.adapter, url });
        throw sourceFailure(opts.adapter, 'RobotsDisallowed', 'disallowed by robots.txt', url);
      }
      crawlDelayMs = (entry.robots?.getCrawlDelay(BOT_NAME) ?? 0) * 1000;
    }
    const res = await this.fetchWithRetries(url, opts, crawlDelayMs);
    const xRobots = res.headers['x-robots-tag']?.toLowerCase() ?? '';
    if (opts.robots !== false && /noindex|none/.test(xRobots)) {
      opts.ctx.events.emit('ROBOTS_DISALLOWED', 'info', `X-Robots-Tag forbids indexing ${url}`, { adapter: opts.adapter, url });
      throw sourceFailure(opts.adapter, 'RobotsDisallowed', `X-Robots-Tag: ${xRobots}`, url);
    }
    return res;
  }

  private async robotsFor(origin: string, opts: GetOptions): Promise<RobotsEntry> {
    const cached = this.robotsCache.get(origin);
    if (cached) {
      const entry = await cached.entry;
      if (this.now() - cached.at < entry.ttlMs) return entry;
    }
    const robotsUrl = `${origin}/robots.txt`;
    const entry = this.fetchRobots(robotsUrl, opts).then(
      (res): RobotsEntry => {
        if (res.status >= 200 && res.status < 300) return { robots: robotsParser(res.url, res.body), disallowAll: false, ttlMs: ROBOTS_TTL_MS };
        // RFC 9309: a missing robots.txt (4xx) allows everything; a server error means assume everything is disallowed.
        if (res.status >= 400 && res.status < 500) return { robots: null, disallowAll: false, ttlMs: ROBOTS_TTL_MS };
        return { robots: null, disallowAll: true, ttlMs: ROBOTS_ERROR_TTL_MS };
      },
      // Unreachable, rate-limited or redirecting forever: disallowed for now, asked again in a few minutes.
      (): RobotsEntry => ({ robots: null, disallowAll: true, ttlMs: ROBOTS_ERROR_TTL_MS }),
    );
    this.robotsCache.set(origin, { entry, at: this.now() });
    return entry;
  }

  /** robots.txt follows its redirects (RFC 9309 §2.3.1.2), up to five hops. */
  private async fetchRobots(url: string, opts: GetOptions): Promise<TransportResponse> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const res = await this.fetchWithRetries(current, opts, 0);
      const location = res.headers['location'];
      if (res.status < 300 || res.status >= 400 || !location) return { ...res, url: current };
      current = new URL(location, current).toString();
    }
    throw sourceFailure(opts.adapter, 'SourceUnavailable', 'robots.txt redirects too many times', url);
  }

  private async fetchWithRetries(url: string, opts: GetOptions, minIntervalMs: number): Promise<TransportResponse> {
    const host = new URL(url).host;
    const attempts = this.options.retryCount + 1;
    for (let attempt = 1; ; attempt += 1) {
      if (opts.ctx.budget.exhausted()) throw sourceFailure(opts.adapter, 'QuotaExceeded', 'search budget exhausted', url);
      await this.limiter.acquire(host, minIntervalMs);
      if (opts.budget === 'search_api') opts.ctx.budget.spendSearchApiCall();
      else opts.ctx.budget.spendHttpRequest();

      let res: TransportResponse | null = null;
      let timedOut = false;
      try {
        res = await this.semaphore.run(() =>
          this.options.transport({
            url,
            headers: { 'user-agent': this.userAgent, 'accept-language': 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7', ...opts.headers },
            timeoutMs: this.options.timeoutMs,
            signal: opts.ctx.signal,
          }),
        );
      } catch (err) {
        if (opts.ctx.signal.aborted) throw sourceFailure(opts.adapter, 'Unknown', 'search cancelled', url);
        if (!(err instanceof TransportTimeout)) {
          throw sourceFailure(opts.adapter, 'SourceUnavailable', (err as Error).message || 'network error', url);
        }
        timedOut = true;
      }

      if (res && (res.status === 429 || res.status === 403)) {
        const streak = (this.backoffs.get(host) ?? 0) + 1;
        this.backoffs.set(host, streak);
        const retryAfter = Number(res.headers['retry-after']);
        const wait = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** Math.min(streak, 6) * 1000, MAX_BACKOFF_MS);
        this.limiter.backOff(host, wait);
        opts.ctx.events.emit('RATE_LIMITED', 'warn', `${host} answered ${res.status}; backing off ${Math.round(wait / 1000)} s`, {
          adapter: opts.adapter,
          url,
          status: res.status,
        });
        throw sourceFailure(opts.adapter, 'RateLimited', `HTTP ${res.status}`, url);
      }
      if (res && res.status < 500) {
        this.backoffs.delete(host);
        return res;
      }
      if (attempt >= attempts) {
        if (timedOut) throw sourceFailure(opts.adapter, 'Timeout', `timed out ${attempts} times`, url);
        throw sourceFailure(opts.adapter, 'SourceUnavailable', `HTTP ${res?.status}`, url);
      }
      const delay = 500 * 2 ** (attempt - 1) * (1 + this.random());
      await this.sleep(delay);
    }
  }
}

function isHostFailure(err: unknown): boolean {
  return err instanceof SourceFailure && ['SourceUnavailable', 'Timeout', 'RateLimited'].includes(err.error.kind);
}
