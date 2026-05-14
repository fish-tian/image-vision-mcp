import type Anthropic from '@anthropic-ai/sdk';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { expandPath, getConfig } from './config.js';
import { logger } from './logger.js';

const MASK = '********';
const SENSITIVE_EXACT_KEYS = new Set([
  'authorization',
  'apikey',
  'xapikey',
  'password',
  'secret',
  'signature',
  'sig',
  'credential',
]);
const NON_SECRET_TOKEN_KEYS = new Set(['maxtoken', 'maxtokens', 'inputtokens', 'outputtokens']);
const IMAGE_DATA_KEYS = new Set(['base64', 'data', 'bin', 'binary']);

type CallLogStatus = 'start' | 'success' | 'error';
type CallLogData = Record<string, unknown>;

export interface CallLogEntry {
  event: string;
  callId?: string;
  sessionId?: string | null;
  durationMs?: number;
  status?: CallLogStatus;
  data?: CallLogData;
}

export function createCallId(): string {
  return `call_${randomUUID().replaceAll('-', '')}`;
}

export async function writeCallLog(entry: CallLogEntry): Promise<void> {
  try {
    const config = getConfig().log.call;
    if (!config.enabled) {
      return;
    }

    const dir = expandPath(config.dir);
    await mkdir(dir, { recursive: true });
    const timestamp = new Date();
    const payload = {
      timestamp: timestamp.toISOString(),
      event: entry.event,
      ...(entry.callId ? { callId: entry.callId } : {}),
      ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
      ...(typeof entry.durationMs === 'number' ? { durationMs: entry.durationMs } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      ...(entry.data ? { data: sanitizeForLog(entry.data, config.includeText) } : {}),
    };

    await appendFile(join(dir, `${datePart(timestamp)}.jsonl`), `${JSON.stringify(payload)}\n`, 'utf8');
  } catch (error) {
    logger.warn('call-log', 'failed to write call log', { error: String(error) });
  }
}

export function summarizeToolInput(
  sources: string[] | null,
  sessionId: string | null,
  prompt: string | undefined,
): CallLogData {
  return {
    sourceCount: sources?.length ?? 0,
    sources,
    hasSessionId: Boolean(sessionId),
    prompt: textForLog(prompt),
  };
}

export function summarizeApiMessages(messages: Anthropic.Messages.MessageParam[]): CallLogData {
  let imageCount = 0;
  const imageMediaTypes: string[] = [];
  const texts: unknown[] = [];

  for (const message of messages) {
    if (typeof message.content === 'string') {
      texts.push(textForLog(message.content));
      continue;
    }

    for (const block of message.content) {
      if (block.type === 'text') {
        texts.push(textForLog(block.text));
      } else if (block.type === 'image') {
        imageCount += 1;
        const source = block.source;
        if ('media_type' in source) {
          imageMediaTypes.push(source.media_type);
        }
      }
    }
  }

  return {
    textBlocks: texts,
    imageCount,
    imageMediaTypes,
  };
}

export function textForLog(text: string | undefined): unknown {
  const includeText = getConfig().log.call.includeText;
  if (text === undefined) {
    return undefined;
  }

  if (includeText) {
    return text;
  }

  return {
    length: text.length,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

export function sanitizeForLog(value: unknown, includeText = getConfig().log.call.includeText): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, includeText));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveKey(key) || isImageDataKey(key)) {
      sanitized[key] = MASK;
      continue;
    }

    sanitized[key] = sanitizeForLog(child, includeText);
  }

  return sanitized;
}

function sanitizeString(value: string): string {
  try {
    const url = new URL(value);
    let changed = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, MASK);
        changed = true;
      }
    }

    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  if (SENSITIVE_EXACT_KEYS.has(normalized) || normalized.endsWith('apikey') || normalized.endsWith('accesskey')) {
    return true;
  }

  if (
    normalized.includes('auth')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('signature')
  ) {
    return true;
  }

  if (normalized.endsWith('token') || normalized.endsWith('tokens')) {
    return !NON_SECRET_TOKEN_KEYS.has(normalized);
  }

  return false;
}

function isImageDataKey(key: string): boolean {
  return IMAGE_DATA_KEYS.has(key.toLowerCase());
}

function datePart(date: Date): string {
  return date.toISOString().slice(0, 10);
}
