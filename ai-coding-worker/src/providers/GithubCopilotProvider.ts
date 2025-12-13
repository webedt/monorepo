import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { UserRequestContent, TextBlock } from '../types';
import { CredentialManager } from '../utils/credentialManager';
import { SecureCredentialManager } from '../utils/secureCredentialManager';

/**
 * GitHub Copilot provider implementation
 *
 * Uses the GitHub CLI (gh) with the copilot extension to interact with
 * GitHub Copilot for code generation and assistance.
 *
 * Note: GitHub Copilot CLI requires a GitHub Copilot subscription.
 */
export class GithubCopilotProvider extends BaseProvider {
  private process?: ChildProcess;

  constructor(authentication: string, workspace: string, model?: string, isResuming?: boolean) {
    super(authentication, workspace);

    // Write GitHub token for gh CLI authentication
    this.writeGitHubAuth(authentication);
    console.log('[GithubCopilotProvider] GitHub auth configured', { isResuming: !!isResuming });
  }

  /**
   * Write GitHub authentication for gh CLI
   * Uses secure credential management to avoid leaking tokens in logs
   */
  private writeGitHubAuth(authentication: string): void {
    try {
      // Parse authentication if it's JSON
      let token: string;
      try {
        const parsed = JSON.parse(authentication);
        token = parsed.apiKey || parsed.token || authentication;
      } catch {
        token = authentication;
      }

      // Set environment variable for gh CLI (using secure method)
      SecureCredentialManager.setCredentialEnv('GH_TOKEN', token);
      SecureCredentialManager.setCredentialEnv('GITHUB_TOKEN', token);

      // Write to gh hosts file using session-specific home directory
      const ghConfigDir = path.dirname(CredentialManager.getGitHubConfigPath());
      if (!fs.existsSync(ghConfigDir)) {
        fs.mkdirSync(ghConfigDir, { recursive: true, mode: 0o700 });
      }
      // Enforce secure permissions on config directory
      fs.chmodSync(ghConfigDir, 0o700);

      const hostsFile = CredentialManager.getGitHubConfigPath();
      const hostsContent = `github.com:
    oauth_token: ${token}
    user: github-actions
    git_protocol: https
`;
      fs.writeFileSync(hostsFile, hostsContent, { mode: 0o600 });
      // Enforce secure permissions on hosts file
      fs.chmodSync(hostsFile, 0o600);

      console.log('[GithubCopilotProvider] GitHub authentication configured (token redacted)');
    } catch (error) {
      console.error('[GithubCopilotProvider] Failed to configure GitHub auth:', error);
      throw error;
    }
  }

  /**
   * Execute a user request using GitHub Copilot CLI
   */
  async execute(
    userRequest: UserRequestContent,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    console.log('[GithubCopilotProvider] Starting execution with options:', {
      workspace: this.workspace,
      hasStructuredContent: typeof userRequest !== 'string'
    });

    try {
      // Convert structured content to plain text (Copilot doesn't support images)
      const prompt = this.extractPromptText(userRequest);

      // Send init event
      const sessionId = `copilot-${Date.now()}`;
      onEvent({
        type: 'assistant_message',
        data: {
          type: 'system',
          subtype: 'init',
          session_id: sessionId,
          message: 'GitHub Copilot provider initialized'
        }
      });

      // Check if execution was aborted before starting
      if (options.abortSignal?.aborted) {
        console.log('[GithubCopilotProvider] Abort signal already aborted, skipping execution');
        throw new Error('Execution aborted before start');
      }

      // Use gh copilot suggest for code suggestions
      // The 'suggest' subcommand provides shell command suggestions
      // For code assistance, we use the 'explain' subcommand or direct suggestions
      await this.runCopilotCommand(prompt, options, onEvent);

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

      console.log('[GithubCopilotProvider] Execution completed successfully');
    } catch (error) {
      // Check if this was an abort
      const isAbort = options.abortSignal?.aborted ||
        (error instanceof Error && (
          error.name === 'AbortError' ||
          error.message.includes('aborted') ||
          error.message.includes('abort')
        ));

      if (isAbort) {
        console.log('[GithubCopilotProvider] Execution was aborted');
        if (this.process) {
          this.process.kill('SIGTERM');
        }
        throw new Error('Execution aborted by user');
      }

      console.error('[GithubCopilotProvider] Execution error:', error);
      throw error;
    }
  }

  /**
   * Run the gh copilot command
   */
  private async runCopilotCommand(
    prompt: string,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use 'gh copilot suggest' for shell/git commands or 'gh copilot explain' for code
      // Since we want code generation, we'll use a combination approach
      const args = ['copilot', 'suggest', '-t', 'shell', prompt];

      console.log('[GithubCopilotProvider] Running command: gh', args.join(' '));

      this.process = spawn('gh', args, {
        cwd: this.workspace,
        env: {
          ...process.env,
          GH_TOKEN: process.env.GH_TOKEN,
          GITHUB_TOKEN: process.env.GITHUB_TOKEN,
        },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;

        // Stream output as assistant messages
        onEvent({
          type: 'assistant_message',
          data: {
            type: 'assistant',
            message: {
              content: [{
                type: 'text',
                text: text
              }]
            }
          }
        });
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        console.log('[GithubCopilotProvider] stderr:', text);
      });

      // Handle abort signal
      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          console.log('[GithubCopilotProvider] Abort signal received');
          this.process?.kill('SIGTERM');
        });
      }

      this.process.on('close', (code: number | null) => {
        console.log('[GithubCopilotProvider] Process exited with code:', code);

        if (options.abortSignal?.aborted) {
          reject(new Error('Execution aborted by user'));
          return;
        }

        if (code === 0) {
          resolve();
        } else {
          // Check for common errors
          if (stderr.includes('not logged in')) {
            reject(new Error('GitHub authentication failed. Please reconnect your GitHub account.'));
          } else if (stderr.includes('copilot') && stderr.includes('not found')) {
            reject(new Error('GitHub Copilot CLI extension not found. Please install it with: gh extension install github/gh-copilot'));
          } else {
            reject(new Error(`GitHub Copilot command failed with exit code ${code}: ${stderr || stdout}`));
          }
        }
      });

      this.process.on('error', (error: Error) => {
        console.error('[GithubCopilotProvider] Process error:', error);
        if (error.message.includes('ENOENT')) {
          reject(new Error('GitHub CLI (gh) not found. Please ensure it is installed.'));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * Extract plain text from user request content
   * Copilot doesn't support images, so we only extract text blocks
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
   * Validate GitHub Copilot authentication
   */
  async validateToken(): Promise<boolean> {
    try {
      return !!process.env.GH_TOKEN || !!process.env.GITHUB_TOKEN;
    } catch (error) {
      console.error('[GithubCopilotProvider] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'github-copilot';
  }
}
