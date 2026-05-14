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
import { summarizeApiMessages, textForLog, writeCallLog } from './callLogger.js';
import { getConfig } from './config.js';
import { ApiError, CacheError, formatError } from './errors.js';
import { readImageSource } from './imageReader.js';
import { logger } from './logger.js';

export async function analyzeImage(
  sources: string[] | null,
  sessionId: string | null,
  prompt?: string,
  callId?: string,
): Promise<{ result: string; session_id: string }> {
  const effectivePrompt = prompt || getConfig().api.defaultPrompt;

  if (sessionId) {
    return continueSession(sessionId, effectivePrompt, callId);
  }

  if (!sources || sources.length === 0) {
    throw new ApiError('NO_IMAGE_PROVIDED', 'source is required for the first image analysis call');
  }

  return startSession(sources, effectivePrompt, callId);
}

async function startSession(
  sources: string[],
  prompt: string,
  callId?: string,
): Promise<{ result: string; session_id: string }> {
  const images = await Promise.all(sources.map(readImageSource));
  const sessionId = await createSession(images, prompt);
  const userMessage: StoredMessageParam = {
    role: 'user',
    content: [
      ...imageRefsToBlocks(images),
      { type: 'text', text: prompt },
    ],
  };
  const storedMessages: StoredMessageParam[] = [userMessage];
  const runtimeImages = new Map(images.map((image) => [image.hash, image]));
  const apiMessages = expandStoredMessages(storedMessages, runtimeImages);
  const result = await callVisionApi(apiMessages, sessionId, callId);
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
  callId?: string,
): Promise<{ result: string; session_id: string }> {
  const session = await readSession(sessionId);
  if (!session) {
    throw new ApiError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`);
  }

  const question: StoredMessageParam = {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
  };
  const storedMessages: StoredMessageParam[] = [...session.history.messages, question];
  const apiMessages = expandStoredMessages(storedMessages, session.images);
  const result = await callVisionApi(apiMessages, sessionId, callId);
  const nextMessages: StoredMessageParam[] = [
    ...storedMessages,
    { role: 'assistant', content: result },
  ];

  await withLock(sessionId, async () => updateHistory(sessionId, nextMessages));
  return { result, session_id: sessionId };
}

async function callVisionApi(
  messages: Anthropic.Messages.MessageParam[],
  sessionId: string,
  callId?: string,
): Promise<string> {
  const startedAt = Date.now();
  const config = getConfig();
  const apiKey = config.api.authToken;
  if (!apiKey) {
    const error = new ApiError(
      'API_TOKEN_MISSING',
      `ANTHROPIC_AUTH_TOKEN is required. Set it in the environment or set a non-empty api.authToken in ${config.configPath}.`,
    );
    await writeCallLog({
      event: 'api.vision.error',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      data: { error: formatError(error) },
    });
    throw error;
  }

  const client = new Anthropic({
    apiKey,
    baseURL: config.api.baseUrl,
  });
  const model = config.api.model;

  try {
    logger.info('api', 'requesting image analysis', { model, messageCount: messages.length });
    await writeCallLog({
      event: 'api.vision.request',
      callId,
      sessionId,
      status: 'start',
      data: {
        model,
        maxTokens: config.api.maxTokens,
        messageCount: messages.length,
        ...summarizeApiMessages(messages),
      },
    });
    const stream = client.messages.stream({
      model,
      max_tokens: config.api.maxTokens,
      messages,
    });
    let text = '';

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
      }
    }

    logger.info('api', 'received image analysis', { model, textLength: text.length });
    await writeCallLog({
      event: 'api.vision.response',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      data: {
        model,
        result: textForLog(text),
        textLength: text.length,
      },
    });
    return text;
  } catch (error) {
    if (error instanceof CacheError || error instanceof ApiError) {
      await writeCallLog({
        event: 'api.vision.error',
        callId,
        sessionId,
        durationMs: Date.now() - startedAt,
        status: 'error',
        data: { error: formatError(error) },
      });
      throw error;
    }

    const apiError = new ApiError('API_REQUEST_FAILED', 'Image analysis API request failed', error);
    await writeCallLog({
      event: 'api.vision.error',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'error',
      data: { error: formatError(apiError) },
    });
    throw apiError;
  }
}
