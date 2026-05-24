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
import { errorDetailForLog, summarizeApiMessages, textForLog, writeCallLog } from './callLogger.js';
import { getConfig, type ImageVisionConfig } from './config.js';
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
  const images = await Promise.all(sources.map((source) => readImageSource(source, callId)));
  const sessionId = await createSession(images, prompt, callId);
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

  await withLock(sessionId, async () => updateHistory(sessionId, nextMessages, callId));
  return { result, session_id: sessionId };
}

async function continueSession(
  sessionId: string,
  prompt: string,
  callId?: string,
): Promise<{ result: string; session_id: string }> {
  const session = await readSession(sessionId, callId);
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

  await withLock(sessionId, async () => updateHistory(sessionId, nextMessages, callId));
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
      data: {
        ...apiConfigForLog(config),
        error: formatError(error),
        errorDetail: errorDetailForLog(error),
      },
    });
    throw error;
  }

  const model = config.api.model;

  try {
    logger.info('api', 'requesting image analysis', { provider: config.api.provider, model, messageCount: messages.length });
    await writeCallLog({
      event: 'api.vision.request',
      callId,
      sessionId,
      status: 'start',
      data: {
        model,
        maxTokens: config.api.maxTokens,
        ...apiConfigForLog(config),
        messageCount: messages.length,
        ...summarizeApiMessages(messages),
      },
    });
    const response = config.api.provider === 'openai'
      ? await callOpenAiVisionApi(config, messages)
      : await callAnthropicVisionApi(config, messages);

    logger.info('api', 'received image analysis', {
      provider: config.api.provider,
      model,
      textLength: response.text.length,
    });
    await writeCallLog({
      event: 'api.vision.response',
      callId,
      sessionId,
      durationMs: Date.now() - startedAt,
      status: 'success',
      data: {
        model,
        apiMode: response.apiMode,
        fallbackReason: response.fallbackReason,
        stopReason: response.stop_reason,
        usage: response.usage,
        result: textForLog(response.text),
        textLength: response.text.length,
      },
    });
    return response.text;
  } catch (error) {
    if (error instanceof CacheError || error instanceof ApiError) {
      await writeCallLog({
        event: 'api.vision.error',
        callId,
        sessionId,
        durationMs: Date.now() - startedAt,
        status: 'error',
        data: {
          ...apiConfigForLog(config),
          error: formatError(error),
          errorDetail: errorDetailForLog(error),
        },
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
      data: {
        ...apiConfigForLog(config),
        error: formatError(apiError),
        errorDetail: errorDetailForLog(apiError),
      },
    });
    throw apiError;
  }
}

function apiConfigForLog(config: ImageVisionConfig): Record<string, unknown> {
  return {
    provider: config.api.provider,
    baseUrl: config.api.baseUrl || 'sdk-default',
    authToken: config.api.authToken ? '********' : '',
    authTokenConfigured: Boolean(config.api.authToken),
    authTokenSource: config.api.authTokenSource,
    model: config.api.model,
    maxTokens: config.api.maxTokens,
  };
}

interface VisionApiResponse {
  text: string;
  apiMode: 'non-streaming' | 'streaming' | 'openai-chat-completions';
  fallbackReason?: string;
  stop_reason?: Anthropic.Messages.Message['stop_reason'] | string | null;
  usage?: unknown;
}

interface OpenAiChatMessage {
  role: Anthropic.Messages.MessageParam['role'];
  content: string | Array<OpenAiTextContent | OpenAiImageContent>;
}

interface OpenAiTextContent {
  type: 'text';
  text: string;
}

interface OpenAiImageContent {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: unknown;
}

async function callVisionApiWithFallback(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
): Promise<VisionApiResponse> {
  try {
    const response = await client.messages.create(params);
    return {
      text: extractText(response),
      apiMode: 'non-streaming',
      stop_reason: response.stop_reason,
      usage: response.usage,
    };
  } catch (error) {
    if (!isStreamingRequiredError(error)) {
      throw error;
    }

    const response = await callVisionApiStreaming(client, params);
    return {
      ...response,
      fallbackReason: 'sdk-requires-streaming-for-large-max-tokens',
    };
  }
}

async function callAnthropicVisionApi(
  config: ImageVisionConfig,
  messages: Anthropic.Messages.MessageParam[],
): Promise<VisionApiResponse> {
  const client = new Anthropic({
    apiKey: config.api.authToken,
    baseURL: config.api.baseUrl,
  });

  return callVisionApiWithFallback(client, {
    model: config.api.model,
    max_tokens: config.api.maxTokens,
    messages,
  });
}

async function callOpenAiVisionApi(
  config: ImageVisionConfig,
  messages: Anthropic.Messages.MessageParam[],
): Promise<VisionApiResponse> {
  if (!config.api.baseUrl) {
    throw new ApiError('API_REQUEST_FAILED', 'api.baseUrl is required when api.provider is openai');
  }

  const response = await fetch(openAiChatCompletionsUrl(config.api.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.api.authToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.api.model,
      max_tokens: config.api.maxTokens,
      messages: toOpenAiMessages(messages),
    }),
  });

  const text = await response.text();
  const body = parseJson(text);
  if (!response.ok) {
    throw Object.assign(new Error(`OpenAI-compatible API request failed: HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }

  const completion = body as OpenAiChatCompletionResponse;
  return {
    text: extractOpenAiText(completion),
    apiMode: 'openai-chat-completions',
    stop_reason: completion.choices?.[0]?.finish_reason ?? null,
    usage: completion.usage,
  };
}

async function callVisionApiStreaming(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
): Promise<VisionApiResponse> {
  const stream = client.messages.stream(params);
  let text = '';
  let stopReason: Anthropic.Messages.Message['stop_reason'] | undefined;
  let usage: Record<string, unknown> | undefined;

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text;
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason ?? stopReason;
      usage = event.usage ? { ...usage, ...event.usage } : usage;
    }
  }

  return {
    text: text.trim(),
    apiMode: 'streaming',
    stop_reason: stopReason,
    usage,
  };
}

function extractText(response: Anthropic.Messages.Message): string {
  return response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function toOpenAiMessages(messages: Anthropic.Messages.MessageParam[]): OpenAiChatMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return {
        role: message.role,
        content: message.content,
      };
    }

    const content = message.content.map((block) => {
      if (block.type === 'text') {
        return {
          type: 'text' as const,
          text: block.text,
        };
      }

      if (block.type === 'image' && block.source.type === 'base64') {
        return {
          type: 'image_url' as const,
          image_url: {
            url: `data:${block.source.media_type};base64,${block.source.data}`,
          },
        };
      }

      throw new ApiError('API_REQUEST_FAILED', `Unsupported content block for OpenAI-compatible provider: ${block.type}`);
    });

    return {
      role: message.role,
      content,
    };
  });
}

function openAiChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function extractOpenAiText(response: OpenAiChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' || part.type === undefined ? part.text ?? '' : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isStreamingRequiredError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Streaming is required');
}
