import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { resetConfigForTests } from '../../src/utils/config.js';

const ENV_KEYS = [
  'IMAGE_VISION_CONFIG',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'QWEN_MODEL',
  'VISION_MAX_TOKENS',
  'VISION_DEFAULT_PROMPT',
  'IMAGE_VISION_CACHE_DIR',
  'CACHE_TTL_HOURS',
  'CACHE_MAX_MB',
  'CACHE_LOCK_TIMEOUT_MS',
  'IMAGE_FETCH_TIMEOUT_MS',
  'IMAGE_MAX_BYTES',
  'LOG_LEVEL',
  'DIAGNOSTICS_ENABLED',
  'DIAGNOSTICS_MAX_TOKENS',
  'DIAGNOSTICS_TIMEOUT_MS',
];

export function snapshotEnv(): Record<string, string | undefined> {
  const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  resetConfigForTests();
  return snapshot;
}

export function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  resetConfigForTests();
}

export function testTempPath(name: string): string {
  return join(tmpdir(), `image-vision-mcp-test-${Date.now()}-${Math.random().toString(16).slice(2)}`, name);
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await Bun.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function writeText(path: string, data: string): Promise<void> {
  await Bun.write(path, data);
}

export async function writeBinary(path: string, data: Uint8Array): Promise<void> {
  await Bun.write(path, data);
}

export async function cleanupPath(path: string): Promise<void> {
  await rm(dirname(path), { recursive: true, force: true });
}
