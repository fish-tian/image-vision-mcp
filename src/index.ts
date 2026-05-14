#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { initCache, migrateOldCache } from './utils/cache.js';
import { createCallId, summarizeToolInput, textForLog, writeCallLog } from './utils/callLogger.js';
import { buildErrorResponse } from './utils/errorDiagnostics.js';
import { formatError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { analyzeImage } from './utils/qwenApi.js';

const server = new McpServer({
  name: 'image-vision',
  version: '1.0.0',
});

server.tool(
  'analyze_image',
  'Analyze one or more images, then continue follow-up questions with session_id.',
  {
    source: z.union([z.string(), z.array(z.string())]).optional(),
    session_id: z.string().optional(),
    prompt: z.string().optional(),
  },
  async ({ source, session_id, prompt }) => {
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
      const { result, session_id: returnedId } = await analyzeImage(
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
            text: `${result}\n\n---\nsession_id: ${returnedId}`,
          },
        ],
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
  },
);

async function main(): Promise<void> {
  try {
    await migrateOldCache();
    await initCache();
    await server.connect(new StdioServerTransport());
    logger.info('server', 'image vision MCP server started');
  } catch (error) {
    logger.error('server', 'startup failed', { error: formatError(error) });
    process.exit(1);
  }
}

main();
