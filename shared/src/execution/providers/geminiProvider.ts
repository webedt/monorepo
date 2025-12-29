/**
 * Gemini Provider
 *
 * Implementation of ExecutionProvider using Google's Gemini API.
 * This provider handles AI execution via Gemini's generative AI capabilities.
 *
 * Note: Unlike Claude Remote Sessions, Gemini doesn't have a persistent session API.
 * Sessions are managed locally, with conversation history stored in the database.
 */

import { v4 as uuidv4 } from 'uuid';
import { GeminiClient } from '../../gemini/index.js';
import { GEMINI_API_BASE_URL, GEMINI_DEFAULT_MODEL } from '../../config/env.js';

import type { GeminiAuth } from '../../auth/lucia.js';
import type { GeminiSessionEvent } from '../../gemini/types.js';
import type { Content } from '../../gemini/types.js';
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
 * Extended ResumeParams with conversation history for Gemini
 */
export interface GeminiResumeParams extends ResumeParams {
  /** Conversation history for context (Gemini doesn't have persistent sessions) */
  history?: Content[];
}

/**
 * Convert Gemini event to ExecutionEvent
 */
function toExecutionEvent(event: GeminiSessionEvent, source: string): ExecutionEvent {
  const baseEvent: ExecutionEvent = {
    type: event.type,
    timestamp: event.timestamp || new Date().toISOString(),
    source,
    uuid: event.uuid,
  };

  if (event.message) {
    baseEvent.message = typeof event.message.content === 'string'
      ? event.message.content
      : JSON.stringify(event.message.content);
    baseEvent.model = event.message.model;
    baseEvent.content = event.message.content;
  }

  if (event.error) {
    baseEvent.error = event.error;
  }

  if (event.totalTokens !== undefined) {
    baseEvent.totalTokens = event.totalTokens;
  }

  if (event.data) {
    Object.assign(baseEvent, event.data);
  }

  return baseEvent;
}

/**
 * System instruction for Gemini to act as a coding assistant
 */
const CODING_SYSTEM_INSTRUCTION = `You are an expert AI coding assistant. You help users with software engineering tasks including:
- Writing and debugging code
- Explaining code and concepts
- Refactoring and improving code quality
- Answering technical questions

When providing code, use appropriate syntax highlighting with code blocks.
Be concise but thorough. Focus on providing actionable solutions.`;

/**
 * Gemini Provider
 */
export class GeminiProvider extends AExecutionProvider {
  readonly name = 'gemini';

  readonly capabilities: ProviderCapabilities = {
    supportsResume: true,
    supportsImages: true,
    supportsInterrupt: false,
    generatesTitle: false,
    hasPersistentSessions: false,
  };

  /**
   * Get and configure a GeminiClient with the given auth
   */
  private getClient(geminiAuth: GeminiAuth): GeminiClient {
    const client = new GeminiClient();
    client.configure({
      accessToken: geminiAuth.accessToken,
      baseUrl: GEMINI_API_BASE_URL,
      model: GEMINI_DEFAULT_MODEL,
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
    const { chatSessionId, prompt, model, geminiAuth, abortSignal } = params;
    const source = this.name;

    if (!geminiAuth) {
      throw new Error('Gemini authentication required for GeminiProvider');
    }

    this.logExecution('info', 'Starting Gemini execution', {
      chatSessionId,
      model: model || GEMINI_DEFAULT_MODEL,
    });

    const client = this.getClient(geminiAuth);
    const textPrompt = this.extractTextFromPrompt(prompt);

    // Generate a session ID for tracking
    const sessionId = `gemini_${uuidv4()}`;
    const startTime = Date.now();

    // Emit session created event
    await this.emitSessionCreatedEvent(onEvent, sessionId);

    try {
      // Generate content with streaming
      const result = await client.generateContentStream(
        {
          prompt: textPrompt,
          model: model || GEMINI_DEFAULT_MODEL,
          systemInstruction: CODING_SYSTEM_INSTRUCTION,
        },
        async (event: GeminiSessionEvent) => {
          const executionEvent = toExecutionEvent(event, source);
          await onEvent(executionEvent);
        },
        { abortSignal }
      );

      this.logExecution('info', 'Gemini execution completed', {
        chatSessionId,
        sessionId,
        status: result.status,
        totalTokens: result.totalTokens,
        durationMs: result.durationMs,
      });

      return {
        remoteSessionId: sessionId,
        totalCost: undefined, // Gemini pricing not tracked here
        durationMs: result.durationMs || (Date.now() - startTime),
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      this.logExecution('error', 'Gemini execution failed', {
        error,
        chatSessionId,
      });

      await this.emitErrorEvent(onEvent, error);
      throw error;
    }
  }

  /**
   * Resume an existing session with a new message
   *
   * Note: Gemini doesn't have persistent sessions, so we need conversation history
   * passed in to maintain context.
   */
  async resume(
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, remoteSessionId, prompt, geminiAuth, abortSignal } = params;
    // Cast to access history if provided
    const history = (params as GeminiResumeParams).history || [];
    const source = this.name;

    if (!geminiAuth) {
      throw new Error('Gemini authentication required for GeminiProvider');
    }

    this.logExecution('info', 'Resuming Gemini session', {
      chatSessionId,
      remoteSessionId,
      historyLength: history.length,
    });

    const client = this.getClient(geminiAuth);
    const textPrompt = this.extractTextFromPrompt(prompt);
    const startTime = Date.now();

    try {
      // Generate content with history for context
      const result = await client.generateContentStream(
        {
          prompt: textPrompt,
          history,
          systemInstruction: CODING_SYSTEM_INSTRUCTION,
        },
        async (event: GeminiSessionEvent) => {
          const executionEvent = toExecutionEvent(event, source);
          await onEvent(executionEvent);
        },
        { abortSignal }
      );

      this.logExecution('info', 'Gemini resume completed', {
        chatSessionId,
        remoteSessionId,
        status: result.status,
      });

      return {
        remoteSessionId,
        durationMs: result.durationMs || (Date.now() - startTime),
        status: result.status === 'completed' ? 'completed' : 'failed',
      };

    } catch (error) {
      this.logExecution('error', 'Gemini resume failed', {
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
   *
   * Note: For Gemini, interruption is handled via the AbortSignal passed to the request.
   * This method is a no-op since Gemini doesn't have remote sessions to interrupt.
   */
  async interrupt(remoteSessionId: string): Promise<void> {
    this.logExecution('info', 'Gemini interrupt requested (no-op - use AbortSignal instead)', {
      remoteSessionId,
    });
    // Gemini interruption is handled via AbortSignal in the execute/resume methods
    // There's no remote session to interrupt
  }
}
