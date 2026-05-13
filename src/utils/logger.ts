type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogData = Record<string, unknown>;

function write(level: LogLevel, module: string, message: string, data?: LogData): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
    ...(data ? { data } : {}),
  };

  process.stderr.write(`${JSON.stringify(entry)}\n`);
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
