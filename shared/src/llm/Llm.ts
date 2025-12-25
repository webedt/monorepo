/**
 * LLM implementation with provider fallback chain
 *
 * Provider priority:
 * 1. OpenRouter (cheap, fast) - requires OPENROUTER_API_KEY
 * 2. Claude Web empty repo (expensive fallback) - requires Claude auth
 */

import { ALlm } from './ALlm.js';
import { OPENROUTER_API_KEY } from '../config/env.js';
import { logger } from '../utils/logging/logger.js';
import type { LlmExecuteParams, LlmExecuteResult } from './types.js';

const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-3.5-haiku';

export class Llm extends ALlm {
  async execute(params: LlmExecuteParams): Promise<LlmExecuteResult> {
    const { prompt, model, maxTokens = 1024, temperature = 0.7, systemPrompt } = params;

    // Try OpenRouter first
    if (OPENROUTER_API_KEY) {
      try {
        return await this.executeOpenRouter(prompt, {
          model: model || OPENROUTER_DEFAULT_MODEL,
          maxTokens,
          temperature,
          systemPrompt,
        });
      } catch (error) {
        logger.warn('OpenRouter execution failed, trying fallback', {
          component: 'Llm',
          error: (error as Error).message,
        });
      }
    }

    // TODO: Add Claude Web fallback (empty repo + archive)
    // For now, throw if OpenRouter is not available
    throw new Error('No LLM provider available. Set OPENROUTER_API_KEY in your environment.');
  }

  private async executeOpenRouter(
    prompt: string,
    options: {
      model: string;
      maxTokens: number;
      temperature: number;
      systemPrompt?: string;
    }
  ): Promise<LlmExecuteResult> {
    const { model, maxTokens, temperature, systemPrompt } = options;

    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://webedt.io',
        'X-Title': 'WebEDT',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    const content = data.choices?.[0]?.message?.content || '';
    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;

    // Estimate cost (rough estimates for Claude 3.5 Haiku via OpenRouter)
    // Input: $0.25/1M tokens, Output: $1.25/1M tokens
    let cost: number | undefined;
    if (inputTokens !== undefined && outputTokens !== undefined) {
      cost = (inputTokens * 0.25 + outputTokens * 1.25) / 1_000_000;
    }

    return {
      content,
      provider: 'openrouter',
      model: data.model || model,
      cost,
      inputTokens,
      outputTokens,
    };
  }
}
