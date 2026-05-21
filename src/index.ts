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

const outputTypeSchema = z
  .enum(['code', 'prompt', 'spec', 'description'])
  .optional()
  .describe('Output artifact type for ui_to_artifact. Defaults to description.');

const uiToArtifactInputSchema = {
  ...analyzeImageInputSchema,
  output_type: outputTypeSchema,
};

const analyzeImageOutputSchema = {
  result: z.string(),
  session_id: z.string(),
};

interface VisionToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema?: typeof analyzeImageInputSchema | typeof uiToArtifactInputSchema;
  defaultPrompt?: string | ((args: { output_type?: string }) => string);
  validateSources?: (sources: string[] | null) => void;
}

const GENERAL_SOURCE_POLICY = [
  'When the user provides an image path, @path mention, Windows path, repository path, or image URL, pass that exact original value as source.',
  'Do not call a host Read tool first and do not pass generated temporary URLs, upload proxy URLs, data-uri/null URLs, or guessed URLs.',
  'Continue follow-up questions with session_id.',
  'On success, present content[0].text exactly as returned by the upstream vision model.',
  'Do not summarize, translate, rewrite, reformat, add headings, or append session_id.',
  'Use structuredContent.session_id only for follow-up tool calls.',
].join(' ');

const visionTools: VisionToolDefinition[] = [
  {
    name: 'image_analysis',
    title: 'Image analysis',
    description: 'General-purpose image understanding when no specialized image vision tool fits.',
    defaultPrompt: 'Analyze the image content in detail. Describe visible objects, text, layout, context, and notable details.',
  },
  {
    name: 'extract_text_from_screenshot',
    title: 'Extract text from screenshot',
    description: 'OCR screenshots for code, terminals, documents, interfaces, and general visible text.',
    defaultPrompt: [
      'Extract all visible text from the screenshot.',
      'Preserve line breaks and reading order as much as possible.',
      'For code or terminal output, keep indentation, symbols, and error text intact.',
      'If some text is unclear, mark it as uncertain instead of inventing content.',
    ].join(' '),
  },
  {
    name: 'diagnose_error_screenshot',
    title: 'Diagnose error screenshot',
    description: 'Analyze an error screenshot and propose likely causes and actionable fixes.',
    defaultPrompt: [
      'Diagnose the error shown in the screenshot.',
      'Identify the visible error message, likely cause, and concrete next steps.',
      'Prioritize actionable debugging steps and mention uncertainty when the screenshot lacks context.',
    ].join(' '),
  },
  {
    name: 'understand_technical_diagram',
    title: 'Understand technical diagram',
    description: 'Interpret architecture, flow, UML, ER, and system diagrams.',
    defaultPrompt: [
      'Interpret this technical diagram.',
      'Explain the components, relationships, data/control flow, labels, and any implied system behavior.',
      'Call out ambiguous or unreadable parts separately.',
    ].join(' '),
  },
  {
    name: 'analyze_data_visualization',
    title: 'Analyze data visualization',
    description: 'Read charts and dashboards to surface insights, trends, outliers, and caveats.',
    defaultPrompt: [
      'Analyze this chart or dashboard.',
      'Extract the visible axes, metrics, legends, values, trends, outliers, comparisons, and likely takeaways.',
      'Do not overstate exact numbers when the image resolution is insufficient.',
    ].join(' '),
  },
  {
    name: 'ui_to_artifact',
    title: 'UI to artifact',
    description: 'Turn UI screenshots into code, prompts, specs, or descriptions.',
    inputSchema: uiToArtifactInputSchema,
    defaultPrompt: ({ output_type }) => {
      const type = output_type || 'description';
      return [
        `Convert this UI screenshot into a ${type} artifact.`,
        'Capture layout, hierarchy, visible text, controls, states, spacing, colors, and interaction-relevant details.',
        type === 'code'
          ? 'Produce implementation-oriented code guidance with component structure and styling details.'
          : '',
        type === 'prompt'
          ? 'Produce a clear prompt that another AI system could use to recreate the UI.'
          : '',
        type === 'spec'
          ? 'Produce a concise implementation specification for a developer.'
          : '',
        type === 'description'
          ? 'Produce a precise visual and functional description.'
          : '',
      ].filter(Boolean).join(' ');
    },
  },
  {
    name: 'ui_diff_check',
    title: 'UI diff check',
    description: 'Compare two UI screenshots and flag visual or implementation drift.',
    defaultPrompt: [
      'Compare these two UI screenshots.',
      'Identify visual differences in layout, spacing, typography, colors, content, controls, states, and alignment.',
      'Distinguish intentional-looking differences from likely implementation drift when possible.',
    ].join(' '),
    validateSources: (sources) => {
      if (!sources || sources.length !== 2) {
        throw new Error('ui_diff_check requires source to contain exactly two image paths or URLs.');
      }
    },
  },
];

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
        GENERAL_SOURCE_POLICY,
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

  for (const tool of visionTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: [tool.description, GENERAL_SOURCE_POLICY].join(' '),
        inputSchema: tool.inputSchema ?? analyzeImageInputSchema,
        outputSchema: analyzeImageOutputSchema,
        annotations: {
          title: tool.title,
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
      createAnalyzeImageHandler(undefined, {
        toolName: tool.name,
        defaultPrompt: tool.defaultPrompt,
        validateSources: tool.validateSources,
      }),
    );
  }

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
