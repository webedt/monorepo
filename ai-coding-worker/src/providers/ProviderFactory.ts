import { BaseProvider } from './BaseProvider';
import { ClaudeCodeProvider } from './ClaudeCodeProvider';
import { CodexProvider } from './CodexProvider';

/**
 * Factory for creating coding assistant provider instances
 */
export class ProviderFactory {
  /**
   * Create a provider instance based on provider name
   */
  static createProvider(
    providerName: string,
    authentication: string,
    workspace: string,
    options?: Record<string, any>,
    isResuming?: boolean
  ): BaseProvider {
    const normalizedName = providerName.toLowerCase().trim();

    switch (normalizedName) {
      case 'claude-code':
      case 'claude':
      case 'claudeagentsdk':
        return new ClaudeCodeProvider(authentication, workspace, options?.model, isResuming);

      case 'codex':
      case 'cursor':
      case 'codexsdk':
        return new CodexProvider(authentication, workspace);

      // Future providers:
      // case 'copilot':
      //   return new CopilotProvider(accessToken, workspace);
      // case 'aider':
      //   return new AiderProvider(accessToken, workspace);

      default:
        throw new Error(
          `Unsupported provider: ${providerName}. ` +
          `Supported providers: ${this.getSupportedProviders().join(', ')}`
        );
    }
  }

  /**
   * Get list of supported providers
   */
  static getSupportedProviders(): string[] {
    return ['claude-code', 'claude', 'claudeagentsdk', 'codex', 'cursor', 'codexsdk'];
  }

  /**
   * Check if a provider is supported
   */
  static isProviderSupported(providerName: string): boolean {
    const normalizedName = providerName.toLowerCase().trim();
    return this.getSupportedProviders().includes(normalizedName);
  }
}
