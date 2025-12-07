import { query, type Options, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { CredentialManager } from '../utils/credentialManager';
import { UserRequestContent, ImageBlock, TextBlock } from '../types';
import type { MessageParam } from '@anthropic-ai/sdk/resources';

/**
 * Claude Code provider implementation
 */
export class ClaudeCodeProvider extends BaseProvider {
  private model?: string;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);
    this.model = model; // Use SDK default if not specified

    // Always write credentials to ensure we have the latest tokens
    // Even when resuming, the request may contain refreshed OAuth tokens
    // that are newer than what's stored in session storage
    CredentialManager.writeClaudeCredentials(authentication);
    console.log('[ClaudeCodeProvider] Credentials written', { isResuming: !!isResuming });
  }

  /**
   * Execute a user request using Claude Code
   */
  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    const queryOptions = this.createQueryOptions(options);

    // Verify workspace files exist right before SDK execution
    const fs = await import('fs');
    const workspaceFiles = fs.existsSync(queryOptions.cwd!)
      ? fs.readdirSync(queryOptions.cwd!)
      : [];

    console.log('[ClaudeCodeProvider] Starting execution with options:', {
      model: queryOptions.model,
      cwd: queryOptions.cwd,
      permissionMode: queryOptions.permissionMode,
      resumeSessionId: queryOptions.resume,
      hasStructuredContent: typeof userRequest !== 'string',
      workspaceFileCount: workspaceFiles.length,
      workspaceFiles: workspaceFiles.slice(0, 20)
    });

    if (workspaceFiles.length === 0) {
      console.error('[ClaudeCodeProvider] CRITICAL: Workspace is EMPTY right before SDK query!', {
        cwd: queryOptions.cwd,
        exists: fs.existsSync(queryOptions.cwd!)
      });
    }

    try {
      // Prepare the prompt parameter based on request type
      const prompt = typeof userRequest === 'string'
        ? userRequest
        : this.createStructuredMessageStream(userRequest);

      // Create AbortController for SDK - either use provided signal or create new one
      const abortController = new AbortController();

      // If an external abort signal is provided, forward abort to our controller
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          console.log('[ClaudeCodeProvider] External abort signal received, aborting SDK query');
          abortController.abort();
        });

        // Check if already aborted
        if (options.abortSignal.aborted) {
          console.log('[ClaudeCodeProvider] Abort signal already aborted, skipping execution');
          throw new Error('Execution aborted before start');
        }
      }

      const queryStream = query({
        prompt,
        options: {
          ...queryOptions,
          abortController
        }
      });

      let lastMessage: any = null;

      // Stream messages from Claude Code
      for await (const message of queryStream) {
        lastMessage = message;

        // Log important message types and emit session_id for persistence
        if (message.type === 'system' && message.subtype === 'init') {
          console.log('[ClaudeCodeProvider] Claude Code initialized, session:', message.session_id);
          // Emit provider_session event so the caller can capture and persist the session_id
          onEvent({
            type: 'provider_session',
            data: {
              sessionId: message.session_id
            }
          });
        }

        // Log error messages
        if (message.type === 'assistant' && message.message?.content) {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'text' && item.text) {
                console.log('[ClaudeCodeProvider] Assistant message:', item.text);
              }
            }
          }
        }

        // Log result messages
        if (message.type === 'result') {
          console.log('[ClaudeCodeProvider] Result:', {
            subtype: message.subtype,
            is_error: message.is_error,
            duration_ms: message.duration_ms,
            error_message: (message as any).error_message || (message as any).result
          });
        }

        // Extract model from SDK response - prefer actual model used over requested model
        // The SDK returns the model in message.message.model for assistant messages
        const actualModel = (message.type === 'assistant' && message.message?.model)
          ? message.message.model
          : queryOptions.model;

        onEvent({
          type: 'assistant_message',
          data: message,
          model: actualModel
        });
      }

      console.log('[ClaudeCodeProvider] Execution completed successfully');
    } catch (error) {
      // Check if this was an abort
      const isAbort = options.abortSignal?.aborted ||
        (error instanceof Error && (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        ));

      if (isAbort) {
        console.log('[ClaudeCodeProvider] Execution was aborted');
        // Send abort event to stream
        onEvent({
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'abort',
            message: 'Execution was aborted by user'
          }
        });
        // Re-throw with clear abort message
        throw new Error('Execution aborted by user');
      }

      console.error('[ClaudeCodeProvider] Execution error:', error);
      console.error('[ClaudeCodeProvider] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        code: (error as any)?.code,
        exitCode: (error as any)?.exitCode
      });

      // Re-throw to let orchestrator handle
      throw error;
    }
  }

  /**
   * Validate Claude Code authentication
   * Verifies that credentials are written to ~/.claude/.credentials.json
   */
  async validateToken(): Promise<boolean> {
    try {
      const credPath = CredentialManager.getClaudeCredentialPath();
      return CredentialManager.credentialFileExists(credPath);
    } catch (error) {
      console.error('[ClaudeCodeProvider] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'claude-code';
  }

  /**
   * Create Claude Code query options
   */
  private createQueryOptions(options: ProviderOptions): Options {
    const { resumeSessionId, providerOptions = {} } = options;

    const skipPermissions = providerOptions.skipPermissions ?? true;

    // Determine which model to use (if any)
    const modelToUse = providerOptions.model || this.model;

    const queryOptions: Options = {
      // Only include model if explicitly specified, otherwise let SDK use its default
      ...(modelToUse ? { model: modelToUse } : {}),
      cwd: this.workspace,
      systemPrompt: `You are Claude Code, running in a containerized environment. The working directory is ${this.workspace}.`,
      allowDangerouslySkipPermissions: skipPermissions,
      permissionMode: skipPermissions ? 'bypassPermissions' : 'default',
    };

    // Add resume option if session ID is provided
    if (resumeSessionId) {
      queryOptions.resume = resumeSessionId;
    }

    return queryOptions;
  }

  /**
   * Convert structured content (with images) into AsyncIterable<SDKUserMessage>
   * This is required by the SDK when passing content with images
   */
  private async *createStructuredMessageStream(
    content: Array<TextBlock | ImageBlock>
  ): AsyncIterable<SDKUserMessage> {
    // Convert our types to Anthropic SDK MessageParam format
    const messageContent = content.map(block => {
      if (block.type === 'text') {
        return {
          type: 'text' as const,
          text: block.text
        };
      } else {
        // Image block
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: block.source.media_type,
            data: block.source.data
          }
        };
      }
    });

    // Create the MessageParam
    const messageParam: MessageParam = {
      role: 'user',
      content: messageContent
    };

    // Yield a single SDKUserMessage with the structured content
    yield {
      type: 'user',
      message: messageParam,
      parent_tool_use_id: null,
      session_id: '' // Will be set by SDK
    } as SDKUserMessage;
  }
}
