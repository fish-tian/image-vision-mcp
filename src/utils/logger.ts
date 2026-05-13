import { getConfig } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogData = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function write(level: LogLevel, module: string, message: string, data?: LogData): void {
  const minLevel = getMinLevel();
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(data ? { data } : {}),
  };

  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

function getMinLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  if (configured && configured in LEVEL_WEIGHT) {
    return configured;
  }

  try {
    return getConfig().log.level;
  } catch {
    return 'info';
  }
}

export const logger = {
  debug(module: string, message: string, data?: LogData): void {
    write('debug', module, message, data);
  },
  info(module: string, message: string, data?: LogData): void {
    write('info', module, message, data);
  },
  warn(module: string, message: string, data?: LogData): void {
    write('warn', module, message, data);
  },
  error(module: string, message: string, data?: LogData): void {
    write('error', module, message, data);
  },
};
