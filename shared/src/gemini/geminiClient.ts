/**
 * Gemini Client Implementation
 *
 * Client for Google's Gemini API with streaming support.
 * Uses OAuth tokens from Gemini CLI authentication.
 */

import { v4 as uuidv4 } from 'uuid';
import { AGeminiClient, type GeminiEventCallback } from './AGeminiClient.js';
import { GeminiError } from './types.js';
import { GEMINI_API_BASE_URL, GEMINI_DEFAULT_MODEL } from '../config/env.js';
import { logger } from '../utils/logging/logger.js';

import type { GeminiClientConfig } from './types.js';
import type { GenerateContentParams } from './types.js';
import type { GeminiSessionResult } from './types.js';
import type { StreamOptions } from './types.js';
import type { Content } from './types.js';
import type { Part } from './types.js';
import type { GenerateContentStreamChunk } from './types.js';
import type { GenerateContentResponse } from './types.js';

/**
 * Convert prompt to Gemini Parts format
 */
function promptToParts(prompt: string | Part[]): Part[] {
  if (typeof prompt === 'string') {
    return [{ text: prompt }];
  }
  return prompt;
}

/**
 * Parse streaming response line
 */
function parseStreamLine(line: string): GenerateContentStreamChunk | null {
  if (!line.startsWith('data: ')) {
    return null;
  }

  const data = line.slice(6).trim();
  if (data === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(data) as GenerateContentStreamChunk;
  } catch {
    return null;
  }
}

export class GeminiClient extends AGeminiClient {
  private accessToken: string = '';
  private baseUrl: string = GEMINI_API_BASE_URL;
  private model: string = GEMINI_DEFAULT_MODEL;

  configure(config: GeminiClientConfig): void {
    this.accessToken = config.accessToken;
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    }
    if (config.model) {
      this.model = config.model;
    }
  }

  /**
   * Generate content with non-streaming response
   */
  async generateContent(
    params: GenerateContentParams,
    onEvent: GeminiEventCallback,
    options?: StreamOptions
  ): Promise<GeminiSessionResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();
    const model = params.model || this.model;

    logger.info('Gemini generateContent starting', {
      component: 'GeminiClient',
      sessionId,
      model,
    });

    // Emit user message event
    await onEvent({
      uuid: uuidv4(),
      type: 'user',
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: params.prompt,
      },
    });

    const contents: Content[] = [
      ...(params.history || []),
      {
        role: 'user',
        parts: promptToParts(params.prompt),
      },
    ];

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    };

    if (params.systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: params.systemInstruction }],
      };
    }

    const url = `${this.baseUrl}/models/${model}:generateContent`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: options?.abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new GeminiError(
          `Gemini API error: ${response.status}`,
          response.status,
          errorText
        );
      }

      const data = await response.json() as GenerateContentResponse;
      const candidate = data.candidates?.[0];
      const responseText = candidate?.content?.parts
        ?.map((p: Part) => ('text' in p ? p.text : ''))
        .join('') || '';

      // Emit assistant response event
      await onEvent({
        uuid: uuidv4(),
        type: 'assistant',
        timestamp: new Date().toISOString(),
        message: {
          role: 'model',
          content: responseText,
          model,
        },
      });

      // Emit result event
      const totalTokens = data.usageMetadata?.totalTokenCount || 0;
      await onEvent({
        uuid: uuidv4(),
        type: 'result',
        timestamp: new Date().toISOString(),
        totalTokens,
        data: {
          finishReason: candidate?.finishReason,
          usageMetadata: data.usageMetadata,
        },
      });

      return {
        sessionId,
        status: 'completed',
        totalTokens,
        durationMs: Date.now() - startTime,
        response: responseText,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (error instanceof Error && error.name === 'AbortError') {
        await onEvent({
          uuid: uuidv4(),
          type: 'result',
          timestamp: new Date().toISOString(),
          data: { interrupted: true },
        });

        return {
          sessionId,
          status: 'interrupted',
          durationMs: Date.now() - startTime,
        };
      }

      await onEvent({
        uuid: uuidv4(),
        type: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Generate content with streaming response
   */
  async generateContentStream(
    params: GenerateContentParams,
    onEvent: GeminiEventCallback,
    options?: StreamOptions
  ): Promise<GeminiSessionResult> {
    const sessionId = uuidv4();
    const startTime = Date.now();
    const model = params.model || this.model;

    logger.info('Gemini generateContentStream starting', {
      component: 'GeminiClient',
      sessionId,
      model,
    });

    // Emit user message event
    await onEvent({
      uuid: uuidv4(),
      type: 'user',
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: params.prompt,
      },
    });

    const contents: Content[] = [
      ...(params.history || []),
      {
        role: 'user',
        parts: promptToParts(params.prompt),
      },
    ];

    const requestBody: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    };

    if (params.systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: params.systemInstruction }],
      };
    }

    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: options?.abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new GeminiError(
          `Gemini API error: ${response.status}`,
          response.status,
          errorText
        );
      }

      if (!response.body) {
        throw new GeminiError('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let totalTokens = 0;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const chunk = parseStreamLine(line);
          if (!chunk) continue;

          const candidate = chunk.candidates?.[0];
          if (candidate?.content?.parts) {
            const text = candidate.content.parts
              .map((p: Part) => ('text' in p ? p.text : ''))
              .join('');

            if (text) {
              fullResponse += text;

              // Emit streaming assistant event
              await onEvent({
                uuid: uuidv4(),
                type: 'assistant',
                timestamp: new Date().toISOString(),
                message: {
                  role: 'model',
                  content: text,
                  model,
                },
                data: {
                  streaming: true,
                  accumulated: fullResponse,
                },
              });
            }
          }

          if (chunk.usageMetadata) {
            totalTokens = chunk.usageMetadata.totalTokenCount || 0;
          }
        }
      }

      // Process any remaining buffer
      if (buffer) {
        const chunk = parseStreamLine(buffer);
        if (chunk?.usageMetadata) {
          totalTokens = chunk.usageMetadata.totalTokenCount || 0;
        }
      }

      // Emit final result event
      await onEvent({
        uuid: uuidv4(),
        type: 'result',
        timestamp: new Date().toISOString(),
        totalTokens,
        data: {
          finalResponse: fullResponse,
        },
      });

      return {
        sessionId,
        status: 'completed',
        totalTokens,
        durationMs: Date.now() - startTime,
        response: fullResponse,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (error instanceof Error && error.name === 'AbortError') {
        await onEvent({
          uuid: uuidv4(),
          type: 'result',
          timestamp: new Date().toISOString(),
          data: { interrupted: true },
        });

        return {
          sessionId,
          status: 'interrupted',
          durationMs: Date.now() - startTime,
        };
      }

      await onEvent({
        uuid: uuidv4(),
        type: 'error',
        timestamp: new Date().toISOString(),
        error: errorMessage,
      });

      throw error;
    }
  }
}
