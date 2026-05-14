import Anthropic from '@anthropic-ai/sdk';

import { getConfig } from './config.js';
import { ApiError, CacheError, formatError } from './errors.js';
import { logger } from './logger.js';

export interface ErrorDiagnosticContext {
  tool: string;
  hasSource: boolean;
  hasSessionId: boolean;
}

const SKIPPED_NO_MODEL = 'Skipped because ANTHROPIC_MODEL / diagnostics.model is not configured.';
const SKIPPED_DISABLED = 'Skipped because diagnostics.enabled is false.';
const SKIPPED_TOKEN = 'Skipped because API token is missing.';
const SKIPPED_TOKEN_ERROR = 'Skipped because the original error is API_TOKEN_MISSING.';
const SKIPPED_FAILED = 'Model-assisted diagnosis was skipped or failed.';

export async function buildErrorResponse(
  error: unknown,
  context: ErrorDiagnosticContext,
): Promise<string> {
  const originalError = formatError(error);
  const localDiagnosis = localDiagnose(error);
  const modelAnalysis = await anthropicDiagnose(error, localDiagnosis, context);

  return [
    'Image Vision MCP request failed.',
    '',
    'Original error:',
    originalError,
    '',
    'Local diagnosis:',
    localDiagnosis,
    '',
    'Additional model-assisted diagnosis:',
    modelAnalysis,
    '',
    'Instruction for Claude Code:',
    'Show this error and diagnostic summary to the user. Ask whether they want help fixing it.',
  ].join('\n');
}

export function localDiagnose(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'API_TOKEN_MISSING':
        return bullets(
          'API token is missing or empty.',
          'Set ANTHROPIC_AUTH_TOKEN in the Claude Code environment, or edit ~/.image-vision-mcp/config.json and set a non-empty api.authToken.',
          'Ask the user to provide or configure a valid API token.',
        );
      case 'NO_IMAGE_PROVIDED':
        return bullets(
          'The first analyze_image call did not include a source image.',
          'Call analyze_image with source set to a local path or image URL, or use an existing session_id for follow-up.',
          'Ask the user to provide an image source or a valid session_id.',
        );
      case 'IMAGE_READ_FAILED':
        return bullets(
          'The image could not be read, downloaded, or passed validation.',
          'Check that the local path or URL exists, the file is an image, the remote server is reachable, and the image size is below image.maxBytes.',
          'Ask the user to verify the image path/URL or reduce the image size.',
        );
      case 'SESSION_NOT_FOUND':
      case 'SESSION_EXPIRED':
        return bullets(
          'The requested session is missing or expired.',
          'Start a new image analysis call with source, then use the returned session_id for follow-up questions.',
          'Ask the user to rerun the analysis with the original image.',
        );
      case 'API_REQUEST_FAILED':
        return bullets(
          'The upstream model API request failed.',
          'Check ANTHROPIC_BASE_URL/api.baseUrl, ANTHROPIC_AUTH_TOKEN/api.authToken, QWEN_MODEL/api.model, network connectivity, provider quota, and model availability.',
          'Ask the user whether they want help checking API configuration or provider status.',
        );
      default:
        return bullets(
          'The MCP server rejected the request or received invalid arguments.',
          'Check the tool arguments and current configuration.',
          'Ask the user to review the request parameters.',
        );
    }
  }

  if (error instanceof CacheError) {
    switch (error.code) {
      case 'LOCK_TIMEOUT':
        return bullets(
          'The session cache is locked by another operation or a stale lock file.',
          'Wait and retry; if it persists, remove stale lock files from the cache locks directory after ensuring no server is running.',
          'Ask the user whether they want help inspecting the cache lock directory.',
        );
      case 'SESSION_EXPIRED':
      case 'SESSION_NOT_FOUND':
        return bullets(
          'The session cache entry is missing or expired.',
          'Start a new image analysis call with source and use the new session_id.',
          'Ask the user to provide the original image again.',
        );
      case 'CACHE_READ_FAILED':
      case 'CACHE_WRITE_FAILED':
      case 'CACHE_INIT_FAILED':
      case 'CACHE_CLEANUP_FAILED':
        return bullets(
          'The local cache could not be read, written, initialized, or cleaned.',
          'Check cache.dir permissions, available disk space, and whether the configured cache path is valid.',
          'Ask the user whether they want help inspecting or resetting the cache directory.',
        );
      default:
        return bullets(
          'The local session cache encountered an error.',
          'Retry the request and inspect cache configuration if it persists.',
          'Ask the user whether they want help checking the cache files.',
        );
    }
  }

  return bullets(
    'An unexpected error occurred inside the MCP server.',
    'Check the server logs, configuration file, and request parameters.',
    'Ask the user whether they want help debugging the server error.',
  );
}

export async function anthropicDiagnose(
  error: unknown,
  localDiagnosis: string,
  context: ErrorDiagnosticContext,
): Promise<string> {
  const config = getConfig();

  if (!config.diagnostics.enabled) {
    return SKIPPED_DISABLED;
  }

  if (error instanceof ApiError && error.code === 'API_TOKEN_MISSING') {
    return SKIPPED_TOKEN_ERROR;
  }

  if (!config.api.authToken) {
    return SKIPPED_TOKEN;
  }

  if (!config.diagnostics.model) {
    return SKIPPED_NO_MODEL;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.diagnostics.timeoutMs);

  try {
    const client = new Anthropic({
      apiKey: config.api.authToken,
      baseURL: config.api.baseUrl,
      fetch: globalThis.fetch as never,
      httpAgent: false as never,
    });
    const response = await client.messages.create(
      {
        model: config.diagnostics.model,
        max_tokens: config.diagnostics.maxTokens,
        messages: [
          {
            role: 'user',
            content: buildDiagnosticPrompt(error, localDiagnosis, context),
          },
        ],
      },
      { signal: controller.signal } as object,
    );

    return extractText(response) || SKIPPED_FAILED;
  } catch (diagnosticError) {
    logger.warn('diagnostics', 'model-assisted diagnosis failed', {
      error: sanitizeForPrompt(diagnosticError),
    });
    return SKIPPED_FAILED;
  } finally {
    clearTimeout(timeout);
  }
}

function buildDiagnosticPrompt(
  error: unknown,
  localDiagnosis: string,
  context: ErrorDiagnosticContext,
): string {
  return [
    'You are diagnosing an Image Vision MCP server tool failure.',
    'Give a concise diagnosis for Claude Code to show to the user.',
    'The diagnostic model may be any text model reachable through the configured Anthropic-compatible SDK endpoint; do not assume it is Claude.',
    'Do not expose secrets, tokens, image base64, or long stack traces.',
    'Do not claim certainty beyond the provided error details.',
    'Return 2-4 bullet points covering likely cause, suggested fix, and what to ask the user.',
    '',
    `Tool: ${context.tool}`,
    `Has source: ${context.hasSource}`,
    `Has session_id: ${context.hasSessionId}`,
    '',
    'Original error:',
    sanitizeForPrompt(error),
    '',
    'Local diagnosis:',
    localDiagnosis,
  ].join('\n');
}

function extractText(response: Anthropic.Messages.Message): string {
  return response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function bullets(possibleCause: string, suggestedFix: string, userAction: string): string {
  return [
    `- Possible cause: ${possibleCause}`,
    `- Suggested fix: ${suggestedFix}`,
    `- User action: ${userAction}`,
  ].join('\n');
}

function sanitizeForPrompt(error: unknown): string {
  const raw = serializeError(error).slice(0, 2_000);
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/(ANTHROPIC_AUTH_TOKEN=)[^\s"']+/g, '$1***')
    .replace(/("authToken"\s*:\s*")[^"]+/g, '$1***')
    .replace(/(data:image\/[a-zA-Z+.-]+;base64,)[A-Za-z0-9+/=]+/g, '$1***')
    .replace(/([A-Za-z0-9+/]{120,}={0,2})/g, '[redacted-long-data]');
}

function serializeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof CacheError) {
    return JSON.stringify({
      name: error.name,
      code: error.code,
      message: error.message,
      cause: serializeCause(error.cause),
    });
  }

  if (error instanceof Error) {
    return JSON.stringify({
      name: error.name,
      message: error.message,
      cause: serializeCause(error.cause),
    });
  }

  return String(error);
}

function serializeCause(cause: unknown): unknown {
  if (!cause) {
    return undefined;
  }

  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
    };
  }

  if (typeof cause === 'object') {
    try {
      return JSON.parse(JSON.stringify(cause));
    } catch {
      return String(cause);
    }
  }

  return cause;
}
