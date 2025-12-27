/**
 * LLM implementation with provider fallback chain
 *
 * Provider priority:
 * 1. OpenRouter (cheap, fast) - requires OPENROUTER_API_KEY
 * 2. Claude Web empty repo (expensive fallback) - requires Claude auth
 */

import { randomUUID } from 'crypto';
import { ALlm } from './ALlm.js';
import { OPENROUTER_API_KEY, CLAUDE_ENVIRONMENT_ID } from '../config/env.js';
import { getClaudeCredentials, ensureValidToken } from '../auth/claudeAuth.js';
import { logger } from '../utils/logging/logger.js';
import type { ClaudeAuth } from '../auth/claudeAuth.js';
import type { LlmExecuteParams, LlmExecuteResult } from './types.js';

const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';

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
    if (CLAUDE_ENVIRONMENT_ID) {
      try {
        const claudeAuth = await getClaudeCredentials({ checkDatabase: true });
        if (claudeAuth) {
          return await this.executeClaudeWeb(prompt, claudeAuth, {
            systemPrompt,
            maxTokens,
            temperature,
          });
        }
        logger.warn('Claude Web fallback skipped: no credentials available', {
          component: 'Llm',
        });
      } catch (error) {
        logger.warn('Claude Web fallback failed', {
          component: 'Llm',
          error: (error as Error).message,
        });
      }
    }

    throw new Error('No LLM provider available. Set OPENROUTER_API_KEY or CLAUDE_ENVIRONMENT_ID in your environment.');
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

  private buildClaudeHeaders(accessToken: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'ccr-byoc-2025-07-29',
      'Content-Type': 'application/json',
    };
  }

  private async executeClaudeWeb(
    prompt: string,
    claudeAuth: ClaudeAuth,
    options: {
      systemPrompt?: string;
      maxTokens: number;
      temperature: number;
    }
  ): Promise<LlmExecuteResult> {
    const { systemPrompt } = options;

    // Ensure token is valid (refresh if needed)
    const auth = await ensureValidToken(claudeAuth);
    const headers = this.buildClaudeHeaders(auth.accessToken);

    // Combine system prompt and user prompt if system prompt is provided
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\n${prompt}`
      : prompt;

    // Create session without git repo (empty repo pattern)
    const payload = {
      events: [{
        type: 'event',
        data: {
          uuid: randomUUID(),
          session_id: '',
          type: 'user',
          parent_tool_use_id: null,
          message: { role: 'user', content: fullPrompt },
        },
      }],
      environment_id: CLAUDE_ENVIRONMENT_ID,
      session_context: { model: 'claude-sonnet-4-20250514' },
    };

    logger.info('Creating Claude Web session for LLM fallback', {
      component: 'Llm',
      promptLength: fullPrompt.length,
    });

    const createRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      throw new Error(`Failed to create Claude Web session: ${createRes.status} ${errorText}`);
    }

    const session = await createRes.json() as { id: string };
    const sessionId = session.id;

    logger.info('Claude Web session created', {
      component: 'Llm',
      sessionId,
    });

    try {
      // Poll for completion (max 60 seconds, 2 second intervals = 30 polls)
      for (let i = 0; i < 30; i++) {
        const statusRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${sessionId}`, {
          headers,
        });
        const status = await statusRes.json() as { session_status: string };

        if (status.session_status === 'idle' || status.session_status === 'completed') {
          // Get events and extract response
          const eventsRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${sessionId}/events`, {
            headers,
          });
          const events = await eventsRes.json() as {
            data?: Array<{
              type: string;
              message?: { content?: Array<{ type: string; text?: string }> };
              total_cost_usd?: number;
            }>;
          };

          let content = '';
          let totalCost: number | undefined;

          for (const event of (events.data || [])) {
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  content += block.text;
                }
              }
            }
            if (event.type === 'result' && event.total_cost_usd !== undefined) {
              totalCost = event.total_cost_usd;
            }
          }

          logger.info('Claude Web session completed', {
            component: 'Llm',
            sessionId,
            contentLength: content.length,
            cost: totalCost,
          });

          return {
            content,
            provider: 'claude-web',
            model: 'claude-sonnet-4-20250514',
            cost: totalCost,
          };
        }

        if (status.session_status === 'failed') {
          throw new Error('Claude Web session failed');
        }

        // Wait 2 seconds before next poll
        await new Promise(r => setTimeout(r, 2000));
      }

      throw new Error('Claude Web session timed out after 60 seconds');
    } finally {
      // Always archive the session to clean up
      await this.archiveClaudeWebSession(sessionId, headers);
    }
  }

  private async archiveClaudeWebSession(
    sessionId: string,
    headers: Record<string, string>
  ): Promise<void> {
    try {
      await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${sessionId}/archive`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });

      logger.info('Claude Web session archived', {
        component: 'Llm',
        sessionId,
      });
    } catch (error) {
      // Log but don't throw - archiving is cleanup, shouldn't fail the main operation
      logger.warn('Failed to archive Claude Web session', {
        component: 'Llm',
        sessionId,
        error: (error as Error).message,
      });
    }
  }
}
