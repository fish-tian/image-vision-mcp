#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { initCache, migrateOldCache } from './utils/cache.js';
import { formatError } from './utils/errors.js';
import { logger } from './utils/logger.js';
import { createAnalyzeImageHandler } from './analyzeImageTool.js';

const analyzeImageInputSchema = {
  source: z.union([z.string(), z.array(z.string())]).optional(),
  session_id: z.string().optional(),
  prompt: z.string().optional(),
};

const analyzeImageOutputSchema = {
  result: z.string(),
  session_id: z.string(),
};

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'image-vision',
    version: '1.0.0',
  });

  server.registerTool(
    'analyze_image',
    {
      title: 'Analyze image',
      description: [
        'Analyze one or more images, then continue follow-up questions with session_id.',
        'On success, present content[0].text exactly as returned by the upstream vision model.',
        'Do not summarize, translate, rewrite, reformat, add headings, or append session_id.',
        'Use structuredContent.session_id only for follow-up tool calls.',
      ].join(' '),
      inputSchema: analyzeImageInputSchema,
      outputSchema: analyzeImageOutputSchema,
      annotations: {
        title: 'Analyze image',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        'image-vision/visible-text': 'verbatim-upstream-result',
        'image-vision/session-id-field': 'structuredContent.session_id',
      },
    },
    createAnalyzeImageHandler(),
  );

  return server;
}

async function main(): Promise<void> {
  try {
    const server = createServer();
    await migrateOldCache();
    await initCache();
    await server.connect(new StdioServerTransport());
    logger.info('server', 'image vision MCP server started');
  } catch (error) {
    logger.error('server', 'startup failed', { error: formatError(error) });
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
