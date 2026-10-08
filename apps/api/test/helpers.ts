import type { SourceAdapter } from '@scrapjob/core';
import { buildApp, type BuiltApp } from '../src/app';
import { loadConfig } from '../src/config';

export function testApp(env: Record<string, string> = {}, adapters?: readonly SourceAdapter[]): BuiltApp {
  const config = loadConfig({ LOG_LEVEL: 'silent', ...env });
  return buildApp(config, { databasePath: ':memory:', logger: false, ...(adapters ? { adapters } : {}) });
}
