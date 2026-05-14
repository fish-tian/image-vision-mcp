import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { ImageData } from './imageReader.js';
import { imageFromBuffer } from './imageReader.js';
import { errorDetailForLog, writeCallLog } from './callLogger.js';
import { expandPath, getConfig } from './config.js';
import { CacheError } from './errors.js';
import { logger } from './logger.js';

const LOCK_RETRY_MS = 75;

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
    const timeoutMs = getConfig().cache.lockTimeoutMs;

    while (Date.now() - startedAt < timeoutMs) {
      try {
        this.handle = await open(this.lockPath, 'wx+');
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
    const paths = cachePaths();
    await Promise.all([
      mkdir(paths.sessionsDir, { recursive: true }),
      mkdir(paths.imagesDir, { recursive: true }),
      mkdir(paths.locksDir, { recursive: true }),
    ]);

    const cleanup = await cleanupExpiredSessions();
    logger.info('cache', 'cache initialized', { ...cleanup, cacheDir: paths.root });
  } catch (error) {
    throw new CacheError('CACHE_INIT_FAILED', 'Failed to initialize cache', error);
  }
}

export async function createSession(images: ImageData[], _prompt?: string, callId?: string): Promise<string> {
  const sessionId = `img_${randomUUID().replaceAll('-', '')}`;
  const now = Date.now();
  const imageRefs = images.map(({ hash, mediaType, size }) => ({ hash, mediaType, size }));
  const meta: SessionMeta = { sessionId, createdAt: now, lastAccessAt: now, imageRefs };
  const history: SessionHistory = { sessionId, messages: [], updatedAt: now };
  const startedAt = Date.now();

  try {
    const paths = cachePaths();
    await mkdir(paths.sessionsDir, { recursive: true });
    await mkdir(paths.imagesDir, { recursive: true });

    for (const image of images) {
      const path = imagePath(image.hash);
      if (!(await exists(path))) {
        await writeFile(path, Buffer.from(image.base64, 'base64'));
      }
    }

    await atomicWriteJson(metaPath(sessionId), meta);
    await atomicWriteJson(historyPath(sessionId), history);
    logger.info('cache', 'created session', { sessionId, imageCount: images.length });
    await writeCallLog({
      event: 'cache.session.create',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      data: {
        imageCount: images.length,
        totalBytes: images.reduce((total, image) => total + image.size, 0),
      },
    });
    return sessionId;
  } catch (error) {
    await writeCallLog({
      event: 'cache.session.create',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      data: {
        imageCount: images.length,
        totalBytes: images.reduce((total, image) => total + image.size, 0),
        errorDetail: errorDetailForLog(error),
      },
    });
    throw new CacheError('CACHE_WRITE_FAILED', `Failed to create session ${sessionId}`, error);
  }
}

export async function readSession(sessionId: string, callId?: string): Promise<SessionData | null> {
  const startedAt = Date.now();
  try {
    const meta = await readJson<SessionMeta>(metaPath(sessionId));

    if (!meta) {
      await writeCallLog({
        event: 'cache.session.read',
        callId,
        sessionId,
        durationMs: Date.now() - startedAt,
        status: 'success',
        data: { hit: false },
      });
      return null;
    }

    if (isExpired(meta)) {
      await deleteSession(sessionId);
      await cleanupUnreferencedImages();
      throw new CacheError('SESSION_EXPIRED', `Session expired: ${sessionId}`);
    }

    const history = await readJson<SessionHistory>(historyPath(sessionId));
    if (!history) {
      await writeCallLog({
        event: 'cache.session.read',
        callId,
        sessionId,
        durationMs: Date.now() - startedAt,
        status: 'success',
        data: { hit: false, imageCount: meta.imageRefs.length },
      });
      return null;
    }

    const images = new Map<string, ImageData>();
    for (const ref of meta.imageRefs) {
      const buffer = await readFile(imagePath(ref.hash));
      images.set(ref.hash, imageFromBuffer(buffer, ref.mediaType));
    }

    await touchSession(meta);
    await writeCallLog({
      event: 'cache.session.read',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      data: {
        hit: true,
        imageCount: meta.imageRefs.length,
        messageCount: history.messages.length,
      },
    });
    return { meta: { ...meta, lastAccessAt: Date.now() }, history, images };
  } catch (error) {
    await writeCallLog({
      event: 'cache.session.read',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      data: { errorDetail: errorDetailForLog(error) },
    });
    if (error instanceof CacheError) {
      throw error;
    }

    throw new CacheError('CACHE_READ_FAILED', `Failed to read session ${sessionId}`, error);
  }
}

export async function updateHistory(
  sessionId: string,
  messages: StoredMessageParam[],
  callId?: string,
): Promise<void> {
  const startedAt = Date.now();
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
    await writeCallLog({
      event: 'cache.session.update',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      data: {
        messageCount: messages.length,
      },
    });
  } catch (error) {
    await writeCallLog({
      event: 'cache.session.update',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      data: {
        messageCount: messages.length,
        errorDetail: errorDetailForLog(error),
      },
    });
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
    const maxCacheBytes = getConfig().cache.maxMb * 1024 * 1024;
    if (total > maxCacheBytes) {
      const remaining = (await listMetas()).sort((a, b) => a.lastAccessAt - b.lastAccessAt);

      for (const meta of remaining) {
        if (total <= maxCacheBytes) {
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
  const imageFiles = await safeReaddir(cachePaths().imagesDir);
  for (const filename of imageFiles) {
    const hash = basename(filename, '.bin');
    if (referenced.has(hash)) {
      continue;
    }

    const path = join(cachePaths().imagesDir, filename);
    freedBytes += await fileSize(path);
    await rm(path, { force: true });
  }

  return freedBytes;
}

async function listMetas(): Promise<SessionMeta[]> {
  const sessions = cachePaths().sessionsDir;
  const files = (await safeReaddir(sessions)).filter((file) => file.endsWith('.meta.json'));
  const metas = await Promise.all(files.map((file) => readJson<SessionMeta>(join(sessions, file))));
  return metas.filter((meta): meta is SessionMeta => Boolean(meta));
}

async function cacheSizeBytes(): Promise<number> {
  let total = 0;
  const paths = cachePaths();
  for (const dir of [paths.sessionsDir, paths.imagesDir]) {
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
  return Date.now() - meta.lastAccessAt > getConfig().cache.ttlHours * 60 * 60 * 1000;
}

function metaPath(sessionId: string): string {
  return join(cachePaths().sessionsDir, `${sessionId}.meta.json`);
}

function historyPath(sessionId: string): string {
  return join(cachePaths().sessionsDir, `${sessionId}.history.json`);
}

function imagePath(hash: string): string {
  return join(cachePaths().imagesDir, `${hash}.bin`);
}

function lockPath(sessionId: string): string {
  return join(cachePaths().locksDir, `${sessionId}.lock`);
}

function cachePaths(): { root: string; sessionsDir: string; imagesDir: string; locksDir: string } {
  const root = expandPath(getConfig().cache.dir);
  return {
    root,
    sessionsDir: join(root, 'sessions'),
    imagesDir: join(root, 'images'),
    locksDir: join(root, 'locks'),
  };
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
