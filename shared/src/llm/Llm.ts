/**
 * LLM implementation with provider fallback chain
 *
 * Provider priority:
 * 1. OpenRouter (cheap, fast) - requires OPENROUTER_API_KEY
 * 2. Claude Web empty repo (expensive fallback) - requires Claude auth
 */

import { ALlm } from './ALlm.js';
import { OPENROUTER_API_KEY, CLAUDE_ENVIRONMENT_ID, LLM_FALLBACK_REPO_URL } from '../config/env.js';
import { getClaudeCredentials } from '../auth/claudeAuth.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';
import { logger } from '../utils/logging/logger.js';
import type { LlmExecuteParams, LlmExecuteResult } from './types.js';
import type { SessionEvent } from '../claudeWeb/types.js';

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

    // Claude Web fallback (expensive, but works without API key)
    try {
      return await this.executeClaudeWeb(prompt, { systemPrompt });
    } catch (error) {
      logger.warn('Claude Web fallback failed', {
        component: 'Llm',
        error: (error as Error).message,
      });
    }

    throw new Error('No LLM provider available. Set OPENROUTER_API_KEY or configure Claude credentials.');
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

  private async executeClaudeWeb(
    prompt: string,
    options: { systemPrompt?: string } = {}
  ): Promise<LlmExecuteResult> {
    const { systemPrompt } = options;

    // Get Claude credentials
    const credentials = await getClaudeCredentials({ checkDatabase: true });
    if (!credentials) {
      throw new Error('Claude credentials not available');
    }

    if (!CLAUDE_ENVIRONMENT_ID) {
      throw new Error('CLAUDE_ENVIRONMENT_ID not configured');
    }

    // Create client
    const client = new ClaudeWebClient({
      accessToken: credentials.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
    });

    // Build the full prompt with system prompt if provided
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${prompt}`
      : prompt;

    // Collect response text from events
    let responseText = '';
    let totalCost: number | undefined;

    const events: SessionEvent[] = [];
    const onEvent = (event: SessionEvent) => {
      events.push(event);

      // Extract text from assistant messages
      if (event.type === 'assistant' && event.message) {
        const content = event.message.content;
        if (typeof content === 'string') {
          responseText += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              responseText += block.text;
            }
          }
        }
      }

      // Capture cost from result event
      if (event.type === 'result' && event.total_cost_usd !== undefined) {
        totalCost = event.total_cost_usd;
      }
    };

    logger.info('Executing Claude Web fallback', {
      component: 'Llm',
      repoUrl: LLM_FALLBACK_REPO_URL,
    });

    // Execute the session
    const result = await client.execute(
      {
        prompt: fullPrompt,
        gitUrl: LLM_FALLBACK_REPO_URL,
        title: 'LLM Request',
      },
      onEvent
    );

    // Archive the session to clean up
    try {
      await client.archiveSession(result.sessionId);
      logger.debug('Archived Claude Web session', {
        component: 'Llm',
        sessionId: result.sessionId,
      });
    } catch (archiveError) {
      logger.warn('Failed to archive Claude Web session', {
        component: 'Llm',
        sessionId: result.sessionId,
        error: (archiveError as Error).message,
      });
    }

    if (!responseText) {
      throw new Error('No response received from Claude Web');
    }

    return {
      content: responseText.trim(),
      provider: 'claude-web',
      model: 'claude-opus-4-5-20251101',
      cost: totalCost,
    };
  }
}
