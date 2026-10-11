import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Employer, SourceAdapter } from '@scrapjob/core';
import { buildApp, type BuiltApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { Transport } from '../src/http/transport';
import { virtualClock } from './fixtures/transport';

export const configDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../config');

export interface TestAppOptions {
  adapters?: readonly SourceAdapter[];
  transport?: Transport;
  employers?: readonly Employer[];
}

export function testApp(env: Record<string, string> = {}, options: TestAppOptions | readonly SourceAdapter[] = {}): BuiltApp {
  const opts: TestAppOptions = Array.isArray(options) ? { adapters: options as readonly SourceAdapter[] } : (options as TestAppOptions);
  const config = loadConfig({ LOG_LEVEL: 'silent', ENABLED_SOURCES: 'noop', ...env });
  return buildApp(config, {
    databasePath: ':memory:',
    configDir,
    exportDir: mkdtempSync(join(tmpdir(), 'scrapjob-exports-')),
    logger: false,
    clock: virtualClock(),
    ...(opts.adapters ? { adapters: opts.adapters } : {}),
    ...(opts.transport ? { transport: opts.transport } : {}),
    employers: opts.employers ?? [],
  });
}
