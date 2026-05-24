import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { initCache } from '../src/utils/cache.js';
import { resetConfigForTests } from '../src/utils/config.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeBinary, writeJson } from './helpers/env.js';

let createMock = mock(() => Promise.resolve({
  content: [
    { type: 'text', text: 'mocked result' },
  ],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: 10,
    output_tokens: 2,
  },
}));
let streamMock = mock(() => ({
  async *[Symbol.asyncIterator]() {
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed ' } };
    yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } };
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 2 },
    };
  },
}));
let originalFetch: typeof globalThis.fetch;

mock.module('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: createMock,
      stream: streamMock,
    };
  },
}));

const { analyzeImage } = await import('../src/utils/qwenApi.js');

let env: Record<string, string | undefined>;
let tempConfigPath: string;
let cacheDir: string;
let logDir: string;
let imagePath: string;

beforeEach(async () => {
  env = snapshotEnv();
  originalFetch = globalThis.fetch;
  tempConfigPath = testTempPath('config.json');
  cacheDir = testTempPath('cache');
  logDir = testTempPath('call-logs');
  imagePath = testTempPath('image.png');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  createMock = mock(() => Promise.resolve({
    content: [
      { type: 'text', text: 'mocked result' },
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 2,
    },
  }));
  streamMock = mock(() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed ' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 2 },
      };
    },
  }));
  await writeBinary(imagePath, new Uint8Array([137, 80, 78, 71]));
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
  await cleanupPath(cacheDir);
  await cleanupPath(logDir);
  await cleanupPath(imagePath);
});

describe('qwen API call logging', () => {
  test('writes API request and response call logs', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
        baseUrl: 'https://api.example.test/v1?signature=secret&region=hk',
        model: 'test-model',
        maxTokens: 123,
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
          includeText: true,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    const result = await analyzeImage([imagePath], null, 'describe token=plain', 'call_test');

    expect(result.result).toBe('mocked result');
    expect(createMock).toHaveBeenCalledTimes(1);

    const entries = await readLogEntries();
    const request = entries.find((entry) => entry.event === 'api.vision.request');
    const response = entries.find((entry) => entry.event === 'api.vision.response');

    expect(request?.callId).toBe('call_test');
    expect(request?.sessionId).toBe(result.session_id);
    expect(request?.data.model).toBe('test-model');
    expect(request?.data.provider).toBe('anthropic');
    expect(request?.data.maxTokens).toBe(123);
    expect(request?.data.baseUrl).toBe('https://api.example.test/v1?signature=********&region=hk');
    expect(request?.data.authToken).toBe('********');
    expect(request?.data.authTokenConfigured).toBe(true);
    expect(request?.data.authTokenSource).toBe('config');
    expect(request?.data.imageCount).toBe(1);
    expect(JSON.stringify(request)).not.toContain('test-token');
    expect(JSON.stringify(request)).not.toContain(Buffer.from(new Uint8Array([137, 80, 78, 71])).toString('base64'));
    expect(response?.data.result).toBe('mocked result');
    expect(response?.data.apiMode).toBe('non-streaming');
    expect(response?.data.stopReason).toBe('end_turn');
    expect(response?.data.usage).toEqual({ input_tokens: 10, output_tokens: 2 });
    expect(response?.data.textLength).toBe('mocked result'.length);
  });

  test('joins all non-streaming response text blocks', async () => {
    createMock = mock(() => Promise.resolve({
      content: [
        { type: 'text', text: 'first part' },
        { type: 'text', text: 'second part' },
      ],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 4,
      },
    }));
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
        model: 'test-model',
      },
      cache: {
        dir: cacheDir,
      },
    });
    resetConfigForTests();
    await initCache();

    const result = await analyzeImage([imagePath], null, 'describe', 'call_text_blocks');

    expect(result.result).toBe('first part\nsecond part');
  });

  test('falls back to streaming when SDK requires it for large max_tokens', async () => {
    createMock = mock(() => {
      throw new Error('Streaming is required for operations that may take longer than 10 minutes.');
    });
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
        model: 'test-model',
        maxTokens: 64_000,
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    const result = await analyzeImage([imagePath], null, 'describe', 'call_stream_fallback');

    expect(result.result).toBe('streamed result');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(streamMock).toHaveBeenCalledTimes(1);
    const entries = await readLogEntries();
    const response = entries.find((entry) => entry.event === 'api.vision.response');
    expect(response?.data.apiMode).toBe('streaming');
    expect(response?.data.fallbackReason).toBe('sdk-requires-streaming-for-large-max-tokens');
  });

  test('writes API error call log when token is missing', async () => {
    await writeJson(tempConfigPath, {
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    await expect(analyzeImage([imagePath], null, 'describe', 'call_missing_token')).rejects.toThrow('ANTHROPIC_AUTH_TOKEN');

    const entries = await readLogEntries();
    const error = entries.find((entry) => entry.event === 'api.vision.error');
    expect(error?.callId).toBe('call_missing_token');
    expect(error?.status).toBe('error');
    expect(error?.data.baseUrl).toBe('sdk-default');
    expect(error?.data.authToken).toBe('');
    expect(error?.data.authTokenConfigured).toBe(false);
    expect(error?.data.authTokenSource).toBe('missing');
    expect(error?.data.model).toBe('openai/qwen3.6-plus');
    expect(error?.data.provider).toBe('anthropic');
    expect(error?.data.maxTokens).toBe(64_000);
    expect(error?.data.error).toContain('API_TOKEN_MISSING');
    expect(error?.data.errorDetail.message).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  test('writes SDK error details and masks sensitive fields', async () => {
    createMock = mock(() => {
      throw Object.assign(new Error('upstream rejected request'), {
        status: 401,
        code: 'unauthorized',
        type: 'authentication_error',
        request_id: 'req_456',
        headers: {
          authorization: 'Bearer test-token',
          'x-request-id': 'req_456',
        },
        body: {
          message: 'invalid token',
          apiKey: 'test-token',
        },
        cause: Object.assign(new Error('http 401'), {
          token: 'test-token',
        }),
      });
    });
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
        baseUrl: 'https://api.example.test/v1',
        model: 'test-model',
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    await expect(analyzeImage([imagePath], null, 'describe', 'call_sdk_error')).rejects.toThrow('Image analysis API request failed');

    const entries = await readLogEntries();
    const error = entries.find((entry) => entry.event === 'api.vision.error');
    expect(error?.callId).toBe('call_sdk_error');
    expect(error?.data.error).toContain('API_REQUEST_FAILED');
    expect(error?.data.errorDetail.cause.message).toBe('upstream rejected request');
    expect(error?.data.errorDetail.cause.status).toBe(401);
    expect(error?.data.errorDetail.cause.code).toBe('unauthorized');
    expect(error?.data.errorDetail.cause.type).toBe('authentication_error');
    expect(error?.data.errorDetail.cause.requestId).toBe('req_456');
    expect(error?.data.errorDetail.cause.headers.authorization).toBe('********');
    expect(error?.data.errorDetail.cause.headers['x-request-id']).toBe('req_456');
    expect(error?.data.errorDetail.cause.body.apiKey).toBe('********');
    expect(error?.data.errorDetail.cause.cause.token).toBe('********');
  });

  test('calls OpenAI-compatible chat completions with data URL image content', async () => {
    const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: 'openai vision result',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await writeJson(tempConfigPath, {
      api: {
        provider: 'openai',
        authToken: 'test-token',
        baseUrl: 'https://api.example.test/v1/',
        model: 'test-openai-model',
        maxTokens: 321,
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
          includeText: true,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    const result = await analyzeImage([imagePath], null, 'extract text', 'call_openai');

    expect(result.result).toBe('openai vision result');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-openai-model');
    expect(body.max_tokens).toBe(321);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image_url',
      image_url: {
        url: `data:image/png;base64,${Buffer.from(new Uint8Array([137, 80, 78, 71])).toString('base64')}`,
      },
    });
    expect(body.messages[0].content[1]).toEqual({
      type: 'text',
      text: 'extract text',
    });

    const entries = await readLogEntries();
    const request = entries.find((entry) => entry.event === 'api.vision.request');
    const response = entries.find((entry) => entry.event === 'api.vision.response');
    expect(request?.data.provider).toBe('openai');
    expect(response?.data.apiMode).toBe('openai-chat-completions');
    expect(response?.data.stopReason).toBe('stop');
    expect(response?.data.usage).toEqual({ prompt_tokens: 12, completion_tokens: 3 });
    expect(JSON.stringify(request)).not.toContain(body.messages[0].content[0].image_url.url);
  });

  test('wraps OpenAI-compatible HTTP errors and masks sensitive details in logs', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({
      error: {
        message: 'bad key',
        apiKey: 'test-token',
      },
    }), { status: 401, headers: { 'content-type': 'application/json' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await writeJson(tempConfigPath, {
      api: {
        provider: 'openai',
        authToken: 'test-token',
        baseUrl: 'https://api.example.test/v1',
        model: 'test-openai-model',
      },
      cache: {
        dir: cacheDir,
      },
      log: {
        call: {
          enabled: true,
          dir: logDir,
        },
      },
    });
    resetConfigForTests();
    await initCache();

    await expect(analyzeImage([imagePath], null, 'describe', 'call_openai_error')).rejects.toThrow('Image analysis API request failed');

    const entries = await readLogEntries();
    const error = entries.find((entry) => entry.event === 'api.vision.error');
    expect(error?.data.provider).toBe('openai');
    expect(error?.data.error).toContain('API_REQUEST_FAILED');
    expect(error?.data.errorDetail.cause.status).toBe(401);
    expect(error?.data.errorDetail.cause.body.error.apiKey).toBe('********');
    expect(JSON.stringify(error)).not.toContain('test-token');
  });
});

async function readLogEntries(): Promise<Array<Record<string, any>>> {
  const files = await readdir(logDir);
  const text = await readFile(join(logDir, files[0]), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}
