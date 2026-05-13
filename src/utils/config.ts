import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';

export interface ImageVisionConfig {
  api: {
    authToken: string;
    baseUrl?: string;
    model: string;
    maxTokens: number;
    defaultPrompt: string;
  };
  cache: {
    dir: string;
    ttlHours: number;
    maxMb: number;
    lockTimeoutMs: number;
  };
  image: {
    fetchTimeoutMs: number;
    maxBytes: number;
  };
  log: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
  configPath: string;
}

type PartialConfig = {
  api?: Partial<ImageVisionConfig['api']>;
  cache?: Partial<ImageVisionConfig['cache']>;
  image?: Partial<ImageVisionConfig['image']>;
  log?: Partial<ImageVisionConfig['log']>;
};

const DEFAULT_CONFIG_PATH = '~/.image-vision-mcp/config.json';
const DEFAULT_CONFIG: Omit<ImageVisionConfig, 'configPath'> = {
  api: {
    authToken: '',
    model: 'openai/qwen3.6-plus',
    maxTokens: 64_000,
    defaultPrompt: 'Please analyze the image content.',
  },
  cache: {
    dir: '~/.image-vision-cache',
    ttlHours: 24,
    maxMb: 500,
    lockTimeoutMs: 5_000,
  },
  image: {
    fetchTimeoutMs: 30_000,
    maxBytes: 20 * 1024 * 1024,
  },
  log: {
    level: 'info',
  },
};

let cachedConfig: ImageVisionConfig | null = null;

export function getConfig(): ImageVisionConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = expandPath(process.env.IMAGE_VISION_CONFIG || DEFAULT_CONFIG_PATH);
  const fileConfig = readConfigFile(configPath);
  const merged = mergeConfig(DEFAULT_CONFIG, fileConfig);
  cachedConfig = applyEnvOverrides({ ...merged, configPath });
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}

export function expandPath(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? normalize(path) : normalize(join(process.cwd(), path));
}

function readConfigFile(path: string): PartialConfig {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PartialConfig;
  } catch (error) {
    throw new Error(`Failed to read image vision config at ${path}: ${String(error)}`);
  }
}

function mergeConfig(
  defaults: Omit<ImageVisionConfig, 'configPath'>,
  fileConfig: PartialConfig,
): Omit<ImageVisionConfig, 'configPath'> {
  return {
    api: {
      ...defaults.api,
      ...fileConfig.api,
      maxTokens: positiveNumber(fileConfig.api?.maxTokens, defaults.api.maxTokens),
      defaultPrompt: nonEmptyString(fileConfig.api?.defaultPrompt, defaults.api.defaultPrompt),
      model: nonEmptyString(fileConfig.api?.model, defaults.api.model),
    },
    cache: {
      ...defaults.cache,
      ...fileConfig.cache,
      dir: nonEmptyString(fileConfig.cache?.dir, defaults.cache.dir),
      ttlHours: positiveNumber(fileConfig.cache?.ttlHours, defaults.cache.ttlHours),
      maxMb: positiveNumber(fileConfig.cache?.maxMb, defaults.cache.maxMb),
      lockTimeoutMs: positiveNumber(fileConfig.cache?.lockTimeoutMs, defaults.cache.lockTimeoutMs),
    },
    image: {
      ...defaults.image,
      ...fileConfig.image,
      fetchTimeoutMs: positiveNumber(fileConfig.image?.fetchTimeoutMs, defaults.image.fetchTimeoutMs),
      maxBytes: positiveNumber(fileConfig.image?.maxBytes, defaults.image.maxBytes),
    },
    log: {
      ...defaults.log,
      ...fileConfig.log,
      level: logLevel(fileConfig.log?.level, defaults.log.level),
    },
  };
}

function applyEnvOverrides(config: ImageVisionConfig): ImageVisionConfig {
  return {
    ...config,
    api: {
      ...config.api,
      authToken: process.env.ANTHROPIC_AUTH_TOKEN || config.api.authToken,
      baseUrl: process.env.ANTHROPIC_BASE_URL || config.api.baseUrl,
      model: process.env.QWEN_MODEL || config.api.model,
      maxTokens: envPositiveNumber('VISION_MAX_TOKENS', config.api.maxTokens),
      defaultPrompt: process.env.VISION_DEFAULT_PROMPT || config.api.defaultPrompt,
    },
    cache: {
      ...config.cache,
      dir: process.env.IMAGE_VISION_CACHE_DIR || config.cache.dir,
      ttlHours: envPositiveNumber('CACHE_TTL_HOURS', config.cache.ttlHours),
      maxMb: envPositiveNumber('CACHE_MAX_MB', config.cache.maxMb),
      lockTimeoutMs: envPositiveNumber('CACHE_LOCK_TIMEOUT_MS', config.cache.lockTimeoutMs),
    },
    image: {
      ...config.image,
      fetchTimeoutMs: envPositiveNumber('IMAGE_FETCH_TIMEOUT_MS', config.image.fetchTimeoutMs),
      maxBytes: envPositiveNumber('IMAGE_MAX_BYTES', config.image.maxBytes),
    },
    log: {
      level: logLevel(process.env.LOG_LEVEL, config.log.level),
    },
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function envPositiveNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function logLevel(value: unknown, fallback: ImageVisionConfig['log']['level']): ImageVisionConfig['log']['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : fallback;
}
