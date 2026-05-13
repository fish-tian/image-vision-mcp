import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import type { ImageData } from './imageReader.js';
import { imageFromBuffer } from './imageReader.js';
import { CacheError } from './errors.js';
import { logger } from './logger.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 500 * 1024 * 1024;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 75;

const CACHE_ROOT = join(homedir(), '.image-vision-cache');
const SESSIONS_DIR = join(CACHE_ROOT, 'sessions');
const IMAGES_DIR = join(CACHE_ROOT, 'images');
const LOCKS_DIR = join(CACHE_ROOT, 'locks');

export interface ImageRef {
  hash: string;
  mediaType: string;
  size: number;
}

export interface SessionMeta {
  sessionId: string;
  createdAt: number;
  lastAccessAt: number;
  imageRefs: ImageRef[];
}

export interface StoredImageBlock {
  type: 'image_ref';
  hash: string;
  media_type: string;
}

export type StoredContentBlock =
  | Anthropic.Messages.TextBlockParam
  | StoredImageBlock;

export interface StoredMessageParam {
  role: Anthropic.Messages.MessageParam['role'];
  content: string | StoredContentBlock[];
}

export interface SessionHistory {
  sessionId: string;
  messages: StoredMessageParam[];
  updatedAt: number;
}

export interface SessionData {
  meta: SessionMeta;
  history: SessionHistory;
  images: Map<string, ImageData>;
}

export class SessionLock {
  private lockPath: string;
  private handle: Awaited<ReturnType<typeof open>> | null = null;

  constructor(private sessionId: string) {
    this.lockPath = lockPath(sessionId);
  }

  async acquire(): Promise<boolean> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      try {
        this.handle = await open(this.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
        await this.handle.writeFile(JSON.stringify({ sessionId: this.sessionId, pid: process.pid, createdAt: Date.now() }));
        return true;
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw new CacheError('LOCK_TIMEOUT', `Failed to acquire lock for session ${this.sessionId}`, error);
        }

        await sleep(LOCK_RETRY_MS);
      }
    }

    return false;
  }

  async release(): Promise<void> {
    try {
      await this.handle?.close();
      this.handle = null;
      await rm(this.lockPath, { force: true });
    } catch (error) {
      throw new CacheError('LOCK_RELEASE_FAILED', `Failed to release lock for session ${this.sessionId}`, error);
    }
  }
}

export async function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const lock = new SessionLock(sessionId);
  const acquired = await lock.acquire();

  if (!acquired) {
    throw new CacheError('LOCK_TIMEOUT', `Timed out waiting for lock on session ${sessionId}`);
  }

  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

export async function migrateOldCache(): Promise<void> {
  logger.info('cache', 'old cache migration skipped');
}

export async function initCache(): Promise<void> {
  try {
    await Promise.all([
      mkdir(SESSIONS_DIR, { recursive: true }),
      mkdir(IMAGES_DIR, { recursive: true }),
      mkdir(LOCKS_DIR, { recursive: true }),
    ]);

    const cleanup = await cleanupExpiredSessions();
    logger.info('cache', 'cache initialized', cleanup);
  } catch (error) {
    throw new CacheError('CACHE_INIT_FAILED', 'Failed to initialize cache', error);
  }
}

export async function createSession(images: ImageData[], _prompt?: string): Promise<string> {
  const sessionId = `img_${randomUUID().replaceAll('-', '')}`;
  const now = Date.now();
  const imageRefs = images.map(({ hash, mediaType, size }) => ({ hash, mediaType, size }));
  const meta: SessionMeta = { sessionId, createdAt: now, lastAccessAt: now, imageRefs };
  const history: SessionHistory = { sessionId, messages: [], updatedAt: now };

  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    await mkdir(IMAGES_DIR, { recursive: true });

    for (const image of images) {
      const path = imagePath(image.hash);
      if (!(await exists(path))) {
        await writeFile(path, Buffer.from(image.base64, 'base64'));
      }
    }

    await atomicWriteJson(metaPath(sessionId), meta);
    await atomicWriteJson(historyPath(sessionId), history);
    logger.info('cache', 'created session', { sessionId, imageCount: images.length });
    return sessionId;
  } catch (error) {
    throw new CacheError('CACHE_WRITE_FAILED', `Failed to create session ${sessionId}`, error);
  }
}

export async function readSession(sessionId: string): Promise<SessionData | null> {
  try {
    const meta = await readJson<SessionMeta>(metaPath(sessionId));

    if (!meta) {
      return null;
    }

    if (isExpired(meta)) {
      await deleteSession(sessionId);
      await cleanupUnreferencedImages();
      throw new CacheError('SESSION_EXPIRED', `Session expired: ${sessionId}`);
    }

    const history = await readJson<SessionHistory>(historyPath(sessionId));
    if (!history) {
      return null;
    }

    const images = new Map<string, ImageData>();
    for (const ref of meta.imageRefs) {
      const buffer = await readFile(imagePath(ref.hash));
      images.set(ref.hash, imageFromBuffer(buffer, ref.mediaType));
    }

    await touchSession(meta);
    return { meta: { ...meta, lastAccessAt: Date.now() }, history, images };
  } catch (error) {
    if (error instanceof CacheError) {
      throw error;
    }

    throw new CacheError('CACHE_READ_FAILED', `Failed to read session ${sessionId}`, error);
  }
}

export async function updateHistory(
  sessionId: string,
  messages: StoredMessageParam[],
): Promise<void> {
  try {
    const history: SessionHistory = {
      sessionId,
      messages,
      updatedAt: Date.now(),
    };

    await atomicWriteJson(historyPath(sessionId), history);
    const meta = await readJson<SessionMeta>(metaPath(sessionId));
    if (meta) {
      await touchSession(meta);
    }

    logger.info('cache', 'updated history', { sessionId, messageCount: messages.length });
  } catch (error) {
    throw new CacheError('CACHE_WRITE_FAILED', `Failed to update history for session ${sessionId}`, error);
  }
}

export async function cleanupExpiredSessions(): Promise<{ cleaned: number; freedBytes: number }> {
  try {
    let cleaned = 0;
    let freedBytes = 0;
    const metas = await listMetas();

    for (const meta of metas) {
      if (isExpired(meta)) {
        freedBytes += await sessionFileBytes(meta.sessionId);
        await deleteSession(meta.sessionId);
        cleaned += 1;
      }
    }

    let total = await cacheSizeBytes();
    if (total > MAX_CACHE_BYTES) {
      const remaining = (await listMetas()).sort((a, b) => a.lastAccessAt - b.lastAccessAt);

      for (const meta of remaining) {
        if (total <= MAX_CACHE_BYTES) {
          break;
        }

        const bytes = await sessionFileBytes(meta.sessionId);
        await deleteSession(meta.sessionId);
        freedBytes += bytes;
        total -= bytes;
        cleaned += 1;
      }
    }

    freedBytes += await cleanupUnreferencedImages();
    return { cleaned, freedBytes };
  } catch (error) {
    throw new CacheError('CACHE_CLEANUP_FAILED', 'Failed to clean up cache', error);
  }
}

export function imageRefsToBlocks(imageRefs: ImageRef[]): StoredImageBlock[] {
  return imageRefs.map((ref) => ({ type: 'image_ref', hash: ref.hash, media_type: ref.mediaType }));
}

export function expandStoredMessages(
  messages: StoredMessageParam[],
  images: Map<string, ImageData>,
): Anthropic.Messages.MessageParam[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return message as Anthropic.Messages.MessageParam;
    }

    return {
      role: message.role,
      content: message.content.map((block) => {
        if (block.type === 'image_ref') {
          const image = images.get(block.hash);
          if (!image) {
            throw new CacheError('CACHE_READ_FAILED', `Image data missing for hash ${block.hash}`);
          }

          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: block.media_type,
              data: image.base64,
            },
          };
        }

        return block;
      }),
    } as Anthropic.Messages.MessageParam;
  });
}

async function touchSession(meta: SessionMeta): Promise<void> {
  await atomicWriteJson(metaPath(meta.sessionId), { ...meta, lastAccessAt: Date.now() });
}

async function cleanupUnreferencedImages(): Promise<number> {
  const referenced = new Set<string>();
  for (const meta of await listMetas()) {
    for (const imageRef of meta.imageRefs) {
      referenced.add(imageRef.hash);
    }
  }

  let freedBytes = 0;
  const imageFiles = await safeReaddir(IMAGES_DIR);
  for (const filename of imageFiles) {
    const hash = basename(filename, '.bin');
    if (referenced.has(hash)) {
      continue;
    }

    const path = join(IMAGES_DIR, filename);
    freedBytes += await fileSize(path);
    await rm(path, { force: true });
  }

  return freedBytes;
}

async function listMetas(): Promise<SessionMeta[]> {
  const files = (await safeReaddir(SESSIONS_DIR)).filter((file) => file.endsWith('.meta.json'));
  const metas = await Promise.all(files.map((file) => readJson<SessionMeta>(join(SESSIONS_DIR, file))));
  return metas.filter((meta): meta is SessionMeta => Boolean(meta));
}

async function cacheSizeBytes(): Promise<number> {
  let total = 0;
  for (const dir of [SESSIONS_DIR, IMAGES_DIR]) {
    for (const file of await safeReaddir(dir)) {
      total += await fileSize(join(dir, file));
    }
  }

  return total;
}

async function sessionFileBytes(sessionId: string): Promise<number> {
  return (await fileSize(metaPath(sessionId))) + (await fileSize(historyPath(sessionId)));
}

async function deleteSession(sessionId: string): Promise<void> {
  await Promise.all([
    rm(metaPath(sessionId), { force: true }),
    rm(historyPath(sessionId), { force: true }),
    rm(lockPath(sessionId), { force: true }),
  ]);
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmpPath, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }

    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0;
    }

    throw error;
  }
}

function isExpired(meta: SessionMeta): boolean {
  return Date.now() - meta.lastAccessAt > CACHE_TTL_MS;
}

function metaPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.meta.json`);
}

function historyPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.history.json`);
}

function imagePath(hash: string): string {
  return join(IMAGES_DIR, `${hash}.bin`);
}

function lockPath(sessionId: string): string {
  return join(LOCKS_DIR, `${sessionId}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
