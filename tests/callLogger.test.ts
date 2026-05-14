import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  errorDetailForLog,
  sanitizeForLog,
  textForLog,
  writeCallLog,
} from '../src/utils/callLogger.js';
import { resetConfigForTests } from '../src/utils/config.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeJson } from './helpers/env.js';

let env: Record<string, string | undefined>;
let tempConfigPath: string;
let logDir: string;

beforeEach(async () => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  logDir = testTempPath('call-logs');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  await writeJson(tempConfigPath, {
    log: {
      call: {
        enabled: true,
        dir: logDir,
        includeText: true,
      },
    },
  });
  resetConfigForTests();
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
  await cleanupPath(logDir);
});

describe('call logger', () => {
  test('writes JSONL entries when enabled', async () => {
    await writeCallLog({
      event: 'tool.analyze_image.start',
      callId: 'call_test',
      sessionId: 'img_test',
      status: 'start',
      data: { prompt: 'describe it' },
    });

    const files = await readdir(logDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toEndWith('.jsonl');

    const lines = (await readFile(join(logDir, files[0]), 'utf8')).trim().split('\n');
    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe('tool.analyze_image.start');
    expect(entry.callId).toBe('call_test');
    expect(entry.sessionId).toBe('img_test');
    expect(entry.data.prompt).toBe('describe it');
  });

  test('does not create log files when disabled', async () => {
    await writeJson(tempConfigPath, {
      log: {
        call: {
          enabled: false,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();

    await writeCallLog({
      event: 'tool.analyze_image.start',
      data: { prompt: 'hidden' },
    });

    await expect(readdir(logDir)).rejects.toThrow();
  });

  test('masks sensitive fields and image payloads', () => {
    const sanitized = sanitizeForLog({
      authToken: 'token-1',
      apiKey: 'key-1',
      authorization: 'Bearer token',
      password: 'pw',
      nested: {
        secret: 'secret-1',
        base64: 'abc123',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'raw-image',
        },
      },
    }) as Record<string, unknown>;

    expect(sanitized.authToken).toBe('********');
    expect(sanitized.apiKey).toBe('********');
    expect(sanitized.authorization).toBe('********');
    expect(sanitized.password).toBe('********');
    expect((sanitized.nested as Record<string, unknown>).secret).toBe('********');
    expect((sanitized.nested as Record<string, unknown>).base64).toBe('********');
    expect(((sanitized.nested as Record<string, unknown>).source as Record<string, unknown>).data).toBe('********');
    expect(((sanitized.nested as Record<string, unknown>).source as Record<string, unknown>).media_type).toBe('image/png');
    expect(sanitizeForLog({ authToken: '' })).toEqual({ authToken: '' });
    expect(sanitizeForLog({ maxTokens: 123 })).toEqual({ maxTokens: 123 });
  });

  test('masks sensitive URL query parameters', () => {
    const sanitized = sanitizeForLog({
      source: 'https://example.test/image.png?token=abc&signature=sig&ok=1&api_key=key',
    }) as { source: string };

    expect(sanitized.source).toContain('token=********');
    expect(sanitized.source).toContain('signature=********');
    expect(sanitized.source).toContain('api_key=********');
    expect(sanitized.source).toContain('ok=1');
  });

  test('summarizes text when includeText is false', async () => {
    await writeJson(tempConfigPath, {
      log: {
        call: {
          enabled: true,
          dir: logDir,
          includeText: false,
        },
      },
    });
    resetConfigForTests();

    const summary = textForLog('secret prompt') as { length: number; sha256: string };

    expect(summary.length).toBe('secret prompt'.length);
    expect(summary.sha256).toHaveLength(64);
  });

  test('serializes error details and masks sensitive nested fields', () => {
    const cause = new Error('socket failed');
    const error = Object.assign(new Error('request failed'), {
      status: 401,
      code: 'unauthorized',
      type: 'invalid_request_error',
      request_id: 'req_123',
      headers: {
        authorization: 'Bearer test-token',
        'x-request-id': 'req_123',
      },
      body: {
        message: 'bad token',
        token: 'test-token',
      },
      cause,
    });

    const detail = sanitizeForLog(errorDetailForLog(error)) as Record<string, any>;

    expect(detail.name).toBe('Error');
    expect(detail.message).toBe('request failed');
    expect(detail.status).toBe(401);
    expect(detail.code).toBe('unauthorized');
    expect(detail.type).toBe('invalid_request_error');
    expect(detail.requestId).toBe('req_123');
    expect(detail.headers.authorization).toBe('********');
    expect(detail.headers['x-request-id']).toBe('req_123');
    expect(detail.body.token).toBe('********');
    expect(detail.cause.message).toBe('socket failed');
  });
});
