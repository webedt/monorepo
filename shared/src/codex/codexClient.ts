import { randomUUID } from 'crypto';
import { ACodexClient } from './ACodexClient.js';
import type { CodexAuth } from '../auth/codexAuth.js';
import type { CodexClientConfig } from './types.js';
import type { CreateCodexSessionParams } from './types.js';
import type { CreateCodexSessionResult } from './types.js';
import type { CodexSession } from './types.js';
import type { CodexSessionResult } from './types.js';
import type { CodexEvent } from './types.js';
import type { CodexEventCallback } from './types.js';
import type { CodexPollOptions } from './types.js';
import type { CodexContentBlock } from './types.js';
import type { CodexMessage } from './types.js';
import type { OpenAIResponse } from './types.js';
import type { OpenAIStreamEvent } from './types.js';
import { CodexError } from './types.js';
import { logger } from '../utils/logging/logger.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o';

/**
 * In-memory session store for Codex sessions
 * In production, this should be replaced with database storage
 */
const sessionStore = new Map<string, CodexSession>();

export class CodexClient extends ACodexClient {
  private auth: CodexAuth;
  private baseUrl: string;
  private model: string;
  private organizationId?: string;
  private projectId?: string;

  constructor(config?: CodexClientConfig) {
    super();
    this.auth = config?.auth || {};
    this.baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    this.model = config?.model || DEFAULT_MODEL;
    this.organizationId = config?.organizationId;
    this.projectId = config?.projectId;
  }

  configure(config: CodexClientConfig): void {
    this.auth = config.auth;
    if (config.baseUrl !== undefined) {
      this.baseUrl = config.baseUrl;
    }
    if (config.model !== undefined) {
      this.model = config.model;
    }
    if (config.organizationId !== undefined) {
      this.organizationId = config.organizationId;
    }
    if (config.projectId !== undefined) {
      this.projectId = config.projectId;
    }
  }

  setAuth(auth: CodexAuth): void {
    this.auth = auth;
  }

  private getAuthToken(): string {
    if (this.auth.apiKey) {
      return this.auth.apiKey;
    }
    if (this.auth.accessToken) {
      return this.auth.accessToken;
    }
    throw new CodexError('No valid authentication credentials provided');
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.getAuthToken()}`,
      'Content-Type': 'application/json',
    };
    if (this.organizationId) {
      headers['OpenAI-Organization'] = this.organizationId;
    }
    if (this.projectId) {
      headers['OpenAI-Project'] = this.projectId;
    }
    return headers;
  }

  private extractTextFromPrompt(prompt: string | CodexContentBlock[]): string {
    if (typeof prompt === 'string') {
      return prompt;
    }
    return prompt
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && 'text' in block)
      .map(block => block.text)
      .join('\n');
  }

  private generateTitle(prompt: string | CodexContentBlock[]): string {
    const text = this.extractTextFromPrompt(prompt);
    const title = text.slice(0, 50).replace(/\n/g, ' ').trim();
    return title.length < text.length ? title + '...' : title;
  }

  private generateBranchPrefix(prompt: string | CodexContentBlock[]): string {
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

  private buildSystemInstructions(params: CreateCodexSessionParams): string {
    const parts: string[] = [];

    if (params.systemInstructions) {
      parts.push(params.systemInstructions);
    }

    // Add context about the repository
    parts.push(`You are working on a code repository: ${params.gitUrl}`);

    if (params.branchPrefix) {
      parts.push(`Create changes on a branch with prefix: ${params.branchPrefix}`);
    }

    return parts.join('\n\n');
  }

  private formatMessagesForOpenAI(messages: CodexMessage[]): Array<{ role: string; content: string }> {
    return messages.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : this.extractTextFromPrompt(msg.content as CodexContentBlock[])
    }));
  }

  async createSession(params: CreateCodexSessionParams): Promise<CreateCodexSessionResult> {
    const sessionId = `codex_${randomUUID()}`;
    const title = params.title || this.generateTitle(params.prompt);
    const branchPrefix = params.branchPrefix || this.generateBranchPrefix(params.prompt);

    logger.info('Creating Codex session', {
      component: 'CodexClient',
      sessionId,
      title,
      model: params.model || this.model,
      gitUrl: params.gitUrl,
    });

    // Store session metadata
    const session: CodexSession = {
      id: sessionId,
      title,
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: params.model || this.model,
      gitUrl: params.gitUrl,
      branch: branchPrefix,
      messages: [{
        role: 'user',
        content: params.prompt
      }],
    };

    sessionStore.set(sessionId, session);

    return {
      sessionId,
      title,
    };
  }

  async getSession(sessionId: string): Promise<CodexSession> {
    const session = sessionStore.get(sessionId);
    if (!session) {
      throw new CodexError(`Session not found: ${sessionId}`, 404);
    }
    return session;
  }

  async sendMessage(sessionId: string, message: string | CodexContentBlock[]): Promise<void> {
    const session = await this.getSession(sessionId);

    session.messages.push({
      role: 'user',
      content: message
    });
    session.updatedAt = new Date().toISOString();

    sessionStore.set(sessionId, session);
  }

  async execute(
    params: CreateCodexSessionParams,
    onEvent: CodexEventCallback,
    options?: CodexPollOptions
  ): Promise<CodexSessionResult> {
    const startTime = Date.now();
    const { sessionId, title } = await this.createSession(params);
    const session = await this.getSession(sessionId);

    // Emit session created event
    await onEvent({
      uuid: randomUUID(),
      type: 'session_created',
      timestamp: new Date().toISOString(),
      sessionId,
    });

    try {
      // Update session status
      session.status = 'running';
      sessionStore.set(sessionId, session);

      // Execute with OpenAI Responses API
      const result = await this.executeWithOpenAI(
        session,
        params,
        onEvent,
        options
      );

      const durationMs = Date.now() - startTime;

      // Update session with result
      session.status = 'completed';
      session.totalCost = result.totalCost;
      session.updatedAt = new Date().toISOString();
      sessionStore.set(sessionId, session);

      // Emit result event
      await onEvent({
        uuid: randomUUID(),
        type: 'result',
        timestamp: new Date().toISOString(),
        sessionId,
        resultStatus: 'completed',
        totalCostUsd: result.totalCost,
        durationMs,
        branch: session.branch,
      });

      return {
        sessionId,
        status: 'completed',
        title,
        branch: session.branch,
        totalCost: result.totalCost,
        durationMs,
        numTurns: result.numTurns,
        result: result.output,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      sessionStore.set(sessionId, session);

      await onEvent({
        uuid: randomUUID(),
        type: 'error',
        timestamp: new Date().toISOString(),
        sessionId,
        error: errorMessage,
      });

      logger.error('Codex execution failed', error, {
        component: 'CodexClient',
        sessionId,
      });

      throw error;
    }
  }

  private async executeWithOpenAI(
    session: CodexSession,
    params: CreateCodexSessionParams,
    onEvent: CodexEventCallback,
    options?: CodexPollOptions
  ): Promise<{ output: string; totalCost?: number; numTurns: number }> {
    const systemInstructions = this.buildSystemInstructions(params);
    const model = params.model || this.model;

    // Build the request body for OpenAI Responses API
    const requestBody = {
      model,
      input: this.extractTextFromPrompt(params.prompt),
      instructions: systemInstructions,
      stream: true,
    };

    logger.debug('Sending request to OpenAI Responses API', {
      component: 'CodexClient',
      sessionId: session.id,
      model,
    });

    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(requestBody),
      signal: options?.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new CodexError(
        `OpenAI API error: ${response.status} ${text}`,
        response.status,
        text
      );
    }

    // Handle streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new CodexError('No response body available');
    }

    const decoder = new TextDecoder();
    let fullOutput = '';
    let numTurns = 0;
    let totalTokens = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6); // Remove 'data: ' prefix
          if (data === '[DONE]') continue;

          try {
            const event = JSON.parse(data) as OpenAIStreamEvent;
            await this.handleStreamEvent(event, session.id, onEvent);

            // Collect output text
            if (event.delta) {
              fullOutput += event.delta;
            }

            // Track completion
            if (event.response?.status === 'completed') {
              numTurns++;
              if (event.response.usage) {
                totalTokens += event.response.usage.total_tokens;
              }
            }
          } catch {
            // Ignore parse errors for malformed chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Estimate cost based on tokens (approximate GPT-4o pricing)
    const costPerInputToken = 0.0000025;  // $2.50 per 1M tokens
    const costPerOutputToken = 0.00001;   // $10 per 1M tokens
    const estimatedCost = totalTokens * ((costPerInputToken + costPerOutputToken) / 2);

    // Store assistant response
    session.messages.push({
      role: 'assistant',
      content: fullOutput
    });
    sessionStore.set(session.id, session);

    return {
      output: fullOutput,
      totalCost: estimatedCost,
      numTurns,
    };
  }

  private async handleStreamEvent(
    event: OpenAIStreamEvent,
    sessionId: string,
    onEvent: CodexEventCallback
  ): Promise<void> {
    const baseEvent: CodexEvent = {
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId,
      type: 'message_delta',
    };

    // Handle different event types from OpenAI
    switch (event.type) {
      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          await onEvent({
            ...baseEvent,
            type: 'tool_use',
            toolCall: {
              id: event.item.id || randomUUID(),
              type: 'function',
              function: {
                name: event.item.name || 'unknown',
                arguments: event.item.arguments || '{}',
              },
            },
          });
        }
        break;

      case 'response.output_text.delta':
        if (event.delta) {
          await onEvent({
            ...baseEvent,
            type: 'message_delta',
            content: event.delta,
            role: 'assistant',
          });
        }
        break;

      case 'response.output_text.done':
        await onEvent({
          ...baseEvent,
          type: 'message_complete',
          role: 'assistant',
        });
        break;

      case 'response.completed':
        // Final completion event handled by caller
        break;

      case 'error':
        await onEvent({
          ...baseEvent,
          type: 'error',
          error: event.error?.message || 'Unknown error',
          errorCode: event.error?.code,
        });
        break;

      default:
        // Log unknown event types for debugging
        logger.debug('Unknown OpenAI stream event type', {
          component: 'CodexClient',
          eventType: event.type,
          sessionId,
        });
    }
  }

  async resume(
    sessionId: string,
    message: string | CodexContentBlock[],
    onEvent: CodexEventCallback,
    options?: CodexPollOptions
  ): Promise<CodexSessionResult> {
    const startTime = Date.now();
    const session = await this.getSession(sessionId);

    if (session.status !== 'idle' && session.status !== 'completed') {
      throw new CodexError(`Cannot resume session in ${session.status} state`, 400);
    }

    // Add the new message
    await this.sendMessage(sessionId, message);

    try {
      session.status = 'running';
      sessionStore.set(sessionId, session);

      // Build context from conversation history
      const conversationContext = session.messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : this.extractTextFromPrompt(msg.content as CodexContentBlock[])
      }));

      // Create a prompt that includes conversation context
      const contextPrompt = conversationContext.map(m => `${m.role}: ${m.content}`).join('\n\n');
      const resumeParams: CreateCodexSessionParams = {
        prompt: contextPrompt,
        gitUrl: session.gitUrl || '',
        model: session.model,
        branchPrefix: session.branch,
        title: session.title,
      };

      const result = await this.executeWithOpenAI(
        session,
        resumeParams,
        onEvent,
        options
      );

      const durationMs = Date.now() - startTime;

      session.status = 'completed';
      session.totalCost = (session.totalCost || 0) + (result.totalCost || 0);
      session.updatedAt = new Date().toISOString();
      sessionStore.set(sessionId, session);

      await onEvent({
        uuid: randomUUID(),
        type: 'result',
        timestamp: new Date().toISOString(),
        sessionId,
        resultStatus: 'completed',
        totalCostUsd: result.totalCost,
        durationMs,
        branch: session.branch,
      });

      return {
        sessionId,
        status: 'completed',
        title: session.title,
        branch: session.branch,
        totalCost: session.totalCost,
        durationMs,
        numTurns: result.numTurns,
        result: result.output,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      sessionStore.set(sessionId, session);

      await onEvent({
        uuid: randomUUID(),
        type: 'error',
        timestamp: new Date().toISOString(),
        sessionId,
        error: errorMessage,
      });

      throw error;
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);

    if (session.status === 'running') {
      session.status = 'cancelled';
      session.updatedAt = new Date().toISOString();
      sessionStore.set(sessionId, session);

      logger.info('Codex session cancelled', {
        component: 'CodexClient',
        sessionId,
      });
    }
  }

  async isComplete(sessionId: string): Promise<{ isComplete: boolean; status?: string }> {
    const session = await this.getSession(sessionId);
    const isComplete = session.status === 'completed' ||
                       session.status === 'failed' ||
                       session.status === 'cancelled';

    return {
      isComplete,
      status: session.status,
    };
  }
}
