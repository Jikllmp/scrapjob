import type { SourceAdapter } from './types';

export interface RegisteredSource {
  adapter: SourceAdapter;
  enabled: boolean;
}

/** Static list of known adapters and whether configuration enables them. */
export class AdapterRegistry {
  private readonly sources = new Map<string, RegisteredSource>();

  constructor(adapters: readonly SourceAdapter[], enabledIds: readonly string[]) {
    const enabled = new Set(enabledIds);
    for (const adapter of adapters) {
      if (this.sources.has(adapter.id)) throw new Error(`Duplicate adapter id: ${adapter.id}`);
      this.sources.set(adapter.id, { adapter, enabled: enabled.has(adapter.id) });
    }
    const unknown = enabledIds.filter((id) => !this.sources.has(id));
    if (unknown.length > 0) throw new Error(`ENABLED_SOURCES names unknown adapters: ${unknown.join(', ')}`);
  }

  list(): RegisteredSource[] {
    return [...this.sources.values()];
  }

  enabled(): SourceAdapter[] {
    return this.list()
      .filter((s) => s.enabled)
      .map((s) => s.adapter);
  }
}

/** Per-search health: an adapter that fails `threshold` times in one search is disabled for that search. */
export class SourceHealth {
  private readonly failures = new Map<string, number>();
  private readonly disabled = new Set<string>();

  constructor(private readonly threshold: number) {}

  /** Records a failure and returns true if this failure disabled the adapter. */
  recordFailure(adapterId: string): boolean {
    if (this.disabled.has(adapterId)) return false;
    const count = (this.failures.get(adapterId) ?? 0) + 1;
    this.failures.set(adapterId, count);
    if (count >= this.threshold) {
      this.disabled.add(adapterId);
      return true;
    }
    return false;
  }

  disable(adapterId: string): void {
    this.disabled.add(adapterId);
  }

  isDisabled(adapterId: string): boolean {
    return this.disabled.has(adapterId);
  }

  failureCount(adapterId: string): number {
    return this.failures.get(adapterId) ?? 0;
  }
}
