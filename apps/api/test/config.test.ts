import { describe, expect, it } from 'vitest';
import { ConfigError, databasePath, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('starts with an empty environment and documented defaults', () => {
    const config = loadConfig({});
    expect(config.PORT).toBe(3001);
    expect(config.MAX_CONTACTS_PER_SEARCH).toBe(20);
    expect(config.MIN_RELEVANCE_SCORE).toBe(35);
    expect(config.ENABLED_SOURCES).toEqual(['employer-list', 'web-search', 'registry', 'job-board', 'company-site', 'linkedin-public', 'press-events']);
    expect(config.ENABLE_HEADLESS).toBe(false);
    expect(config.BRAVE_API_KEY).toBeUndefined();
  });

  it('treats blank values as missing', () => {
    expect(loadConfig({ BRAVE_API_KEY: '', PORT: '' }).PORT).toBe(3001);
  });

  it('parses lists and numbers', () => {
    const config = loadConfig({ ENABLED_SOURCES: ' noop , web-search ', PORT: '4000' });
    expect(config.ENABLED_SOURCES).toEqual(['noop', 'web-search']);
    expect(config.PORT).toBe(4000);
  });

  it('names every malformed variable and never echoes its value', () => {
    const attempt = () => loadConfig({ PORT: 'abc', USER_AGENT_CONTACT_URL: 'secret-not-a-url', ENABLE_HEADLESS: 'yes' });
    expect(attempt).toThrow(ConfigError);
    try {
      attempt();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/PORT/);
      expect(message).toMatch(/USER_AGENT_CONTACT_URL/);
      expect(message).toMatch(/ENABLE_HEADLESS/);
      expect(message).not.toMatch(/secret-not-a-url/);
    }
  });
});

describe('databasePath', () => {
  it('strips the file: prefix', () => {
    expect(databasePath('file:./data/x.db')).toBe('./data/x.db');
    expect(databasePath('/tmp/x.db')).toBe('/tmp/x.db');
  });
});
