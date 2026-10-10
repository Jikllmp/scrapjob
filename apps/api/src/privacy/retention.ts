import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client';
import { purgeExpiredContacts } from './purge';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs the retention purge at boot and then once a day while the server is up. */
export class RetentionJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly retentionDays: number,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  runOnce(): number {
    const { contacts, files } = purgeExpiredContacts(this.db, this.retentionDays, this.now());
    if (contacts > 0) this.log.info({ contacts, files, retentionDays: this.retentionDays }, 'retention: deleted expired contacts');
    return contacts;
  }

  start(): void {
    this.runOnce();
    this.timer = setInterval(() => this.runOnce(), DAY_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
