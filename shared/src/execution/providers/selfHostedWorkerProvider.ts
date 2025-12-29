/**
 * Self-Hosted Worker Provider
 *
 * Implementation of ExecutionProvider that connects to a self-hosted AI worker
 * for LLM execution. This provider dispatches work to an external worker service
 * and streams events back via SSE.
 *
 * The worker is expected to:
 * 1. Accept execution requests via HTTP POST
 * 2. Stream events back via SSE
 * 3. Use the Claude Agent SDK for actual LLM execution
 *
 * SECURITY NOTE: This provider transmits Claude authentication credentials
 * (accessToken, refreshToken) to the external worker service. Ensure the
 * worker URL uses HTTPS in production and that AI_WORKER_SECRET is configured
 * to authenticate requests to the worker.
 */

import { logger } from '../../utils/logging/logger.js';
import type { ClaudeAuth } from '../../auth/claudeAuth.js';
import { AI_WORKER_URL, AI_WORKER_SECRET } from '../../config/env.js';
import type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEventCallback,
  ExecutionEvent,
  ExecutionEventType,
  ContentBlock,
} from './types.js';

/**
 * Configuration for the self-hosted worker
 */
export interface SelfHostedWorkerConfig {
  /** Base URL of the AI worker service */
  workerUrl: string;
  /** Secret for authenticating with the worker */
  workerSecret?: string;
  /** Timeout in milliseconds for worker connections (default: 30 minutes) */
  timeoutMs?: number;
}

/**
 * Request payload for worker execution
 */
interface WorkerExecuteRequest {
  type: 'execute' | 'resume';
  chatSessionId: string;
  userId: string;
  prompt: string | ContentBlock[];
  gitUrl?: string;
  remoteSessionId?: string;
  model?: string;
  claudeAuth: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  };
  environmentId?: string;
}

/**
 * Self-Hosted Worker Provider
 *
 * Connects to an external AI worker service for LLM execution.
 * The worker handles actual Claude Agent SDK calls and streams
 * events back to this provider.
 */
export class SelfHostedWorkerProvider implements ExecutionProvider {
  readonly name = 'self-hosted';
  private config: SelfHostedWorkerConfig;

  constructor(config?: Partial<SelfHostedWorkerConfig>) {
    this.config = {
      workerUrl: config?.workerUrl || AI_WORKER_URL || '',
      workerSecret: config?.workerSecret || AI_WORKER_SECRET,
      timeoutMs: config?.timeoutMs || 30 * 60 * 1000, // 30 minutes default
    };

    if (!this.config.workerUrl) {
      logger.warn('SelfHostedWorkerProvider initialized without worker URL', {
        component: 'SelfHostedWorkerProvider',
      });
    }
  }

  /**
   * Check if the worker is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config.workerUrl) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.workerUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
        headers: this.getHeaders(),
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      logger.debug('Worker health check failed', {
        component: 'SelfHostedWorkerProvider',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Get headers for worker requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.workerSecret) {
      headers['Authorization'] = `Bearer ${this.config.workerSecret}`;
    }

    return headers;
  }

  /**
   * Execute a new AI request via the self-hosted worker
   */
  async execute(
    params: ExecuteParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, prompt, gitUrl, model, claudeAuth, environmentId, abortSignal } = params;

    if (!this.config.workerUrl) {
      throw new Error('AI Worker URL not configured. Set AI_WORKER_URL environment variable.');
    }

    if (!claudeAuth) {
      throw new Error('Claude authentication required for SelfHostedWorkerProvider');
    }

    logger.info('Starting self-hosted worker execution', {
      component: 'SelfHostedWorkerProvider',
      chatSessionId,
      gitUrl,
      workerUrl: this.config.workerUrl,
    });

    const request: WorkerExecuteRequest = {
      type: 'execute',
      chatSessionId,
      userId: params.userId,
      prompt,
      gitUrl,
      model,
      claudeAuth: {
        accessToken: claudeAuth.accessToken,
        refreshToken: claudeAuth.refreshToken,
        expiresAt: claudeAuth.expiresAt,
      },
      environmentId,
    };

    return this.streamFromWorker(request, onEvent, abortSignal);
  }

  /**
   * Resume an existing session via the self-hosted worker
   */
  async resume(
    params: ResumeParams,
    onEvent: ExecutionEventCallback
  ): Promise<ExecutionResult> {
    const { chatSessionId, remoteSessionId, prompt, claudeAuth, environmentId, abortSignal } = params;

    if (!this.config.workerUrl) {
      throw new Error('AI Worker URL not configured. Set AI_WORKER_URL environment variable.');
    }

    if (!claudeAuth) {
      throw new Error('Claude authentication required for SelfHostedWorkerProvider');
    }

    logger.info('Resuming session via self-hosted worker', {
      component: 'SelfHostedWorkerProvider',
      chatSessionId,
      remoteSessionId,
      workerUrl: this.config.workerUrl,
    });

    const request: WorkerExecuteRequest = {
      type: 'resume',
      chatSessionId,
      userId: params.userId,
      prompt,
      remoteSessionId,
      claudeAuth: {
        accessToken: claudeAuth.accessToken,
        refreshToken: claudeAuth.refreshToken,
        expiresAt: claudeAuth.expiresAt,
      },
      environmentId,
    };

    return this.streamFromWorker(request, onEvent, abortSignal);
  }

  /**
   * Interrupt a running session
   */
  async interrupt(remoteSessionId: string, auth?: ClaudeAuth): Promise<void> {
    if (!this.config.workerUrl) {
      throw new Error('AI Worker URL not configured');
    }

    if (!auth) {
      throw new Error('Claude authentication required for SelfHostedWorkerProvider interrupt');
    }

    logger.info('Interrupting session via self-hosted worker', {
      component: 'SelfHostedWorkerProvider',
      remoteSessionId,
    });

    const response = await fetch(`${this.config.workerUrl}/interrupt`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        remoteSessionId,
        claudeAuth: {
          accessToken: auth.accessToken,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to interrupt session: ${error}`);
    }

    logger.info('Session interrupted via self-hosted worker', {
      component: 'SelfHostedWorkerProvider',
      remoteSessionId,
    });
  }

  /**
   * Stream events from the worker via SSE
   */
  private async streamFromWorker(
    request: WorkerExecuteRequest,
    onEvent: ExecutionEventCallback,
    abortSignal?: AbortSignal
  ): Promise<ExecutionResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // Combine with external abort signal (use { once: true } to prevent memory leak)
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      // Emit connected event
      await onEvent({
        type: 'connected',
        timestamp: new Date().toISOString(),
        source: this.name,
        provider: 'self-hosted-worker',
      });

      // Make streaming request to worker
      const response = await fetch(`${this.config.workerUrl}/execute`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Worker execution failed: ${error}`);
      }

      if (!response.body) {
        throw new Error('No response body from worker');
      }

      // Process SSE stream
      const result = await this.processEventStream(
        response.body,
        onEvent,
        request.chatSessionId
      );

      clearTimeout(timeoutId);
      return result;

    } catch (error) {
      clearTimeout(timeoutId);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isAbort = error instanceof Error && (
        error.name === 'AbortError' ||
        errorMessage.includes('aborted')
      );

      if (isAbort) {
        logger.info('Worker execution aborted', {
          component: 'SelfHostedWorkerProvider',
          chatSessionId: request.chatSessionId,
        });

        return {
          remoteSessionId: '',
          status: 'interrupted',
        };
      }

      logger.error('Worker execution failed', error, {
        component: 'SelfHostedWorkerProvider',
        chatSessionId: request.chatSessionId,
      });

      await onEvent({
        type: 'error',
        timestamp: new Date().toISOString(),
        source: this.name,
        error: errorMessage,
      });

      throw error;
    }
  }

  /**
   * Process the SSE event stream from the worker
   */
  private async processEventStream(
    stream: ReadableStream<Uint8Array>,
    onEvent: ExecutionEventCallback,
    chatSessionId: string
  ): Promise<ExecutionResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let result: ExecutionResult = {
      remoteSessionId: '',
      status: 'completed',
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let currentEventType = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            // Per SSE spec, multiple data: lines should be concatenated with newlines
            const dataContent = line.slice(5).trim();
            currentData = currentData ? `${currentData}\n${dataContent}` : dataContent;
          } else if (line === '' && currentData) {
            // End of message, process it
            try {
              const event = JSON.parse(currentData) as ExecutionEvent;

              // Override type if event type was specified
              // Cast is safe as worker should only send valid ExecutionEventTypes
              if (currentEventType) {
                event.type = currentEventType as ExecutionEventType;
              }

              // Add source if not present
              if (!event.source) {
                event.source = this.name;
              }

              // Capture result data from specific event types
              if (event.type === 'session_created' && event.remoteSessionId) {
                result.remoteSessionId = event.remoteSessionId;
                result.remoteWebUrl = event.remoteWebUrl;
              }

              if (event.type === 'result' || event.type === 'completed') {
                if (event.branch) result.branch = event.branch;
                if (event.totalCost) result.totalCost = event.totalCost;
                if (event.duration_ms) result.durationMs = event.duration_ms;
              }

              if (event.type === 'error') {
                result.status = 'failed';
              }

              await onEvent(event);
            } catch (parseError) {
              logger.warn('Failed to parse worker event', {
                component: 'SelfHostedWorkerProvider',
                chatSessionId,
                data: currentData.slice(0, 200),
              });
            }

            currentEventType = '';
            currentData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    logger.info('Worker stream completed', {
      component: 'SelfHostedWorkerProvider',
      chatSessionId,
      status: result.status,
      branch: result.branch,
    });

    return result;
  }
}
