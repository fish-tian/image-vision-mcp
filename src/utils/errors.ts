export type CacheErrorCode =
  | 'CACHE_INIT_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'LOCK_TIMEOUT'
  | 'LOCK_RELEASE_FAILED'
  | 'CACHE_READ_FAILED'
  | 'CACHE_WRITE_FAILED'
  | 'CACHE_CLEANUP_FAILED';

export type ApiErrorCode =
  | 'NO_IMAGE_PROVIDED'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'API_TOKEN_MISSING'
  | 'API_REQUEST_FAILED'
  | 'IMAGE_READ_FAILED'
  | 'INVALID_ARGUMENT';

export class CacheError extends Error {
  constructor(
    public code: CacheErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'CacheError';
  }
}

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function formatError(error: unknown): string {
  if (error instanceof CacheError || error instanceof ApiError) {
    return `[${error.name}:${error.code}] ${error.message}`;
  }

  if (error instanceof Error) {
    return `[${error.name}] ${error.message}`;
  }

  return String(error);
}
