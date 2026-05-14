import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { initCache } from '../src/utils/cache.js';
import { resetConfigForTests } from '../src/utils/config.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeBinary, writeJson } from './helpers/env.js';

let streamMock = mock(() => ({
  async *[Symbol.asyncIterator]() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'mocked ' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } };
  },
}));

mock.module('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      stream: streamMock,
    };
  },
}));

const { analyzeImage } = await import('../src/utils/qwenApi.js');

let env: Record<string, string | undefined>;
let tempConfigPath: string;
let cacheDir: string;
let logDir: string;
let imagePath: string;

beforeEach(async () => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  cacheDir = testTempPath('cache');
  logDir = testTempPath('call-logs');
  imagePath = testTempPath('image.png');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  streamMock = mock(() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'mocked ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } };
    },
  }));
  await writeBinary(imagePath, new Uint8Array([137, 80, 78, 71]));
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
  await cleanupPath(cacheDir);
  await cleanupPath(logDir);
  await cleanupPath(imagePath);
});

describe('qwen API call logging', () => {
  test('writes API request and response call logs', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
        model: 'test-model',
        maxTokens: 123,
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
          includeText: true,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    const result = await analyzeImage([imagePath], null, 'describe token=plain', 'call_test');

    expect(result.result).toBe('mocked result');
    expect(streamMock).toHaveBeenCalledTimes(1);

    const entries = await readLogEntries();
    const request = entries.find((entry) => entry.event === 'api.vision.request');
    const response = entries.find((entry) => entry.event === 'api.vision.response');

    expect(request?.callId).toBe('call_test');
    expect(request?.sessionId).toBe(result.session_id);
    expect(request?.data.model).toBe('test-model');
    expect(request?.data.maxTokens).toBe(123);
    expect(request?.data.imageCount).toBe(1);
    expect(JSON.stringify(request)).not.toContain('test-token');
    expect(JSON.stringify(request)).not.toContain(Buffer.from(new Uint8Array([137, 80, 78, 71])).toString('base64'));
    expect(response?.data.result).toBe('mocked result');
    expect(response?.data.textLength).toBe('mocked result'.length);
  });

  test('writes API error call log when token is missing', async () => {
    await writeJson(tempConfigPath, {
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    await expect(analyzeImage([imagePath], null, 'describe', 'call_missing_token')).rejects.toThrow('ANTHROPIC_AUTH_TOKEN');

    const entries = await readLogEntries();
    const error = entries.find((entry) => entry.event === 'api.vision.error');
    expect(error?.callId).toBe('call_missing_token');
    expect(error?.status).toBe('error');
    expect(error?.data.error).toContain('API_TOKEN_MISSING');
  });
});

async function readLogEntries(): Promise<Array<Record<string, any>>> {
  const files = await readdir(logDir);
  const text = await readFile(join(logDir, files[0]), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}
