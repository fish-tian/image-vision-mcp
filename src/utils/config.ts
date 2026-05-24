import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';

export interface ImageVisionConfig {
  api: {
    provider: 'anthropic' | 'openai';
    authToken: string;
    authTokenSource: 'config' | 'env' | 'missing';
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
    call: {
      enabled: boolean;
      dir: string;
      includeText: boolean;
    };
  };
  diagnostics: {
    enabled: boolean;
    model: string;
    maxTokens: number;
    timeoutMs: number;
  };
  configPath: string;
}

type PartialConfig = {
  api?: Partial<ImageVisionConfig['api']>;
  cache?: Partial<ImageVisionConfig['cache']>;
  image?: Partial<ImageVisionConfig['image']>;
  log?: Partial<ImageVisionConfig['log']>;
  diagnostics?: Partial<ImageVisionConfig['diagnostics']>;
};

const DEFAULT_CONFIG_PATH = '~/.image-vision-mcp/config.json';
const DEFAULT_CONFIG: Omit<ImageVisionConfig, 'configPath'> = {
  api: {
    provider: 'anthropic',
    authToken: '',
    authTokenSource: 'missing',
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
    call: {
      enabled: true,
      dir: '~/.image-vision-mcp/call-logs',
      includeText: true,
    },
  },
  diagnostics: {
    enabled: true,
    model: '',
    maxTokens: 1_000,
    timeoutMs: 8_000,
  },
};

let cachedConfig: ImageVisionConfig | null = null;

export function getConfig(): ImageVisionConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = expandPath(process.env.IMAGE_VISION_CONFIG || DEFAULT_CONFIG_PATH);
  const fileConfig = readConfigFile(configPath);
  const defaultsWithEnv = applyEnvDefaults(DEFAULT_CONFIG);
  const merged = mergeConfig(defaultsWithEnv, fileConfig);
  cachedConfig = {
    ...merged,
    api: {
      ...merged.api,
      authTokenSource: authTokenSource(fileConfig, merged.api.authToken),
    },
    configPath,
  };
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
      provider: apiProvider(fileConfig.api?.provider, defaults.api.provider),
      authToken: nonEmptyString(fileConfig.api?.authToken, defaults.api.authToken),
      authTokenSource: defaults.api.authTokenSource,
      baseUrl: optionalNonEmptyString(fileConfig.api?.baseUrl, defaults.api.baseUrl),
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
      call: {
        ...defaults.log.call,
        ...fileConfig.log?.call,
        enabled: booleanValue(fileConfig.log?.call?.enabled, defaults.log.call.enabled),
        dir: nonEmptyString(fileConfig.log?.call?.dir, defaults.log.call.dir),
        includeText: booleanValue(fileConfig.log?.call?.includeText, defaults.log.call.includeText),
      },
    },
    diagnostics: {
      ...defaults.diagnostics,
      ...fileConfig.diagnostics,
      enabled: booleanValue(fileConfig.diagnostics?.enabled, defaults.diagnostics.enabled),
      model: nonEmptyString(fileConfig.diagnostics?.model, defaults.diagnostics.model),
      maxTokens: positiveNumber(fileConfig.diagnostics?.maxTokens, defaults.diagnostics.maxTokens),
      timeoutMs: positiveNumber(fileConfig.diagnostics?.timeoutMs, defaults.diagnostics.timeoutMs),
    },
  };
}

function applyEnvDefaults(config: Omit<ImageVisionConfig, 'configPath'>): Omit<ImageVisionConfig, 'configPath'> {
  return {
    ...config,
    api: {
      ...config.api,
      provider: apiProvider(process.env.VISION_API_PROVIDER, config.api.provider),
      authToken: process.env.ANTHROPIC_AUTH_TOKEN || config.api.authToken,
      authTokenSource: process.env.ANTHROPIC_AUTH_TOKEN ? 'env' : config.api.authTokenSource,
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
      call: {
        ...config.log.call,
        enabled: envBoolean('CALL_LOG_ENABLED', config.log.call.enabled),
        dir: process.env.CALL_LOG_DIR || config.log.call.dir,
        includeText: envBoolean('CALL_LOG_INCLUDE_TEXT', config.log.call.includeText),
      },
    },
    diagnostics: {
      enabled: envBoolean('DIAGNOSTICS_ENABLED', config.diagnostics.enabled),
      model: process.env.ANTHROPIC_MODEL || config.diagnostics.model,
      maxTokens: envPositiveNumber('DIAGNOSTICS_MAX_TOKENS', config.diagnostics.maxTokens),
      timeoutMs: envPositiveNumber('DIAGNOSTICS_TIMEOUT_MS', config.diagnostics.timeoutMs),
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

function optionalNonEmptyString(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function authTokenSource(
  fileConfig: PartialConfig,
  authToken: string,
): ImageVisionConfig['api']['authTokenSource'] {
  if (typeof fileConfig.api?.authToken === 'string' && fileConfig.api.authToken.trim()) {
    return 'config';
  }

  if (authToken) {
    return 'env';
  }

  return 'missing';
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }

  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }

  return fallback;
}

function logLevel(value: unknown, fallback: ImageVisionConfig['log']['level']): ImageVisionConfig['log']['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : fallback;
}

function apiProvider(value: unknown, fallback: ImageVisionConfig['api']['provider']): ImageVisionConfig['api']['provider'] {
  return value === 'anthropic' || value === 'openai' ? value : fallback;
}
