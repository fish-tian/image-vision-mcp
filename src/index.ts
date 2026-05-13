#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { initCache, migrateOldCache } from './utils/cache.js';
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
    try {
      const sources = typeof source === 'string' ? [source] : source ?? null;
      const { result, session_id: returnedId } = await analyzeImage(
        sources,
        session_id ?? null,
        prompt,
      );

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
      return {
        content: [
          {
            type: 'text' as const,
            text: formatError(error),
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
