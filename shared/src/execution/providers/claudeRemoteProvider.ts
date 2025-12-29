/**
 * Claude Remote Provider
 *
 * Implementation of ExecutionProvider using Anthropic's Remote Sessions API.
 * This provider delegates all execution to Anthropic's infrastructure.
 */

import {
  type SessionEvent,
  type CreateSessionParams,
  type TitleGenerationEvent,
  generateTitle,
} from '../../claudeWeb/index.js';
import { ServiceProvider, AClaudeWebClient } from '../../services/registry.js';
import type { ClaudeAuth } from '../../auth/claudeAuth.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL, CLAUDE_DEFAULT_MODEL, CLAUDE_ORG_UUID, CLAUDE_COOKIES, OPENROUTER_API_KEY } from '../../config/env.js';
import {
  AExecutionProvider,
  type ExecuteParams,
  type ResumeParams,
  type ExecutionResult,
  type ExecutionEventCallback,
  type ExecutionEvent,
  type ProviderCapabilities,
} from './types.js';

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
export class ClaudeRemoteProvider extends AExecutionProvider {
  readonly name = 'claude';

  readonly capabilities: ProviderCapabilities = {
    supportsResume: true,
    supportsImages: true,
    supportsInterrupt: true,
    generatesTitle: true,
    hasPersistentSessions: true,
  };

  /**
   * Get and configure a ClaudeWebClient with the given auth
   */
  private getClient(claudeAuth: ClaudeAuth, environmentId?: string): AClaudeWebClient {
    const client = ServiceProvider.get(AClaudeWebClient);
    client.configure({
      accessToken: claudeAuth.accessToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
      model: CLAUDE_DEFAULT_MODEL,
    });
    return client;
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

    if (!claudeAuth) {
      throw new Error('Claude authentication required for ClaudeRemoteProvider');
    }

    this.logExecution('info', 'Starting Claude Remote execution', {
      chatSessionId,
      gitUrl,
      model: model || CLAUDE_DEFAULT_MODEL,
    });

    // No custom events - just get the client and let Anthropic events flow through
    const client = this.getClient(claudeAuth, environmentId);

    // Extract text from prompt for title generation (images can't be used for title)
    const textPrompt = this.extractTextFromPrompt(prompt);

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
          timestamp: this.createTimestamp(),
          source,
          method: event.method,
          status: event.status,
          title: event.title,
          branch_name: event.branch_name,
        });
      }
    );

    this.logExecution('info', 'Generated session title and branch', {
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

      this.logExecution('info', 'Claude Remote session created', {
        chatSessionId,
        remoteSessionId: sessionId,
        webUrl,
      });

      // Emit session_created event so executeRemote.ts can save remoteSessionId immediately
      // This is critical for archive functionality - the remoteSessionId must be persisted
      await this.emitSessionCreatedEvent(onEvent, sessionId, webUrl);

      // Poll for events - pass raw events directly
      const result = await client.pollSession(
        sessionId,
        async (event) => {
          const rawEvent = passRawEvent(event, source);
          await onEvent(rawEvent);
        },
        { abortSignal }
      );

      this.logExecution('info', 'Claude Remote execution completed', {
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
      this.logExecution('error', 'Claude Remote execution failed', {
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
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, remoteSessionId, prompt, claudeAuth, environmentId, abortSignal } = params;
    const source = this.name;

    if (!claudeAuth) {
      throw new Error('Claude authentication required for ClaudeRemoteProvider');
    }

    this.logExecution('info', 'Resuming Claude Remote session', {
      chatSessionId,
      remoteSessionId,
    });

    // No custom events for resume - let Anthropic events flow through

    const client = this.getClient(claudeAuth, environmentId);

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

      this.logExecution('info', 'Claude Remote resume completed', {
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
      this.logExecution('error', 'Claude Remote resume failed', {
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
  async interrupt(remoteSessionId: string, auth?: ClaudeAuth): Promise<void> {
    if (!auth) {
      throw new Error('Claude authentication required for ClaudeRemoteProvider interrupt');
    }

    this.logExecution('info', 'Interrupting Claude Remote session', {
      remoteSessionId,
    });

    const client = this.getClient(auth);
    await client.interruptSession(remoteSessionId);

    this.logExecution('info', 'Claude Remote session interrupted', {
      remoteSessionId,
    });
  }
}
