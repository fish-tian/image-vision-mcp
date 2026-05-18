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
  source: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      [
        'Original user-provided local image path or original image URL.',
        'Pass paths such as @src/views/Chat/ui稿.png or C:\\path\\image.png directly.',
        'Do not use host Read output, uploaded-image proxy URLs, data-uri/null URLs, or guessed URLs.',
      ].join(' '),
    ),
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
        'Analyze one or more images by directly reading the original source path or URL.',
        'When the user provides an image path, @path mention, Windows path, repository path, or image URL, pass that exact original value as source.',
        'Do not call a host Read tool first and do not pass generated temporary URLs, upload proxy URLs, data-uri/null URLs, or guessed URLs.',
        'Continue follow-up questions with session_id.',
        'On success, present content[0].text exactly as returned by the upstream vision model.',
        'Do not summarize, translate, rewrite, reformat, add headings, or append session_id.',
        'Use structuredContent.session_id only for follow-up tool calls.',
      ].join(' '),
      inputSchema: analyzeImageInputSchema,
      outputSchema: analyzeImageOutputSchema,
      annotations: {
        title: 'Analyze image',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      _meta: {
        'image-vision/visible-text': 'verbatim-upstream-result',
        'image-vision/session-id-field': 'structuredContent.session_id',
        'image-vision/source-policy': 'use-original-user-path-or-url',
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
