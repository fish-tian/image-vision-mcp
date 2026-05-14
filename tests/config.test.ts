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
    expect(config.api.authTokenSource).toBe('missing');
    expect(config.cache.ttlHours).toBe(24);
    expect(config.cache.maxMb).toBe(500);
    expect(config.image.fetchTimeoutMs).toBe(30_000);
    expect(config.log.level).toBe('info');
    expect(config.log.call.enabled).toBe(true);
    expect(config.log.call.dir).toBe('~/.image-vision-mcp/call-logs');
    expect(config.log.call.includeText).toBe(true);
    expect(config.diagnostics.enabled).toBe(true);
    expect(config.diagnostics.model).toBe('');
    expect(config.diagnostics.maxTokens).toBe(1_000);
    expect(config.diagnostics.timeoutMs).toBe(8_000);
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
        call: {
          enabled: false,
          dir: '~/custom-call-logs',
          includeText: false,
        },
      },
      diagnostics: {
        enabled: false,
        model: 'file-diagnostic-model',
        maxTokens: 222,
        timeoutMs: 333,
      },
    });
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('file-token');
    expect(config.api.authTokenSource).toBe('config');
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
    expect(config.log.call.enabled).toBe(false);
    expect(config.log.call.dir).toBe('~/custom-call-logs');
    expect(config.log.call.includeText).toBe(false);
    expect(config.diagnostics.enabled).toBe(false);
    expect(config.diagnostics.model).toBe('file-diagnostic-model');
    expect(config.diagnostics.maxTokens).toBe(222);
    expect(config.diagnostics.timeoutMs).toBe(333);
  });

  test('non-empty config values override environment variables', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'file-token',
        baseUrl: 'https://file.test',
        model: 'file-model',
        maxTokens: 100,
      },
      diagnostics: {
        model: 'file-diagnostic-model',
        maxTokens: 300,
        timeoutMs: 400,
      },
      cache: {
        ttlHours: 10,
      },
    });
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-token';
    process.env.ANTHROPIC_BASE_URL = 'https://env.test';
    process.env.QWEN_MODEL = 'env-model';
    process.env.ANTHROPIC_MODEL = 'env-diagnostic-model';
    process.env.VISION_MAX_TOKENS = '200';
    process.env.DIAGNOSTICS_MAX_TOKENS = '500';
    process.env.DIAGNOSTICS_TIMEOUT_MS = '600';
    process.env.DIAGNOSTICS_ENABLED = 'false';
    process.env.CACHE_TTL_HOURS = '20';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('file-token');
    expect(config.api.authTokenSource).toBe('config');
    expect(config.api.baseUrl).toBe('https://file.test');
    expect(config.api.model).toBe('file-model');
    expect(config.api.maxTokens).toBe(100);
    expect(config.diagnostics.enabled).toBe(false);
    expect(config.diagnostics.model).toBe('file-diagnostic-model');
    expect(config.diagnostics.maxTokens).toBe(300);
    expect(config.diagnostics.timeoutMs).toBe(400);
    expect(config.cache.ttlHours).toBe(10);
  });

  test('uses environment variables when config file is missing', () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-token';
    process.env.ANTHROPIC_BASE_URL = 'https://env.test';
    process.env.QWEN_MODEL = 'env-model';
    process.env.ANTHROPIC_MODEL = 'env-diagnostic-model';
    process.env.VISION_MAX_TOKENS = '200';
    process.env.DIAGNOSTICS_MAX_TOKENS = '500';
    process.env.DIAGNOSTICS_TIMEOUT_MS = '600';
    process.env.DIAGNOSTICS_ENABLED = 'false';
    process.env.CALL_LOG_ENABLED = 'false';
    process.env.CALL_LOG_DIR = '~/env-call-logs';
    process.env.CALL_LOG_INCLUDE_TEXT = 'false';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('env-token');
    expect(config.api.authTokenSource).toBe('env');
    expect(config.api.baseUrl).toBe('https://env.test');
    expect(config.api.model).toBe('env-model');
    expect(config.api.maxTokens).toBe(200);
    expect(config.diagnostics.enabled).toBe(false);
    expect(config.diagnostics.model).toBe('env-diagnostic-model');
    expect(config.diagnostics.maxTokens).toBe(500);
    expect(config.diagnostics.timeoutMs).toBe(600);
    expect(config.log.call.enabled).toBe(false);
    expect(config.log.call.dir).toBe('~/env-call-logs');
    expect(config.log.call.includeText).toBe(false);
  });

  test('empty config strings do not override environment variables', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: '',
        baseUrl: '',
        model: '',
        defaultPrompt: '',
      },
      diagnostics: {
        model: '',
      },
    });
    process.env.ANTHROPIC_AUTH_TOKEN = 'env-token';
    process.env.ANTHROPIC_BASE_URL = 'https://env.test';
    process.env.QWEN_MODEL = 'env-model';
    process.env.ANTHROPIC_MODEL = 'env-diagnostic-model';
    process.env.VISION_DEFAULT_PROMPT = 'env prompt';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.authToken).toBe('env-token');
    expect(config.api.authTokenSource).toBe('env');
    expect(config.api.baseUrl).toBe('https://env.test');
    expect(config.api.model).toBe('env-model');
    expect(config.api.defaultPrompt).toBe('env prompt');
    expect(config.diagnostics.model).toBe('env-diagnostic-model');
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
        call: {
          enabled: 'nope',
          includeText: 'nope',
        },
      },
    });
    process.env.IMAGE_MAX_BYTES = 'not-a-number';
    resetConfigForTests();

    const config = getConfig();

    expect(config.api.maxTokens).toBe(64_000);
    expect(config.cache.ttlHours).toBe(24);
    expect(config.image.maxBytes).toBe(20 * 1024 * 1024);
    expect(config.log.level).toBe('info');
    expect(config.log.call.enabled).toBe(true);
    expect(config.log.call.includeText).toBe(true);
  });

  test('expands tilde paths', () => {
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('~/cache')).toBe(join(homedir(), 'cache'));
  });

});
