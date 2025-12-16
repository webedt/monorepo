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
 * Extract text content from message (handles both string and content blocks)
 */
function extractTextContent(message: any): string | undefined {
  if (!message?.content) return undefined;

  // If content is a string, return it
  if (typeof message.content === 'string') {
    return message.content;
  }

  // If content is an array of content blocks, extract text
  if (Array.isArray(message.content)) {
    const textParts = message.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .filter(Boolean);
    return textParts.length > 0 ? textParts.join('\n') : undefined;
  }

  return undefined;
}

/**
 * Pass through raw Anthropic session events with minimal wrapping
 * This allows the frontend to receive events exactly as they come from the API
 */
function passRawEvent(event: SessionEvent, source: string): ExecutionEvent {
  // Pass raw event directly - no mapping, no transformation
  // Just add source and timestamp for tracking
  return {
    type: 'raw_event' as any, // Use raw_event type to indicate pass-through
    timestamp: new Date().toISOString(),
    source,
    rawEvent: event, // The actual raw event from Anthropic API
  };
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
