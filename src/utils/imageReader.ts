import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

import { getConfig } from './config.js';
import { ApiError } from './errors.js';
import { logger } from './logger.js';

export interface ImageData {
  base64: string;
  mediaType: string;
  size: number;
  hash: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export function inferMimeType(source: string): string {
  const cleanSource = source.split('?')[0] ?? source;
  return MIME_BY_EXTENSION[extname(cleanSource).toLowerCase()] ?? 'application/octet-stream';
}

export function imageFromBuffer(buffer: Buffer, mediaType: string): ImageData {
  return {
    base64: buffer.toString('base64'),
    mediaType,
    size: buffer.byteLength,
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function readImageSource(source: string): Promise<ImageData> {
  try {
    const config = getConfig();

    if (source.startsWith('http://') || source.startsWith('https://')) {
      logger.info('image', 'downloading image', { source });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.image.fetchTimeoutMs);
      const response = await fetch(source, { signal: controller.signal }).finally(() => clearTimeout(timeout));

      if (!response.ok) {
        throw new ApiError(
          'IMAGE_READ_FAILED',
          `Failed to download image: HTTP ${response.status} ${response.statusText}`,
        );
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > config.image.maxBytes) {
        throw new ApiError(
          'IMAGE_READ_FAILED',
          `Image is too large: ${contentLength} bytes exceeds limit ${config.image.maxBytes}`,
        );
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();
      const buffer = Buffer.from(await response.arrayBuffer());
      assertImageSize(buffer.byteLength, config.image.maxBytes);
      return imageFromBuffer(buffer, contentType || inferMimeType(source));
    }

    logger.info('image', 'reading local image', { source });
    const file = await stat(source);
    assertImageSize(file.size, config.image.maxBytes);
    const buffer = await readFile(source);
    assertImageSize(buffer.byteLength, config.image.maxBytes);
    return imageFromBuffer(buffer, inferMimeType(source));
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('IMAGE_READ_FAILED', `Failed to read image source: ${source}`, error);
  }
}

function assertImageSize(size: number, maxBytes: number): void {
  if (size > maxBytes) {
    throw new ApiError('IMAGE_READ_FAILED', `Image is too large: ${size} bytes exceeds limit ${maxBytes}`);
  }
}
