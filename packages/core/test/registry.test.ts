import { describe, expect, it } from 'vitest';
import { AdapterRegistry, SourceHealth, normaliseSourceError, sourceFailure } from '../src';
import { fakeAdapter } from './helpers';

describe('AdapterRegistry', () => {
  it('enables only the configured adapters', () => {
    const registry = new AdapterRegistry([fakeAdapter({ id: 'a' }), fakeAdapter({ id: 'b' })], ['b']);
    expect(registry.enabled().map((a) => a.id)).toEqual(['b']);
    expect(registry.list().map((s) => [s.adapter.id, s.enabled])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('rejects an unknown adapter in the enabled list', () => {
    expect(() => new AdapterRegistry([fakeAdapter({ id: 'a' })], ['a', 'nope'])).toThrow(/nope/);
  });

  it('rejects duplicate adapter ids', () => {
    expect(() => new AdapterRegistry([fakeAdapter({ id: 'a' }), fakeAdapter({ id: 'a' })], [])).toThrow(/Duplicate/);
  });
});

describe('SourceHealth', () => {
  it('disables an adapter exactly at the threshold', () => {
    const health = new SourceHealth(3);
    expect(health.recordFailure('a')).toBe(false);
    expect(health.recordFailure('a')).toBe(false);
    expect(health.recordFailure('a')).toBe(true);
    expect(health.isDisabled('a')).toBe(true);
    expect(health.recordFailure('a')).toBe(false);
    expect(health.isDisabled('b')).toBe(false);
  });
});

describe('normaliseSourceError', () => {
  it('passes a SourceFailure through and marks timeouts retryable', () => {
    const error = normaliseSourceError('web', sourceFailure('web', 'Timeout', 'slow', 'https://x.test'));
    expect(error).toEqual({ kind: 'Timeout', adapter: 'web', url: 'https://x.test', retryable: true, message: 'slow' });
  });

  it('marks 4xx-type failures as not retryable', () => {
    expect(sourceFailure('web', 'RateLimited', '429').error.retryable).toBe(false);
  });

  it('turns anything else into Unknown', () => {
    expect(normaliseSourceError('web', 'string thrown')).toMatchObject({ kind: 'Unknown', message: 'string thrown' });
  });
});
