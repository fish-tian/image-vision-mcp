import Anthropic from '@anthropic-ai/sdk';

import {
  createSession,
  expandStoredMessages,
  imageRefsToBlocks,
  readSession,
  updateHistory,
  withLock,
  type StoredMessageParam,
} from './cache.js';
import { ApiError, CacheError } from './errors.js';
import { readImageSource } from './imageReader.js';
import { logger } from './logger.js';

const DEFAULT_MODEL = 'openai/qwen3.6-plus';
const DEFAULT_PROMPT = '请分析图片内容。';

export async function analyzeImage(
  sources: string[] | null,
  sessionId: string | null,
  prompt = DEFAULT_PROMPT,
): Promise<{ result: string; session_id: string }> {
  if (sessionId) {
    return continueSession(sessionId, prompt);
  }

  if (!sources || sources.length === 0) {
    throw new ApiError('NO_IMAGE_PROVIDED', 'source is required for the first image analysis call');
  }

  return startSession(sources, prompt);
}

async function startSession(
  sources: string[],
  prompt: string,
): Promise<{ result: string; session_id: string }> {
  const images = await Promise.all(sources.map(readImageSource));
  const sessionId = await createSession(images, prompt);
  const userMessage: StoredMessageParam = {
    role: 'user',
    content: [
      ...imageRefsToBlocks(images),
      { type: 'text', text: prompt || DEFAULT_PROMPT },
    ],
  };
  const storedMessages: StoredMessageParam[] = [userMessage];
  const runtimeImages = new Map(images.map((image) => [image.hash, image]));
  const apiMessages = expandStoredMessages(storedMessages, runtimeImages);
  const result = await callVisionApi(apiMessages);
  const nextMessages: StoredMessageParam[] = [
    ...storedMessages,
    { role: 'assistant', content: result },
  ];

  await withLock(sessionId, async () => updateHistory(sessionId, nextMessages));
  return { result, session_id: sessionId };
}

async function continueSession(
  sessionId: string,
  prompt: string,
): Promise<{ result: string; session_id: string }> {
  const session = await readSession(sessionId);
  if (!session) {
    throw new ApiError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
  }

  const question: StoredMessageParam = {
    role: 'user',
    content: [{ type: 'text', text: prompt || DEFAULT_PROMPT }],
  };
  const storedMessages: StoredMessageParam[] = [...session.history.messages, question];
  const apiMessages = expandStoredMessages(storedMessages, session.images);
  const result = await callVisionApi(apiMessages);
  const nextMessages: StoredMessageParam[] = [
    ...storedMessages,
    { role: 'assistant', content: result },
  ];

  await withLock(sessionId, async () => updateHistory(sessionId, nextMessages));
  return { result, session_id: sessionId };
}

async function callVisionApi(
  messages: Anthropic.Messages.MessageParam[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new ApiError('API_TOKEN_MISSING', 'ANTHROPIC_AUTH_TOKEN is required');
  }

  const client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });
  const model = process.env.QWEN_MODEL || DEFAULT_MODEL;

  try {
    logger.info('api', 'requesting image analysis', { model, messageCount: messages.length });
    const stream = client.messages.stream({
      model,
      max_tokens: 64_000,
      messages,
    });
    let text = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
      }
    }

    logger.info('api', 'received image analysis', { model, textLength: text.length });
    return text;
  } catch (error) {
    if (error instanceof CacheError || error instanceof ApiError) {
      throw error;
    }

    throw new ApiError('API_REQUEST_FAILED', 'Image analysis API request failed', error);
  }
}
