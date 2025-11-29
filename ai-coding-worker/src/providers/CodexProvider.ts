import { Codex } from '@openai/codex-sdk';
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { CredentialManager } from '../utils/credentialManager';
import { UserRequestContent, TextBlock } from '../types';

/**
 * Codex provider for OpenAI Codex CLI integration
 *
 * Uses the @openai/codex-sdk to interact with OpenAI's Codex agent.
 * Supports both API key and ChatGPT subscription authentication.
 */
export class CodexProvider extends BaseProvider {
  private model?: string;
  private codex?: Codex;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);
    this.model = model;

    // Write authentication to ~/.codex/config.toml or set up API key
    CredentialManager.writeCodexCredentials(authentication);
    console.log('[CodexProvider] Credentials written', { isResuming: !!isResuming });
  }

  /**
   * Execute a user request using Codex
   */
  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    console.log('[CodexProvider] Starting execution with options:', {
      workspace: this.workspace,
      resumeSessionId: options.resumeSessionId,
      hasStructuredContent: typeof userRequest !== 'string'
    });

    try {
      // Initialize Codex client
      // The SDK reads authentication from environment variables or config files
      this.codex = new Codex();

      // Convert structured content to plain text (Codex doesn't support images yet)
      const prompt = this.extractPromptText(userRequest);

      // Start or resume a thread
      const thread = options.resumeSessionId
        ? this.codex.resumeThread(options.resumeSessionId)
        : this.codex.startThread({
            workingDirectory: this.workspace,
            skipGitRepoCheck: true // We manage git ourselves
          });

      // Send init event
      const sessionId = `codex-${Date.now()}`;
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          message: 'Codex provider initialized'
        }
      });

      console.log('[CodexProvider] Thread created, starting execution...');

      // Check if execution was aborted before starting
      if (options.abortSignal?.aborted) {
        console.log('[CodexProvider] Abort signal already aborted, skipping execution');
        throw new Error('Execution aborted before start');
      }

      // Use streaming API for real-time events
      const { events } = await thread.runStreamed(prompt);

      for await (const event of events) {
        // Check for abort signal
        if (options.abortSignal?.aborted) {
          console.log('[CodexProvider] Execution aborted during streaming');
          onEvent({
            type: 'assistant_message',
            data: {
              type: 'system',
              subtype: 'abort',
              message: 'Execution was aborted by user'
            }
          });
          throw new Error('Execution aborted by user');
        }

        // Map Codex events to our unified event format
        const mappedEvent = this.mapCodexEvent(event);
        if (mappedEvent) {
          onEvent(mappedEvent);
        }
      }

      // Send completion event
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: Date.now()
        }
      });

      console.log('[CodexProvider] Execution completed successfully');
    } catch (error) {
      // Check if this was an abort
      const isAbort = options.abortSignal?.aborted ||
        (error instanceof Error && (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        ));

      if (isAbort) {
        console.log('[CodexProvider] Execution was aborted');
        throw new Error('Execution aborted by user');
      }

      console.error('[CodexProvider] Execution error:', error);
      console.error('[CodexProvider] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

  /**
   * Extract plain text from user request content
   * Codex doesn't support images, so we only extract text blocks
   */
  private extractPromptText(content: UserRequestContent): string {
    if (typeof content === 'string') {
      return content;
    }

    // Extract text from content blocks, ignore images
    const textParts = content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text);

    if (textParts.length === 0) {
      throw new Error('No text content provided in request');
    }

    return textParts.join('\n');
  }

  /**
   * Map Codex SDK events to our unified ProviderStreamEvent format
   */
  private mapCodexEvent(event: any): ProviderStreamEvent | null {
    console.log('[CodexProvider] Received event:', event.type, JSON.stringify(event).substring(0, 200));

    switch (event.type) {
      // Thread lifecycle events
      case 'thread.started':
        return {
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'thread_started',
            session_id: event.threadId,
            message: 'Thread started'
          }
        };

      // Turn events (conversation rounds)
      case 'turn.started':
        return {
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'turn_started',
            message: 'Processing turn...'
          }
        };

      case 'turn.completed':
        return {
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'turn_completed',
            usage: event.usage,
            message: 'Turn completed'
          }
        };

      // Item events (individual operations)
      case 'item.started':
        return {
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'item_started',
            itemType: event.itemType,
            message: `Starting ${event.itemType || 'operation'}...`
          }
        };

      case 'item.completed':
        return this.mapItemCompleted(event);

      // Message events (agent responses)
      case 'message':
      case 'agent_message':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'text',
                text: event.content || event.message || ''
              }]
            }
          }
        };

      // Tool/command execution events
      case 'command_execution':
      case 'tool_call':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: event.id || `tool-${Date.now()}`,
                name: event.command || event.tool || 'unknown',
                input: event.args || event.input || {}
              }]
            }
          }
        };

      case 'tool_result':
      case 'command_result':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: event.id || `tool-${Date.now()}`,
                content: event.output || event.result || ''
              }]
            }
          }
        };

      // File change events
      case 'file_change':
      case 'file_diff':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'text',
                text: `File changed: ${event.path || event.file}\n${event.diff || ''}`
              }]
            }
          }
        };

      // Error events
      case 'error':
        return {
          type: 'assistant_message',
          data: {
            type: 'result',
            subtype: 'error',
            is_error: true,
            error_message: event.message || event.error || 'Unknown error'
          }
        };

      default:
        // Log unknown events for debugging but don't fail
        console.log('[CodexProvider] Unknown event type:', event.type);
        return null;
    }
  }

  /**
   * Map item.completed events to our format
   * These contain the actual work done by the agent
   */
  private mapItemCompleted(event: any): ProviderStreamEvent | null {
    const item = event.item || event;

    // Handle different item types
    if (item.type === 'message' || item.content) {
      // Text message from the agent
      const content = item.content || item.message || '';
      return {
        type: 'assistant_message',
        data: {
          type: 'assistant',
          message: {
            content: [{
              type: 'text',
              text: typeof content === 'string' ? content : JSON.stringify(content)
            }]
          }
        }
      };
    }

    if (item.type === 'function_call' || item.type === 'tool_use') {
      // Tool execution
      return {
        type: 'assistant_message',
        data: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: item.id || `tool-${Date.now()}`,
              name: item.name || item.function?.name || 'unknown',
              input: item.arguments || item.function?.arguments || item.input || {}
            }]
          }
        }
      };
    }

    if (item.type === 'function_call_output' || item.type === 'tool_result') {
      // Tool result
      return {
        type: 'assistant_message',
        data: {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: item.call_id || item.id || `tool-${Date.now()}`,
              content: item.output || ''
            }]
          }
        }
      };
    }

    // Default: return as generic message
    return {
      type: 'assistant_message',
      data: {
        type: 'system',
        subtype: 'item_completed',
        item: item
      }
    };
  }

  /**
   * Validate Codex authentication
   * Verifies that credentials are configured
   */
  async validateToken(): Promise<boolean> {
    try {
      const credPath = CredentialManager.getCodexCredentialPath();
      return CredentialManager.credentialFileExists(credPath);
    } catch (error) {
      console.error('[CodexProvider] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'codex';
  }
}
