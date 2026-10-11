import { z } from 'zod';

const int = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

export const ConfigSchema = z.object({
  PORT: int(3001, 1),
  DATABASE_URL: z.string().min(1).default('file:./data/scrapjob.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  USER_AGENT_CONTACT_URL: z.url().optional(),
  BRAVE_API_KEY: optionalSecret,
  MAX_CONTACTS_PER_SEARCH: int(20, 1),
  MIN_RELEVANCE_SCORE: int(35).pipe(z.number().max(100)),
  MAX_SEARCH_DURATION_MS: int(600_000, 1_000),
  MAX_HTTP_REQUESTS: int(300, 1),
  MAX_SEARCH_API_CALLS: int(40, 1),
  MAX_DEEP_SEARCH_REQUESTS: int(25, 1),
  MAX_CONCURRENT_REQUESTS: int(4, 1),
  PER_HOST_RPS: z.coerce.number().positive().default(1),
  REQUEST_TIMEOUT_MS: int(15_000, 100),
  RETRY_COUNT: int(3),
  SOURCE_FAILURE_THRESHOLD: int(3, 1),
  ENABLED_SOURCES: z
    .string()
    .default('web-search,registry,job-board,company-site,linkedin-public,press-events')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ENABLE_HEADLESS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DATA_RETENTION_DAYS: int(180, 1),
  EXPORT_DIR: z.string().min(1).default('./exports'),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Validates the environment, naming each missing or malformed variable. Never echoes values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const blanksRemoved = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = ConfigSchema.safeParse(blanksRemoved);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new ConfigError(`Invalid configuration in .env:\n${lines.join('\n')}`);
}

/** Resolves DATABASE_URL (`file:./path.db` or a bare path) to a filesystem path. */
export function databasePath(url: string): string {
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}
