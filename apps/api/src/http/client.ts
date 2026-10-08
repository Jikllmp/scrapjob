import robotsParser from 'robots-parser';
import { sourceFailure, type SearchContext } from '@scrapjob/core';
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
type RobotsEntry = { robots: Robots | null; disallowAll: boolean };

/**
 * The only way adapters reach the network. It sends an honest User-Agent,
 * honours robots.txt and X-Robots-Tag, rate-limits per host, caps concurrency,
 * retries only timeouts and 5xx, and backs off on 429/403.
 */
export class HttpClient {
  private readonly limiter: HostRateLimiter;
  private readonly semaphore: Semaphore;
  private readonly robotsCache = new Map<string, Promise<RobotsEntry>>();
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

  /** Fetches a URL. Returns non-error statuses (2xx, 3xx, 404, …) for the caller to judge. */
  async get(url: string, opts: GetOptions): Promise<TransportResponse> {
    const parsed = new URL(url);
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

  private robotsFor(origin: string, opts: GetOptions): Promise<RobotsEntry> {
    let entry = this.robotsCache.get(origin);
    if (!entry) {
      const robotsUrl = `${origin}/robots.txt`;
      entry = this.fetchWithRetries(robotsUrl, opts, 0).then(
        (res): RobotsEntry => {
          if (res.status >= 200 && res.status < 300) return { robots: robotsParser(robotsUrl, res.body), disallowAll: false };
          // RFC 9309: a missing robots.txt allows everything; a server error means assume everything is disallowed.
          if (res.status >= 400 && res.status < 500) return { robots: null, disallowAll: false };
          return { robots: null, disallowAll: true };
        },
        (): RobotsEntry => {
          // Unreachable this time: treat as disallowed now, but ask again next time.
          this.robotsCache.delete(origin);
          return { robots: null, disallowAll: true };
        },
      );
      this.robotsCache.set(origin, entry);
    }
    return entry;
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
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** streak * 1000;
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
