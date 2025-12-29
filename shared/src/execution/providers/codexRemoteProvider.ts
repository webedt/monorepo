/**
 * Codex Remote Provider
 *
 * Implementation of ExecutionProvider using OpenAI's Responses API.
 * This provider enables AI-assisted code generation using OpenAI models.
 */

import { CodexClient } from '../../codex/codexClient.js';
import { logger } from '../../utils/logging/logger.js';
import type { CodexAuth } from '../../auth/codexAuth.js';
import { CODEX_API_BASE_URL, CODEX_DEFAULT_MODEL } from '../../config/env.js';
import type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEventCallback,
  ExecutionEvent,
  ContentBlock,
} from './types.js';
import type { CodexEvent } from '../../codex/types.js';
import type { ClaudeAuth } from '../../auth/claudeAuth.js';

/**
 * Extract text from prompt (handles both string and content blocks)
 */
function extractTextFromPrompt(prompt: string | ContentBlock[]): string {
  if (typeof prompt === 'string') {
    return prompt;
  }
  return prompt
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && 'text' in block)
    .map(block => block.text)
    .join('\n');
}

/**
 * Generate a simple title from the prompt
 */
function generateTitle(prompt: string | ContentBlock[]): string {
  const text = extractTextFromPrompt(prompt);
  const title = text.slice(0, 50).replace(/\n/g, ' ').trim();
  return title.length < text.length ? title + '...' : title;
}

/**
 * Generate branch prefix from the prompt
 */
function generateBranchPrefix(prompt: string | ContentBlock[]): string {
  const text = extractTextFromPrompt(prompt);
  const words = text.slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  return `codex/${words || 'session'}`;
}

/**
 * Convert Codex events to ExecutionEvents
 */
function convertCodexEvent(event: CodexEvent, source: string): ExecutionEvent {
  const baseEvent: ExecutionEvent = {
    type: event.type,
    timestamp: event.timestamp,
    source,
    sessionId: event.sessionId,
  };

  switch (event.type) {
    case 'session_created':
      return {
        ...baseEvent,
        type: 'session_created',
        remoteSessionId: event.sessionId,
      };

    case 'message_delta':
    case 'message_complete':
      return {
        ...baseEvent,
        type: 'assistant_message',
        content: event.content,
        model: event.model,
      };

    case 'tool_use': {
      let toolInput: Record<string, unknown> = {};
      if (event.toolCall) {
        try {
          toolInput = JSON.parse(event.toolCall.function.arguments || '{}');
        } catch {
          // If arguments are not valid JSON, use empty object
          toolInput = {};
        }
      }
      return {
        ...baseEvent,
        type: 'tool_use',
        tool_use: event.toolCall ? {
          name: event.toolCall.function.name,
          input: toolInput,
        } : undefined,
      };
    }

    case 'result':
      return {
        ...baseEvent,
        type: 'result',
        totalCost: event.totalCostUsd,
        duration_ms: event.durationMs,
        branch: event.branch,
      };

    case 'error':
      return {
        ...baseEvent,
        type: 'error',
        error: event.error,
        code: event.errorCode,
      };

    default:
      return {
        ...baseEvent,
        ...event,
      };
  }
}

/**
 * Extended execute params that support Codex auth
 */
export interface CodexExecuteParams extends Omit<ExecuteParams, 'claudeAuth'> {
  /** Codex auth credentials (API key or OAuth token) */
  codexAuth: CodexAuth;
  /** Claude auth credentials (not used by Codex provider) */
  claudeAuth?: ClaudeAuth;
}

/**
 * Extended resume params that support Codex auth
 */
export interface CodexResumeParams extends Omit<ResumeParams, 'claudeAuth'> {
  /** Codex auth credentials (API key or OAuth token) */
  codexAuth: CodexAuth;
  /** Claude auth credentials (not used by Codex provider) */
  claudeAuth?: ClaudeAuth;
}

/**
 * Codex Remote Provider
 */
export class CodexRemoteProvider implements ExecutionProvider {
  readonly name = 'codex';

  private client: CodexClient;

  constructor() {
    this.client = new CodexClient();
  }

  /**
   * Configure the client with auth credentials
   */
  private configureClient(codexAuth: CodexAuth): void {
    this.client.configure({
      auth: codexAuth,
      baseUrl: CODEX_API_BASE_URL || 'https://api.openai.com/v1',
      model: CODEX_DEFAULT_MODEL || 'gpt-4o',
    });
  }

  /**
   * Execute a new AI request
   */
  async execute(
    params: ExecuteParams | CodexExecuteParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, prompt, gitUrl, model, abortSignal } = params;
    const source = this.name;

    // Get Codex auth - either from codexAuth param or convert from claudeAuth
    let codexAuth: CodexAuth;
    if ('codexAuth' in params && params.codexAuth) {
      codexAuth = params.codexAuth;
    } else if (params.claudeAuth) {
      codexAuth = { accessToken: params.claudeAuth.accessToken };
    } else {
      throw new Error('No authentication credentials provided');
    }

    logger.info('Starting Codex execution', {
      component: 'CodexRemoteProvider',
      chatSessionId,
      gitUrl,
      model: model || CODEX_DEFAULT_MODEL,
    });

    this.configureClient(codexAuth);

    const title = generateTitle(prompt);
    const branchPrefix = generateBranchPrefix(prompt);

    // Emit title generation event (local generation only for Codex)
    await onEvent({
      type: 'title_generation',
      timestamp: new Date().toISOString(),
      source,
      method: 'local',
      status: 'success',
      title,
      branch_name: branchPrefix,
    });

    try {
      // Execute via Codex client
      const result = await this.client.execute(
        {
          prompt: typeof prompt === 'string' ? prompt : extractTextFromPrompt(prompt),
          gitUrl,
          model: model || CODEX_DEFAULT_MODEL,
          title,
          branchPrefix,
        },
        async (codexEvent: CodexEvent) => {
          const executionEvent = convertCodexEvent(codexEvent, source);
          await onEvent(executionEvent);
        },
        { abortSignal }
      );

      logger.info('Codex execution completed', {
        component: 'CodexRemoteProvider',
        chatSessionId,
        sessionId: result.sessionId,
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
      });

      return {
        remoteSessionId: result.sessionId,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Codex execution failed', error, {
        component: 'CodexRemoteProvider',
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
    params: ResumeParams | CodexResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, remoteSessionId, prompt, abortSignal } = params;
    const source = this.name;

    // Get Codex auth
    let codexAuth: CodexAuth;
    if ('codexAuth' in params && params.codexAuth) {
      codexAuth = params.codexAuth;
    } else if (params.claudeAuth) {
      codexAuth = { accessToken: params.claudeAuth.accessToken };
    } else {
      throw new Error('No authentication credentials provided');
    }

    logger.info('Resuming Codex session', {
      component: 'CodexRemoteProvider',
      chatSessionId,
      remoteSessionId,
    });

    this.configureClient(codexAuth);

    try {
      const result = await this.client.resume(
        remoteSessionId,
        typeof prompt === 'string' ? prompt : extractTextFromPrompt(prompt),
        async (codexEvent: CodexEvent) => {
          const executionEvent = convertCodexEvent(codexEvent, source);
          await onEvent(executionEvent);
        },
        { abortSignal }
      );

      logger.info('Codex resume completed', {
        component: 'CodexRemoteProvider',
        chatSessionId,
        remoteSessionId,
        status: result.status,
      });

      return {
        remoteSessionId,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Codex resume failed', error, {
        component: 'CodexRemoteProvider',
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
    logger.info('Interrupting Codex session', {
      component: 'CodexRemoteProvider',
      remoteSessionId,
    });

    // Configure with a basic auth to allow cancel
    this.configureClient({ accessToken: claudeAuth.accessToken });

    await this.client.cancelSession(remoteSessionId);

    logger.info('Codex session interrupted', {
      component: 'CodexRemoteProvider',
      remoteSessionId,
    });
  }
}
