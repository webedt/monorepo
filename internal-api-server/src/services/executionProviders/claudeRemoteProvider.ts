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
} from '@webedt/shared';
import { logger } from '@webedt/shared';
import type { ClaudeAuth } from '../../lib/claudeAuth.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL, CLAUDE_DEFAULT_MODEL } from '../../config/env.js';
import type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEventCallback,
  ExecutionEvent,
} from './types.js';

/**
 * Map Anthropic session events to our ExecutionEvent format
 */
function mapSessionEvent(event: SessionEvent, source: string): ExecutionEvent {
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case 'user':
      return {
        type: 'message',
        timestamp,
        source,
        stage: 'user_message',
        message: 'User message received',
      };

    case 'assistant':
      return {
        type: 'assistant_message',
        timestamp,
        source,
        content: event.message?.content,
      };

    case 'result':
      return {
        type: 'completed',
        timestamp,
        source,
        totalCost: event.total_cost_usd,
        duration_ms: event.duration_ms,
      };

    case 'tool_use':
      return {
        type: 'message',
        timestamp,
        source,
        stage: 'tool_use',
        message: `Using tool: ${event.tool_use?.name || 'unknown'}`,
      };

    case 'tool_result':
      return {
        type: 'message',
        timestamp,
        source,
        stage: 'tool_result',
        message: event.tool_use_result?.is_error
          ? `Tool error: ${event.tool_use_result.stderr || 'Unknown error'}`
          : 'Tool completed',
      };

    case 'env_manager_log':
      return {
        type: 'message',
        timestamp,
        source,
        stage: event.data?.type || 'env_manager',
        message: event.data?.message || 'Environment manager event',
      };

    case 'error':
      return {
        type: 'error',
        timestamp,
        source,
        error: event.data?.message || 'Unknown error',
      };

    default:
      return {
        type: 'message',
        timestamp,
        source,
        stage: event.type,
        message: `Event: ${event.type}`,
      };
  }
}

/**
 * Claude Remote Provider
 */
export class ClaudeRemoteProvider implements ExecutionProvider {
  readonly name = 'claude-remote';

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

    // Emit connected event
    await onEvent({
      type: 'connected',
      timestamp: new Date().toISOString(),
      source,
      provider: this.name,
    });

    // Emit creating session event
    await onEvent({
      type: 'message',
      timestamp: new Date().toISOString(),
      source,
      stage: 'creating_session',
      message: 'Creating Claude remote session...',
    });

    const client = this.createClient(claudeAuth, environmentId);

    // Create session params
    const createParams: CreateSessionParams = {
      prompt,
      gitUrl,
      model: model || CLAUDE_DEFAULT_MODEL,
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

      // Emit session created event
      await onEvent({
        type: 'session_created',
        timestamp: new Date().toISOString(),
        source,
        remoteSessionId: sessionId,
        remoteWebUrl: webUrl,
        sessionId: chatSessionId,
      });

      // Emit session name
      await onEvent({
        type: 'session_name',
        timestamp: new Date().toISOString(),
        source,
        sessionName: title,
      });

      // Poll for events
      const result = await client.pollSession(
        sessionId,
        async (event) => {
          const mappedEvent = mapSessionEvent(event, source);
          await onEvent(mappedEvent);
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

      // Emit final completed event with all details
      await onEvent({
        type: 'completed',
        timestamp: new Date().toISOString(),
        source,
        sessionId: chatSessionId,
        branch: result.branch,
        totalCost: result.totalCost,
        duration_ms: result.durationMs,
      });

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

    // Emit connected event
    await onEvent({
      type: 'connected',
      timestamp: new Date().toISOString(),
      source,
      provider: this.name,
      sessionId: chatSessionId,
    });

    // Emit resuming event
    await onEvent({
      type: 'message',
      timestamp: new Date().toISOString(),
      source,
      stage: 'resuming',
      message: 'Resuming session...',
    });

    const client = this.createClient(claudeAuth, environmentId);

    try {
      // Get current session info
      const session = await client.getSession(remoteSessionId);
      const webUrl = `https://claude.ai/code/${remoteSessionId}`;

      // Resume session
      const result = await client.resume(
        remoteSessionId,
        prompt,
        async (event) => {
          const mappedEvent = mapSessionEvent(event, source);
          await onEvent(mappedEvent);
        },
        { abortSignal }
      );

      logger.info('Claude Remote resume completed', {
        component: 'ClaudeRemoteProvider',
        chatSessionId,
        remoteSessionId,
        status: result.status,
      });

      // Emit final completed event
      await onEvent({
        type: 'completed',
        timestamp: new Date().toISOString(),
        source,
        sessionId: chatSessionId,
        branch: result.branch,
        totalCost: result.totalCost,
        duration_ms: result.durationMs,
      });

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
