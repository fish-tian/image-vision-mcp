import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { resetConfigForTests } from '../src/utils/config.js';
import { ApiError } from '../src/utils/errors.js';
import { cleanupPath, restoreEnv, snapshotEnv, testTempPath, writeJson } from './helpers/env.js';

let createMock = mock(async () => ({
  content: [{ type: 'text', text: '- Model cause: mocked diagnostic.\n- Model fix: mocked fix.' }],
}));

mock.module('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: createMock,
    };
  },
}));

const { buildErrorResponse } = await import('../src/utils/errorDiagnostics.js');

let env: Record<string, string | undefined>;
let tempConfigPath: string;

beforeEach(() => {
  env = snapshotEnv();
  tempConfigPath = testTempPath('config.json');
  process.env.IMAGE_VISION_CONFIG = tempConfigPath;
  process.env.LOG_LEVEL = 'error';
  createMock = mock(async () => ({
    content: [{ type: 'text', text: '- Model cause: mocked diagnostic.\n- Model fix: mocked fix.' }],
  }));
  resetConfigForTests();
});

afterEach(async () => {
  restoreEnv(env);
  await cleanupPath(tempConfigPath);
});

describe('error diagnostics', () => {
  test('token missing uses local diagnosis and skips model-assisted diagnosis', async () => {
    const text = await buildErrorResponse(
      new ApiError('API_TOKEN_MISSING', 'ANTHROPIC_AUTH_TOKEN is required'),
      { tool: 'analyze_image', hasSource: true, hasSessionId: false },
    );

    expect(text).toContain('Original error:');
    expect(text).toContain('[ApiError:API_TOKEN_MISSING]');
    expect(text).toContain('Local diagnosis:');
    expect(text).toContain('API token is missing or empty');
    expect(text).toContain('Skipped because the original error is API_TOKEN_MISSING.');
    expect(text).toContain('Show this error and diagnostic summary to the user');
    expect(createMock).not.toHaveBeenCalled();
  });

  test('missing ANTHROPIC_MODEL skips model-assisted diagnosis', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
      },
    });
    resetConfigForTests();

    const text = await buildErrorResponse(
      new ApiError('API_REQUEST_FAILED', 'Image analysis API request failed'),
      { tool: 'analyze_image', hasSource: true, hasSessionId: false },
    );

    expect(text).toContain('Skipped because ANTHROPIC_MODEL / diagnostics.model is not configured.');
    expect(createMock).not.toHaveBeenCalled();
  });

  test('configured ANTHROPIC_MODEL calls Anthropic SDK and includes analysis', async () => {
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
      },
      diagnostics: {
        model: 'claude-diagnostic',
        maxTokens: 123,
      },
    });
    resetConfigForTests();

    const text = await buildErrorResponse(
      new ApiError('API_REQUEST_FAILED', 'Image analysis API request failed'),
      { tool: 'analyze_image', hasSource: true, hasSessionId: false },
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].model).toBe('claude-diagnostic');
    expect(createMock.mock.calls[0][0].max_tokens).toBe(123);
    expect(text).toContain('- Model cause: mocked diagnostic.');
  });

  test('model-assisted diagnosis failure keeps original error and local diagnosis', async () => {
    createMock = mock(async () => {
      throw new Error('diagnostic failed');
    });
    await writeJson(tempConfigPath, {
      api: {
        authToken: 'test-token',
      },
      diagnostics: {
        model: 'claude-diagnostic',
      },
    });
    resetConfigForTests();

    const text = await buildErrorResponse(
      new ApiError('IMAGE_READ_FAILED', 'Failed to read image source: missing.png'),
      { tool: 'analyze_image', hasSource: true, hasSessionId: false },
    );

    expect(text).toContain('[ApiError:IMAGE_READ_FAILED]');
    expect(text).toContain('The image could not be read');
    expect(text).toContain('Model-assisted diagnosis was skipped or failed.');
  });
});
