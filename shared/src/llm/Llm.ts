/**
 * LLM implementation with provider fallback chain
 *
 * Provider priority:
 * 1. OpenRouter (cheap, fast) - requires OPENROUTER_API_KEY
 * 2. Claude Web empty repo (expensive fallback) - requires Claude auth
 */

import { ALlm } from './ALlm.js';
import { OPENROUTER_API_KEY, LLM_FALLBACK_REPO, CLAUDE_ENVIRONMENT_ID } from '../config/env.js';
import { logger } from '../utils/logging/logger.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';
import { getClaudeCredentials } from '../auth/claudeAuth.js';
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

    // Try Claude Web fallback (empty repo + archive)
    if (LLM_FALLBACK_REPO && CLAUDE_ENVIRONMENT_ID) {
      try {
        return await this.executeClaudeWeb(prompt, { systemPrompt });
      } catch (error) {
        logger.warn('Claude Web fallback failed', {
          component: 'Llm',
          error: (error as Error).message,
        });
      }
    }

    throw new Error('No LLM provider available. Set OPENROUTER_API_KEY or configure Claude Web fallback (LLM_FALLBACK_REPO + Claude auth).');
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
    options: { systemPrompt?: string }
  ): Promise<LlmExecuteResult> {
    const { systemPrompt } = options;

    // Get Claude credentials
    const credentials = await getClaudeCredentials({ checkDatabase: true });
    if (!credentials) {
      throw new Error('No Claude credentials available for fallback');
    }

    // Construct full prompt with system prompt if provided
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${prompt}`
      : prompt;

    // Wrap prompt with instructions to respond directly (not as code)
    const llmPrompt = `You are being used as a simple LLM API. Respond directly with your answer. Do NOT:
- Make any code changes
- Use any tools
- Create branches or commits

Just read this prompt and respond with text:

${fullPrompt}`;

    const client = new ClaudeWebClient({
      accessToken: credentials.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
    });

    let responseContent = '';
    let totalCost: number | undefined;
    let sessionId: string | undefined;

    const events: SessionEvent[] = [];

    try {
      logger.info('Executing Claude Web fallback', {
        component: 'Llm',
        promptLength: prompt.length,
      });

      const result = await client.execute(
        {
          prompt: llmPrompt,
          gitUrl: LLM_FALLBACK_REPO,
          title: `LLM: ${prompt.slice(0, 30)}...`,
          branchPrefix: 'claude/llm-fallback',
        },
        (event) => {
          events.push(event);
        }
      );

      sessionId = result.sessionId;
      totalCost = result.totalCost;

      // Extract text content from assistant messages
      for (const event of events) {
        if (event.type === 'assistant' && event.message?.content) {
          const content = event.message.content;
          if (typeof content === 'string') {
            responseContent += content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                responseContent += block.text;
              }
            }
          }
        }
      }

      logger.info('Claude Web fallback completed', {
        component: 'Llm',
        sessionId,
        responseLength: responseContent.length,
        cost: totalCost,
      });
    } finally {
      // Archive the session to keep things clean
      if (sessionId) {
        try {
          await client.archiveSession(sessionId);
          logger.info('Archived fallback session', {
            component: 'Llm',
            sessionId,
          });
        } catch (archiveError) {
          logger.warn('Failed to archive fallback session', {
            component: 'Llm',
            sessionId,
            error: (archiveError as Error).message,
          });
        }
      }
    }

    return {
      content: responseContent.trim(),
      provider: 'claude-web',
      model: 'claude-opus-4-5-20251101',
      cost: totalCost,
    };
  }
}
