import type { SourceAdapter } from '@scrapjob/core';

/**
 * A source that is always available and never finds anything. It exists so the
 * Phase 1 pipeline runs end to end without network access or fake data.
 */
export const noopAdapter: SourceAdapter = {
  id: 'noop',
  displayName: 'No-op source',
  capabilities: new Set(['companies']),
  isAvailable: async () => true,
  discoverCompanies: async function* () {},
  discoverJobs: async function* () {},
  discoverPeople: async function* () {},
  enrich: async () => [],
};
