import { createCallId, summarizeToolInput, textForLog, writeCallLog } from './utils/callLogger.js';
import { buildErrorResponse } from './utils/errorDiagnostics.js';
import { ApiError, formatError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { analyzeImage } from './utils/qwenApi.js';

type AnalyzeImageFn = typeof analyzeImage;

export interface AnalyzeImageArgs {
  source?: string | string[];
  session_id?: string;
  prompt?: string;
}

export function createAnalyzeImageHandler(analyzeImageFn: AnalyzeImageFn = analyzeImage) {
  return async ({ source, session_id, prompt }: AnalyzeImageArgs) => {
    const callId = createCallId();
    const startedAt = Date.now();
    const sources = typeof source === 'string' ? [source] : source ?? null;

    await writeCallLog({
      event: 'tool.analyze_image.start',
      callId,
      sessionId: session_id ?? null,
      status: 'start',
      data: summarizeToolInput(sources, session_id ?? null, prompt),
    });

    try {
      assertUsableSources(sources);
      const { result, session_id: returnedId } = await analyzeImageFn(
        sources,
        session_id ?? null,
        prompt,
        callId,
      );

      await writeCallLog({
        event: 'tool.analyze_image.success',
        callId,
        sessionId: returnedId,
        durationMs: Date.now() - startedAt,
        status: 'success',
        data: {
          result: textForLog(result),
          resultLength: result.length,
        },
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: result,
          },
        ],
        structuredContent: {
          result,
          session_id: returnedId,
        },
        _meta: {
          session_id: returnedId,
          resultLength: result.length,
        },
      };
    } catch (error) {
      logger.error('server', 'tool call failed', { error: formatError(error) });
      await writeCallLog({
        event: 'tool.analyze_image.error',
        callId,
        sessionId: session_id ?? null,
        durationMs: Date.now() - startedAt,
        status: 'error',
        data: { error: formatError(error) },
      });
      const text = await buildErrorResponse(error, {
        tool: 'analyze_image',
        hasSource: Boolean(source),
        hasSessionId: Boolean(session_id),
        callId,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text,
          },
        ],
        isError: true,
      };
    }
  };
}

function assertUsableSources(sources: string[] | null): void {
  for (const source of sources ?? []) {
    if (isTemporaryImageProxyUrl(source)) {
      throw new ApiError(
        'IMAGE_READ_FAILED',
        [
          'The provided source looks like a temporary image proxy URL, not the original user image source.',
          'Call analyze_image with the original local file path or original image URL from the user message.',
          'Do not first read the image with a host Read tool and do not pass generated data-uri/null proxy URLs as source.',
        ].join(' '),
      );
    }
  }
}

function isTemporaryImageProxyUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.pathname.includes('/data-uri/null/');
  } catch {
    return source.includes('/data-uri/null/') || source.includes('\\data-uri\\null\\');
  }
}
