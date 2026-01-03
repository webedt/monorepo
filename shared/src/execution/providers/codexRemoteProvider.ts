/**
 * Codex Remote Provider
 *
 * Implementation of ExecutionProvider using OpenAI's Responses API.
 * This provider enables AI-assisted code generation using OpenAI models.
 */

import { CodexClient } from '../../codex/codexClient.js';
import { CODEX_API_BASE_URL, CODEX_DEFAULT_MODEL } from '../../config/env.js';
import { safeJsonParse } from '../../utils/api/safeJson.js';
import {
  AExecutionProvider,
  type ExecuteParams,
  type ResumeParams,
  type ExecutionResult,
  type ExecutionEventCallback,
  type ExecutionEvent,
  type ContentBlock,
  type ProviderCapabilities,
} from './types.js';

import type { CodexAuth } from '../../auth/codexAuth.js';
import type { CodexEvent } from '../../codex/types.js';
import type { ClaudeAuth } from '../../auth/claudeAuth.js';


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
      const toolInput: Record<string, unknown> = event.toolCall
        ? safeJsonParse<Record<string, unknown>>(
            event.toolCall.function.arguments || '{}',
            {} as Record<string, unknown>,
            { component: 'CodexRemoteProvider', logErrors: true, logLevel: 'debug' }
          )
        : {};
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
export class CodexRemoteProvider extends AExecutionProvider {
  readonly name = 'codex';

  readonly capabilities: ProviderCapabilities = {
    supportsResume: true,
    supportsImages: false,
    supportsInterrupt: true,
    generatesTitle: true,
    hasPersistentSessions: true,
  };

  private client: CodexClient;

  constructor() {
    super();
    this.client = new CodexClient();
  }

  /**
   * Generate a simple title from the prompt
   */
  private generateLocalTitle(prompt: string | ContentBlock[]): string {
    const text = this.extractTextFromPrompt(prompt);
    const title = text.slice(0, 50).replace(/\n/g, ' ').trim();
    return title.length < text.length ? title + '...' : title;
  }

  /**
   * Generate branch prefix from the prompt
   */
  private generateLocalBranchPrefix(prompt: string | ContentBlock[]): string {
    const text = this.extractTextFromPrompt(prompt);
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

    this.logExecution('info', 'Starting Codex execution', {
      chatSessionId,
      gitUrl,
      model: model || CODEX_DEFAULT_MODEL,
    });

    this.configureClient(codexAuth);

    const title = this.generateLocalTitle(prompt);
    const branchPrefix = this.generateLocalBranchPrefix(prompt);

    // Emit title generation event (local generation only for Codex)
    await onEvent({
      type: 'title_generation',
      timestamp: this.createTimestamp(),
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
          prompt: this.extractTextFromPrompt(prompt),
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

      this.logExecution('info', 'Codex execution completed', {
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
      this.logExecution('error', 'Codex execution failed', {
        error,
        chatSessionId,
      });

      await this.emitErrorEvent(onEvent, error);
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

    this.logExecution('info', 'Resuming Codex session', {
      chatSessionId,
      remoteSessionId,
    });

    this.configureClient(codexAuth);

    try {
      const result = await this.client.resume(
        remoteSessionId,
        this.extractTextFromPrompt(prompt),
        async (codexEvent: CodexEvent) => {
          const executionEvent = convertCodexEvent(codexEvent, source);
          await onEvent(executionEvent);
        },
        { abortSignal }
      );

      this.logExecution('info', 'Codex resume completed', {
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
      this.logExecution('error', 'Codex resume failed', {
        error,
        chatSessionId,
        remoteSessionId,
      });

      await this.emitErrorEvent(onEvent, error);
      throw error;
    }
  }

  /**
   * Interrupt a running session
   */
  async interrupt(remoteSessionId: string, claudeAuth: ClaudeAuth): Promise<void> {
    this.logExecution('info', 'Interrupting Codex session', {
      remoteSessionId,
    });

    // Configure with a basic auth to allow cancel
    this.configureClient({ accessToken: claudeAuth.accessToken });

    await this.client.cancelSession(remoteSessionId);

    this.logExecution('info', 'Codex session interrupted', {
      remoteSessionId,
    });
  }
}
