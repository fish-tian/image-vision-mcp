import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ApiError } from '../src/utils/errors.js';
import { imageFromBuffer, inferMimeType, readImageSource } from '../src/utils/imageReader.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeBinary, writeJson } from './helpers/env.js';
import { resetConfigForTests } from '../src/utils/config.js';

let env: Record<string, string | undefined>;
let tempConfigPath: string;
let logDir: string;

beforeEach(() => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  logDir = testTempPath('call-logs');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  resetConfigForTests();
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
  await cleanupPath(logDir);
});

describe('imageReader', () => {
  test('infers common image MIME types', () => {
    expect(inferMimeType('photo.JPG')).toBe('image/jpeg');
    expect(inferMimeType('diagram.png?version=1')).toBe('image/png');
    expect(inferMimeType('icon.webp')).toBe('image/webp');
    expect(inferMimeType('unknown.bin')).toBe('application/octet-stream');
  });

  test('converts buffer to ImageData with base64 and sha256 hash', () => {
    const buffer = Buffer.from('abc');
    const image = imageFromBuffer(buffer, 'image/png');

    expect(image.base64).toBe(buffer.toString('base64'));
    expect(image.mediaType).toBe('image/png');
    expect(image.size).toBe(3);
    expect(image.hash).toBe(createHash('sha256').update(buffer).digest('hex'));
  });

  test('reads local image source', async () => {
    const imagePath = testTempPath('sample.png');
    await writeBinary(imagePath, new Uint8Array([1, 2, 3, 4]));

    const image = await readImageSource(imagePath);

    expect(image.mediaType).toBe('image/png');
    expect(image.size).toBe(4);
    expect(image.base64).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));

    await cleanupPath(imagePath);
  });

  test('writes local image read call logs without image payload', async () => {
    await writeJson(tempConfigPath, {
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    const imagePath = testTempPath('logged.png');
    await writeBinary(imagePath, new Uint8Array([1, 2, 3, 4]));

    const image = await readImageSource(imagePath, 'call_image_local');

    const entries = await readLogEntries();
    const start = entries.find((entry) => entry.event === 'image.read.start');
    const success = entries.find((entry) => entry.event === 'image.read.success');
    expect(start?.callId).toBe('call_image_local');
    expect(start?.data.sourceType).toBe('file');
    expect(success?.callId).toBe('call_image_local');
    expect(success?.data.size).toBe(4);
    expect(success?.data.mediaType).toBe('image/png');
    expect(success?.data.hashPrefix).toBe(image.hash.slice(0, 12));
    expect(JSON.stringify(entries)).not.toContain(image.base64);

    await cleanupPath(imagePath);
  });

  test('rejects local image over configured maxBytes', async () => {
    await writeJson(tempConfigPath, {
      image: {
        maxBytes: 3,
      },
    });
    resetConfigForTests();
    const imagePath = testTempPath('large.png');
    await writeBinary(imagePath, new Uint8Array([1, 2, 3, 4]));

    await expect(readImageSource(imagePath)).rejects.toBeInstanceOf(ApiError);

    await cleanupPath(imagePath);
  });

  test('downloads URL image with content type', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(
      new Response(new Uint8Array([5, 6]), {
        headers: { 'content-type': 'image/png', 'content-length': '2' },
      }),
    )) as typeof fetch;

    try {
      const image = await readImageSource('https://example.test/image.png');

      expect(image.mediaType).toBe('image/png');
      expect(image.size).toBe(2);
      expect(image.base64).toBe(Buffer.from([5, 6]).toString('base64'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('writes URL image read logs with sanitized source', async () => {
    await writeJson(tempConfigPath, {
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(
      new Response(new Uint8Array([5, 6]), {
        headers: { 'content-type': 'image/png', 'content-length': '2' },
      }),
    )) as typeof fetch;

    try {
      const image = await readImageSource(
        'https://example.test/image.png?token=abc&signature=sig&api_key=key&ok=1',
        'call_image_url',
      );

      const entries = await readLogEntries();
      const success = entries.find((entry) => entry.event === 'image.read.success');
      expect(success?.callId).toBe('call_image_url');
      expect(success?.data.source).toContain('token=********');
      expect(success?.data.source).toContain('signature=********');
      expect(success?.data.source).toContain('api_key=********');
      expect(success?.data.source).toContain('ok=1');
      expect(success?.data.contentType).toBe('image/png');
      expect(success?.data.contentLength).toBe(2);
      expect(JSON.stringify(entries)).not.toContain(image.base64);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects URL image when content-length exceeds maxBytes', async () => {
    await writeJson(tempConfigPath, {
      image: {
        maxBytes: 3,
      },
    });
    resetConfigForTests();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'image/png', 'content-length': '4' },
      }),
    )) as typeof fetch;

    try {
      await expect(readImageSource('https://example.test/large.png')).rejects.toBeInstanceOf(ApiError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('writes image read error logs', async () => {
    await writeJson(tempConfigPath, {
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();

    await expect(readImageSource(testTempPath('missing.png'), 'call_image_error')).rejects.toBeInstanceOf(ApiError);

    const entries = await readLogEntries();
    const error = entries.find((entry) => entry.event === 'image.read.error');
    expect(error?.callId).toBe('call_image_error');
    expect(error?.status).toBe('error');
    expect(error?.data.sourceType).toBe('file');
    expect(error?.data.errorDetail.message).toContain('ENOENT');
  });
});

async function readLogEntries(): Promise<Array<Record<string, any>>> {
  const files = await readdir(logDir);
  const text = await readFile(join(logDir, files[0]), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}
