import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  createSession,
  expandStoredMessages,
  imageRefsToBlocks,
  initCache,
  readSession,
  updateHistory,
  withLock,
  type StoredMessageParam,
} from '../src/utils/cache.js';
import { resetConfigForTests } from '../src/utils/config.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeJson } from './helpers/env.js';

let env: Record<string, string | undefined>;
let tempConfigPath: string;
let cacheDir: string;
let logDir: string;

beforeEach(async () => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  cacheDir = testTempPath('cache');
  logDir = testTempPath('call-logs');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  await writeJson(tempConfigPath, {
    cache: {
      dir: cacheDir,
      ttlHours: 24,
      maxMb: 500,
      lockTimeoutMs: 500,
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
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
  await cleanupPath(cacheDir);
  await cleanupPath(logDir);
});

describe('cache', () => {
  test('creates session metadata, history, and shared image blob', async () => {
    const image = {
      base64: Buffer.from('image-data').toString('base64'),
      mediaType: 'image/png',
      size: 10,
      hash: 'hash-a',
    };

    const sessionId = await createSession([image]);
    const session = await readSession(sessionId);

    expect(session?.meta.sessionId).toBe(sessionId);
    expect(session?.meta.imageRefs).toEqual([{ hash: 'hash-a', mediaType: 'image/png', size: 10 }]);
    expect(session?.history.messages).toEqual([]);
    expect(session?.images.get('hash-a')?.base64).toBe(image.base64);

    const imageFiles = await readdir(join(cacheDir, 'images'));
    expect(imageFiles).toEqual(['hash-a.bin']);
  });

  test('updates only history file for follow-up messages', async () => {
    const image = {
      base64: Buffer.from('image-data').toString('base64'),
      mediaType: 'image/png',
      size: 10,
      hash: 'hash-b',
    };
    const sessionId = await createSession([image]);
    const metaPath = join(cacheDir, 'sessions', `${sessionId}.meta.json`);
    const imagePath = join(cacheDir, 'images', 'hash-b.bin');
    const beforeMeta = await stat(metaPath);
    const beforeImage = await stat(imagePath);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const messages: StoredMessageParam[] = [
      {
        role: 'user',
        content: [
          ...imageRefsToBlocks([{ hash: 'hash-b', mediaType: 'image/png', size: 10 }]),
          { type: 'text', text: 'Describe it.' },
        ],
      },
      { role: 'assistant', content: 'A test image.' },
    ];
    await updateHistory(sessionId, messages);

    const history = JSON.parse(await readFile(join(cacheDir, 'sessions', `${sessionId}.history.json`), 'utf8'));
    const afterMeta = await stat(metaPath);
    const afterImage = await stat(imagePath);

    expect(history.messages).toEqual(messages);
    expect(afterMeta.mtimeMs).toBeGreaterThan(beforeMeta.mtimeMs);
    expect(afterImage.mtimeMs).toBe(beforeImage.mtimeMs);
  });

  test('writes session create, read, update, and miss call logs', async () => {
    const image = {
      base64: Buffer.from('image-data').toString('base64'),
      mediaType: 'image/png',
      size: 10,
      hash: 'hash-logs',
    };
    const sessionId = await createSession([image], undefined, 'call_cache');
    const messages: StoredMessageParam[] = [{ role: 'assistant', content: 'A test image.' }];

    const session = await readSession(sessionId, 'call_cache');
    await updateHistory(sessionId, messages, 'call_cache');
    const missing = await readSession('img_missing', 'call_cache');

    expect(session?.meta.sessionId).toBe(sessionId);
    expect(missing).toBeNull();

    const entries = await readLogEntries();
    const create = entries.find((entry) => entry.event === 'cache.session.create' && entry.sessionId === sessionId);
    const readHit = entries.find(
      (entry) => entry.event === 'cache.session.read' && entry.sessionId === sessionId && entry.data.hit === true,
    );
    const update = entries.find((entry) => entry.event === 'cache.session.update' && entry.sessionId === sessionId);
    const readMiss = entries.find(
      (entry) => entry.event === 'cache.session.read' && entry.sessionId === 'img_missing' && entry.data.hit === false,
    );

    expect(create?.callId).toBe('call_cache');
    expect(create?.data.imageCount).toBe(1);
    expect(create?.data.totalBytes).toBe(10);
    expect(readHit?.data.imageCount).toBe(1);
    expect(readHit?.data.messageCount).toBe(0);
    expect(update?.data.messageCount).toBe(1);
    expect(readMiss?.callId).toBe('call_cache');
  });

  test('expands stored image refs into Anthropic image blocks', async () => {
    const image = {
      base64: Buffer.from('abc').toString('base64'),
      mediaType: 'image/png',
      size: 3,
      hash: 'hash-c',
    };
    const messages: StoredMessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'image_ref', hash: 'hash-c', media_type: 'image/png' },
          { type: 'text', text: 'What is this?' },
        ],
      },
    ];

    const expanded = expandStoredMessages(messages, new Map([['hash-c', image]]));

    expect(expanded[0].content).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: image.base64,
        },
      },
      { type: 'text', text: 'What is this?' },
    ]);
  });

  test('withLock runs critical section and releases lock file', async () => {
    await initCache();
    await mkdir(join(cacheDir, 'locks'), { recursive: true });

    const result = await withLock('lock-test', async () => 'ok');

    expect(result).toBe('ok');
    const lockFiles = await readdir(join(cacheDir, 'locks'));
    expect(lockFiles).toEqual([]);
  });

  test('expired sessions are removed on read', async () => {
    await writeJson(tempConfigPath, {
      cache: {
        dir: cacheDir,
        ttlHours: 0.000001,
        maxMb: 500,
        lockTimeoutMs: 500,
      },
    });
    resetConfigForTests();
    const image = {
      base64: Buffer.from('old-image').toString('base64'),
      mediaType: 'image/png',
      size: 9,
      hash: 'hash-expired',
    };
    const sessionId = await createSession([image]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(readSession(sessionId)).rejects.toThrow('Session expired');

    const sessionFiles = await readdir(join(cacheDir, 'sessions'));
    expect(sessionFiles).toEqual([]);
  });
});

async function readLogEntries(): Promise<Array<Record<string, any>>> {
  const files = await readdir(logDir);
  const text = await readFile(join(logDir, files[0]), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}
