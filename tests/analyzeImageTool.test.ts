import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { createAnalyzeImageHandler } from '../src/analyzeImageTool.js';
import { restoreEnv, snapshotEnv } from './helpers/env.js';

let env: Record<string, string | undefined>;

beforeEach(() => {
  env = snapshotEnv();
  process.env.CALL_LOG_ENABLED = 'false';
});

afterEach(() => {
  restoreEnv(env);
});

describe('analyze_image tool response', () => {
  test('returns upstream result as the only visible text and puts session_id in structured content', async () => {
    const analyzeImageMock = mock(async () => ({
      result: 'mocked upstream result',
      session_id: 'img_test_session',
    }));
    const handler = createAnalyzeImageHandler(analyzeImageMock);

    const response = await handler({
      source: 'C:\\Users\\you\\Pictures\\example.png',
      prompt: 'describe it',
    });

    expect(response.content).toEqual([
      {
        type: 'text',
        text: 'mocked upstream result',
      },
    ]);
    expect(response.content[0].text).not.toContain('session_id');
    expect(response.content[0].text).not.toContain('---');
    expect(response.structuredContent).toEqual({
      result: 'mocked upstream result',
      session_id: 'img_test_session',
    });
    expect(response._meta).toEqual({
      session_id: 'img_test_session',
      resultLength: 'mocked upstream result'.length,
    });
    expect(analyzeImageMock).toHaveBeenCalledWith(
      ['C:\\Users\\you\\Pictures\\example.png'],
      null,
      'describe it',
      expect.stringMatching(/^call_/),
    );
  });

  test('keeps follow-up session_id out of visible text', async () => {
    const analyzeImageMock = mock(async () => ({
      result: 'follow-up answer',
      session_id: 'img_existing_session',
    }));
    const handler = createAnalyzeImageHandler(analyzeImageMock);

    const response = await handler({
      session_id: 'img_existing_session',
      prompt: 'what text is visible?',
    });

    expect(response.content[0].text).toBe('follow-up answer');
    expect(response.content[0].text).not.toContain('img_existing_session');
    expect(response.structuredContent?.session_id).toBe('img_existing_session');
    expect(analyzeImageMock).toHaveBeenCalledWith(
      null,
      'img_existing_session',
      'what text is visible?',
      expect.stringMatching(/^call_/),
    );
  });
});
