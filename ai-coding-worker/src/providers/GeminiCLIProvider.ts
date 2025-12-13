import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { UserRequestContent, TextBlock, ImageBlock } from '../types';
import { CredentialManager } from '../utils/credentialManager';
import { SecureCredentialManager } from '../utils/secureCredentialManager';

/**
 * Gemini CLI provider implementation
 *
 * Wraps the Gemini CLI tool with OAuth authentication for Pro model access.
 * Requires OAuth credentials from ~/.gemini/oauth_creds.json
 */
export class GeminiCLIProvider extends BaseProvider {
  private model?: string;
  private geminiPath: string;
  private currentProcess: ChildProcess | null = null;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);
    this.model = model || 'gemini-2.5-pro'; // Default to Pro model
    this.geminiPath = process.env.GEMINI_CLI_PATH || 'gemini';

    // Write OAuth credentials to ~/.gemini/oauth_creds.json
    CredentialManager.writeGeminiCredentials(authentication);

    console.log('[GeminiCLIProvider] Provider initialized with OAuth', {
      model: this.model,
      geminiPath: this.geminiPath,
      isResuming: !!isResuming
    });
  }

  /**
   * Execute a user request using Gemini CLI
   */
  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    console.log('[GeminiCLIProvider] Starting execution with options:', {
      workspace: this.workspace,
      model: this.model,
      hasStructuredContent: typeof userRequest !== 'string'
    });

    try {
      // Convert user request to text prompt
      const prompt = this.convertToPrompt(userRequest);

      // Build CLI arguments
      const args = this.buildGeminiArgs(prompt, options);

      console.log('[GeminiCLIProvider] Spawning gemini CLI with args:', args.join(' '));

      // Send init event
      const sessionId = `gemini-cli-${Date.now()}`;
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          message: 'Gemini CLI provider initialized with OAuth'
        }
      });

      // Check if execution was aborted before starting
      if (options.abortSignal?.aborted) {
        console.log('[GeminiCLIProvider] Abort signal already aborted, skipping execution');
        throw new Error('Execution aborted before start');
      }

      // Execute the CLI command
      await this.executeGeminiCLI(args, options, onEvent);

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

      console.log('[GeminiCLIProvider] Execution completed successfully');
    } catch (error) {
      // Check if this was an abort
      const isAbort = options.abortSignal?.aborted ||
        (error instanceof Error && (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        ));

      if (isAbort) {
        console.log('[GeminiCLIProvider] Execution was aborted');
        throw new Error('Execution aborted by user');
      }

      console.error('[GeminiCLIProvider] Execution error:', error);
      throw error;
    }
  }

  /**
   * Build Gemini CLI arguments
   */
  private buildGeminiArgs(prompt: string, options: ProviderOptions): string[] {
    const args: string[] = [];

    // Use headless mode with JSON output for structured parsing
    args.push('--output-format', 'stream-json');

    // Add the prompt
    args.push('--prompt', prompt);

    // Add model if specified
    if (this.model) {
      args.push('--model', this.model);
    }

    // Add yolo flag for auto-approval (non-interactive)
    args.push('--yolo');

    // Add working directory context
    if (this.workspace) {
      args.push('--include-directories', this.workspace);
    }

    return args;
  }

  /**
   * Execute Gemini CLI and stream output
   */
  private executeGeminiCLI(
    args: string[],
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use session-specific home for credential isolation
      const effectiveHome = CredentialManager.getEffectiveHome();

      const process = spawn(this.geminiPath, args, {
        cwd: this.workspace,
        env: {
          ...global.process.env,
          // Use session-specific home for credential isolation
          HOME: effectiveHome
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.currentProcess = process;

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          this.killProcess();
          reject(new Error('Execution aborted by user'));
        });
      }

      // Parse stdout line by line for stream-json format
      const stdoutReader = readline.createInterface({
        input: process.stdout!,
        crlfDelay: Infinity
      });

      let fullResponse = '';

      stdoutReader.on('line', (line) => {
        if (!line.trim()) return;

        try {
          const event = JSON.parse(line);
          const normalized = this.normalizeGeminiEvent(event);

          if (normalized) {
            onEvent(normalized);

            // Accumulate response text
            if (normalized.type === 'assistant_message' && normalized.data?.message?.content) {
              const content = normalized.data.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    fullResponse += block.text;
                  }
                }
              }
            }
          }
        } catch (parseError) {
          // Not JSON, treat as plain text output
          console.log('[GeminiCLIProvider] Plain text output:', line);
          fullResponse += line + '\n';

          onEvent({
            type: 'assistant_message',
            data: {
              type: 'assistant',
              message: {
                content: [{
                  type: 'text',
                  text: line
                }]
              }
            },
            model: this.model
          });
        }
      });

      // Capture stderr
      let stderrOutput = '';
      process.stderr?.on('data', (data) => {
        stderrOutput += data.toString();
        console.log('[GeminiCLIProvider] stderr:', data.toString());
      });

      // Handle process completion
      process.on('close', (code) => {
        this.currentProcess = null;
        console.log('[GeminiCLIProvider] Process exited with code:', code);
        console.log('[GeminiCLIProvider] Total response length:', fullResponse.length);

        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Gemini CLI exited with code ${code}: ${stderrOutput}`));
        }
      });

      process.on('error', (error) => {
        this.currentProcess = null;
        console.error('[GeminiCLIProvider] Process error:', error);
        reject(error);
      });
    });
  }

  /**
   * Normalize Gemini CLI events to standard format
   */
  private normalizeGeminiEvent(event: any): ProviderStreamEvent | null {
    // Handle different event types from Gemini CLI
    switch (event.type) {
      case 'message':
      case 'text':
        return {
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'text',
                text: event.content || event.text || event.message || ''
              }]
            }
          },
          model: this.model
        };

      case 'tool_use':
        return {
          type: 'assistant_message',
          data: {
            type: 'tool_use',
            tool_name: event.name || event.tool,
            tool_input: event.input || event.args || {}
          },
          model: this.model
        };

      case 'tool_result':
        return {
          type: 'assistant_message',
          data: {
            type: 'tool_result',
            tool_name: event.name || event.tool,
            result: event.result || event.output || ''
          },
          model: this.model
        };

      case 'error':
        return {
          type: 'assistant_message',
          data: {
            type: 'error',
            message: event.message || event.error || 'Unknown error'
          },
          model: this.model
        };

      case 'init':
      case 'ready':
        return {
          type: 'assistant_message',
          data: {
            type: 'system',
            subtype: 'init',
            message: event.message || 'Gemini ready'
          },
          model: this.model
        };

      case 'done':
      case 'complete':
        // Skip completion events, we send our own
        return null;

      default:
        // Pass through unknown events as messages if they have content
        if (event.content || event.text || event.message) {
          return {
            type: 'assistant_message',
            data: {
              type: 'assistant',
              message: {
                content: [{
                  type: 'text',
                  text: event.content || event.text || event.message
                }]
              }
            },
            model: this.model
          };
        }
        console.log('[GeminiCLIProvider] Unknown event type:', event.type, event);
        return null;
    }
  }

  /**
   * Kill the current CLI process
   */
  private killProcess(): void {
    if (this.currentProcess) {
      console.log('[GeminiCLIProvider] Killing process');

      // Try SIGTERM first, then SIGKILL after timeout
      this.currentProcess.kill('SIGTERM');

      setTimeout(() => {
        if (this.currentProcess) {
          this.currentProcess.kill('SIGKILL');
          this.currentProcess = null;
        }
      }, 1500);
    }
  }

  /**
   * Convert user request content to text prompt
   */
  private convertToPrompt(content: UserRequestContent): string {
    if (typeof content === 'string') {
      return content;
    }

    const parts: string[] = [];

    for (const block of content) {
      if (block.type === 'text') {
        parts.push((block as TextBlock).text);
      } else if (block.type === 'image') {
        // Note: Gemini CLI may not support inline images in headless mode
        // We'd need to save the image to a file and reference it
        const imageBlock = block as ImageBlock;
        parts.push(`[Image: ${imageBlock.source.media_type}]`);
        console.warn('[GeminiCLIProvider] Image blocks not fully supported in CLI mode');
      }
    }

    return parts.join('\n');
  }

  /**
   * Validate Gemini OAuth credentials
   */
  async validateToken(): Promise<boolean> {
    try {
      return CredentialManager.hasGeminiOAuthCredentials();
    } catch (error) {
      console.error('[GeminiCLIProvider] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'gemini-cli';
  }
}
