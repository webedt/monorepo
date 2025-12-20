/**
 * Claude Remote Provider
 *
 * Implementation of ExecutionProvider using Anthropic's Remote Sessions API.
 * This provider delegates all execution to Anthropic's infrastructure.
 */

import {
  ClaudeRemoteClient,
  type SessionEvent,
  type CreateSessionParams,
  type TitleGenerationEvent,
  generateTitle,
} from '@webedt/shared';
import { logger } from '@webedt/shared';
import type { ClaudeAuth } from '../../auth/claudeAuth.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL, CLAUDE_DEFAULT_MODEL, CLAUDE_ORG_UUID, CLAUDE_COOKIES, OPENROUTER_API_KEY } from '../../config/env.js';
import type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEventCallback,
  ExecutionEvent,
  ContentBlock,
} from './types.js';

/**
 * Extract text from prompt (handles both string and content blocks)
 */
function extractTextFromPrompt(prompt: string | ContentBlock[]): string {
  if (typeof prompt === 'string') {
    return prompt;
  }
  // Extract text from content blocks
  return prompt
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && 'text' in block)
    .map(block => block.text)
    .join('\n');
}

/**
 * Pass through raw Anthropic session events directly
 * Flatten the event structure - no wrapper, just add source and timestamp
 * This keeps remote events at the same level as our intermediary events
 */
function passRawEvent(event: SessionEvent, source: string): ExecutionEvent {
  // Spread the event and add our tracking fields
  // This flattens the structure so all events have the same shape
  return {
    ...event,
    timestamp: new Date().toISOString(),
    source,
  } as ExecutionEvent;
}

/**
 * Claude Remote Provider
 */
export class ClaudeRemoteProvider implements ExecutionProvider {
  readonly name = 'claude';

  /**
   * Create a ClaudeRemoteClient with the given auth
   */
  private createClient(claudeAuth: ClaudeAuth, environmentId?: string): ClaudeRemoteClient {
    return new ClaudeRemoteClient({
      accessToken: claudeAuth.accessToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
      model: CLAUDE_DEFAULT_MODEL,
    });
  }

  /**
   * Execute a new AI request
   */
  async execute(
    params: ExecuteParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, prompt, gitUrl, model, claudeAuth, environmentId, abortSignal } = params;
    const source = this.name;

    logger.info('Starting Claude Remote execution', {
      component: 'ClaudeRemoteProvider',
      chatSessionId,
      gitUrl,
      model: model || CLAUDE_DEFAULT_MODEL,
    });

    // No custom events - just create the client and let Anthropic events flow through
    const client = this.createClient(claudeAuth, environmentId);

    // Extract text from prompt for title generation (images can't be used for title)
    const textPrompt = extractTextFromPrompt(prompt);

    // Generate title with 4-method fallback:
    // 1. claude.ai dust endpoint (fastest, requires cookies)
    // 2. OpenRouter API (fast, requires OPENROUTER_API_KEY)
    // 3. Temp Sonnet session (reliable, uses OAuth)
    // 4. Local fallback (instant)
    const generatedTitle = await generateTitle(
      textPrompt,
      {
        claudeCookies: CLAUDE_COOKIES || undefined,
        orgUuid: CLAUDE_ORG_UUID || undefined,
        openRouterApiKey: OPENROUTER_API_KEY || undefined,
        accessToken: claudeAuth.accessToken,
        environmentId: environmentId || CLAUDE_ENVIRONMENT_ID || undefined,
      },
      // Emit title generation progress events
      async (event: TitleGenerationEvent) => {
        await onEvent({
          type: 'title_generation',
          timestamp: new Date().toISOString(),
          source,
          method: event.method,
          status: event.status,
          title: event.title,
          branch_name: event.branch_name,
        });
      }
    );

    logger.info('Generated session title and branch', {
      component: 'ClaudeRemoteProvider',
      title: generatedTitle.title,
      branch_name: generatedTitle.branch_name,
      source: generatedTitle.source,
    });

    // Create session params with generated title and branch
    const createParams: CreateSessionParams = {
      prompt,
      gitUrl,
      model: model || CLAUDE_DEFAULT_MODEL,
      title: generatedTitle.title,
      branchPrefix: generatedTitle.branch_name,
    };

    try {
      // Create session
      const { sessionId, webUrl, title } = await client.createSession(createParams);

      logger.info('Claude Remote session created', {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
        remoteSessionId: sessionId,
        webUrl,
      });

      // Poll for events - pass raw events directly
      const result = await client.pollSession(
        sessionId,
        async (event) => {
          const rawEvent = passRawEvent(event, source);
          await onEvent(rawEvent);
        },
        { abortSignal }
      );

      logger.info('Claude Remote execution completed', {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
        remoteSessionId: sessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
      });

      // No custom completed event - the Anthropic result event serves as completion indicator
      return {
        remoteSessionId: sessionId,
        remoteWebUrl: webUrl,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Claude Remote execution failed', error, {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
      });

      await onEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        source,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Resume an existing session with a new message
   */
  async resume(
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, remoteSessionId, prompt, claudeAuth, environmentId, abortSignal } = params;
    const source = this.name;

    logger.info('Resuming Claude Remote session', {
      component: 'ClaudeRemoteProvider',
      chatSessionId,
      remoteSessionId,
    });

    // No custom events for resume - let Anthropic events flow through

    const client = this.createClient(claudeAuth, environmentId);

    try {
      // Get current session info
      const session = await client.getSession(remoteSessionId);
      const webUrl = `https://claude.ai/code/${remoteSessionId}`;

      // Resume session - pass raw events directly
      const result = await client.resume(
        remoteSessionId,
        prompt,
        async (event) => {
          const rawEvent = passRawEvent(event, source);
          await onEvent(rawEvent);
        },
        { abortSignal }
      );

      logger.info('Claude Remote resume completed', {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
        remoteSessionId,
        status: result.status,
      });

      // No custom completed event - the Anthropic result event serves as completion indicator
      return {
        remoteSessionId,
        remoteWebUrl: webUrl,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Claude Remote resume failed', error, {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
        remoteSessionId,
      });

      await onEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        source,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Interrupt a running session
   */
  async interrupt(remoteSessionId: string, claudeAuth: ClaudeAuth): Promise<void> {
    logger.info('Interrupting Claude Remote session', {
      component: 'ClaudeRemoteProvider',
      remoteSessionId,
    });

    const client = this.createClient(claudeAuth);
    await client.interruptSession(remoteSessionId);

    logger.info('Claude Remote session interrupted', {
      component: 'ClaudeRemoteProvider',
      remoteSessionId,
    });
  }
}
