import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { expandPath, getConfig, resetConfigForTests } from '../src/utils/config.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeJson } from './helpers/env.js';

let env: Record<string, string | undefined>;
let tempConfigPath: string;

beforeEach(() => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  resetConfigForTests();
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
});

describe('config', () => {
  test('uses built-in defaults when config file is missing', () => {
    const config = getConfig();

    expect(config.api.model).toBe('openai/qwen3.6-plus');
    expect(config.api.maxTokens).toBe(64_000);
    expect(config.api.authToken).toBe('');
    expect(config.cache.ttlHours).toBe(24);
    expect(config.cache.maxMb).toBe(500);
    expect(config.image.fetchTimeoutMs).toBe(30_000);
    expect(config.log.level).toBe('info');
  });

  test('reads nested values from config file', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'file-token',
        baseUrl: 'https://example.test',
        model: 'file-model',
        maxTokens: 123,
        defaultPrompt: 'file prompt',
      },
      cache: {
        dir: '~/custom-cache',
        ttlHours: 2,
        maxMb: 3,
        lockTimeoutMs: 4,
      },
      image: {
        fetchTimeoutMs: 5,
        maxBytes: 6,
      },
      log: {
        level: 'debug',
      },
    });
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('file-token');
    expect(config.api.baseUrl).toBe('https://example.test');
    expect(config.api.model).toBe('file-model');
    expect(config.api.maxTokens).toBe(123);
    expect(config.api.defaultPrompt).toBe('file prompt');
    expect(config.cache.dir).toBe('~/custom-cache');
    expect(config.cache.ttlHours).toBe(2);
    expect(config.cache.maxMb).toBe(3);
    expect(config.cache.lockTimeoutMs).toBe(4);
    expect(config.image.fetchTimeoutMs).toBe(5);
    expect(config.image.maxBytes).toBe(6);
    expect(config.log.level).toBe('debug');
  });

  test('environment variables override config file', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'file-token',
        baseUrl: 'https://file.test',
        model: 'file-model',
        maxTokens: 100,
      },
      cache: {
        ttlHours: 10,
      },
    });
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-token';
    process.env.ANTHROPIC_BASE_URL = 'https://env.test';
    process.env.QWEN_MODEL = 'env-model';
    process.env.VISION_MAX_TOKENS = '200';
    process.env.CACHE_TTL_HOURS = '20';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('env-token');
    expect(config.api.baseUrl).toBe('https://env.test');
    expect(config.api.model).toBe('env-model');
    expect(config.api.maxTokens).toBe(200);
    expect(config.cache.ttlHours).toBe(20);
  });

  test('invalid numeric and log values fall back to defaults', async () => {
    await writeJson(tempConfigPath, {
      api: {
        maxTokens: -1,
      },
      cache: {
        ttlHours: 0,
      },
      log: {
        level: 'verbose',
      },
    });
    process.env.IMAGE_MAX_BYTES = 'not-a-number';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.maxTokens).toBe(64_000);
    expect(config.cache.ttlHours).toBe(24);
    expect(config.image.maxBytes).toBe(20 * 1024 * 1024);
    expect(config.log.level).toBe('info');
  });

  test('expands tilde paths', () => {
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('~/cache')).toBe(join(homedir(), 'cache'));
  });
});
