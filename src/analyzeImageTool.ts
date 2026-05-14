import { createCallId, summarizeToolInput, textForLog, writeCallLog } from './utils/callLogger.js';
import { buildErrorResponse } from './utils/errorDiagnostics.js';
import { formatError } from './utils/errors.js';
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
