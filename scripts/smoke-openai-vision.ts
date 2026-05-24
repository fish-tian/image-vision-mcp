import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import { getConfig } from '../src/utils/config.js';

const ONE_BY_ONE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const imagePath = process.argv[2];
const config = getConfig();

if (config.api.provider !== 'openai') {
  throw new Error('Set api.provider to "openai" before running this smoke test.');
}

if (!config.api.authToken) {
  throw new Error('Set api.authToken or ANTHROPIC_AUTH_TOKEN before running this smoke test.');
}

if (!config.api.baseUrl) {
  throw new Error('Set api.baseUrl before running this smoke test.');
}

const image = imagePath
  ? {
      mediaType: mediaTypeForPath(imagePath),
      base64: Buffer.from(await readFile(imagePath)).toString('base64'),
    }
  : {
      mediaType: 'image/png',
      base64: ONE_BY_ONE_PNG,
    };

const response = await fetch(`${config.api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${config.api.authToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: config.api.model,
    max_tokens: Math.min(config.api.maxTokens, 256),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image briefly.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${image.mediaType};base64,${image.base64}`,
            },
          },
        ],
      },
    ],
  }),
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`OpenAI-compatible vision smoke test failed: HTTP ${response.status} ${text}`);
}

const body = JSON.parse(text) as {
  choices?: Array<{ message?: { content?: string } }>;
};

console.log(body.choices?.[0]?.message?.content ?? '');

function mediaTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
