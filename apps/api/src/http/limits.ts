/** Token bucket per host: `rps` tokens per second, up to `burst` at once. */
export class HostRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number; blockedUntil: number }>();

  constructor(
    private readonly rps: number,
    private readonly burst: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  /** Waits until a request to `host` is allowed, then takes a token. */
  async acquire(host: string, minIntervalMs = 0): Promise<void> {
    const rate = Math.min(this.rps, minIntervalMs > 0 ? 1000 / minIntervalMs : Infinity);
    const burst = minIntervalMs > 0 ? 1 : this.burst;
    for (;;) {
      const t = this.now();
      const b = this.buckets.get(host) ?? { tokens: burst, updatedAt: t, blockedUntil: 0 };
      b.tokens = Math.min(burst, b.tokens + ((t - b.updatedAt) / 1000) * rate);
      b.updatedAt = t;
      this.buckets.set(host, b);
      if (t >= b.blockedUntil && b.tokens >= 1) {
        b.tokens -= 1;
        return;
      }
      const waitForToken = b.tokens >= 1 ? 0 : ((1 - b.tokens) / rate) * 1000;
      await this.sleep(Math.max(waitForToken, b.blockedUntil - t, 1));
    }
  }

  /** Blocks a host for a while, after a 429 or 403. */
  backOff(host: string, ms: number): void {
    const b = this.buckets.get(host) ?? { tokens: 0, updatedAt: this.now(), blockedUntil: 0 };
    b.blockedUntil = Math.max(b.blockedUntil, this.now() + ms);
    this.buckets.set(host, b);
  }
}

/** Caps how many requests run at once across all hosts. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
