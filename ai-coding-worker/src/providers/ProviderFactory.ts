import { BaseProvider } from './BaseProvider';
import { ClaudeCodeProvider } from './ClaudeCodeProvider';
import { CodexProvider } from './CodexProvider';
import { GithubCopilotProvider } from './GithubCopilotProvider';
import { GeminiProvider } from './GeminiProvider';
import { GeminiCLIProvider } from './GeminiCLIProvider';

/**
 * Factory for creating coding assistant provider instances
 */
export class ProviderFactory {
  /**
   * Check if authentication contains OAuth credentials (vs API key)
   */
  private static hasOAuthCredentials(authentication: string): boolean {
    try {
      const parsed = JSON.parse(authentication);
      return !!(parsed.accessToken && parsed.refreshToken);
    } catch {
      return false;
    }
  }

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
      case 'openai':
        return new CodexProvider(authentication, workspace, options?.model, isResuming);

      case 'copilot':
      case 'github-copilot':
      case 'githubcopilot':
        return new GithubCopilotProvider(authentication, workspace, options?.model, isResuming);

      case 'gemini':
      case 'google':
      case 'google-gemini':
        // Use CLI provider for OAuth credentials (Pro model access)
        // Fall back to SDK provider for API key (Flash models)
        if (this.hasOAuthCredentials(authentication)) {
          console.log('[ProviderFactory] Using GeminiCLIProvider for OAuth authentication');
          return new GeminiCLIProvider(authentication, workspace, options?.model, isResuming);
        }
        console.log('[ProviderFactory] Using GeminiProvider (SDK) for API key authentication');
        return new GeminiProvider(authentication, workspace, options?.model, isResuming);

      case 'gemini-cli':
        // Force CLI provider regardless of auth type
        return new GeminiCLIProvider(authentication, workspace, options?.model, isResuming);

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
    return [
      'claude-code', 'claude', 'claudeagentsdk',
      'codex', 'cursor', 'codexsdk', 'openai',
      'copilot', 'github-copilot', 'githubcopilot',
      'gemini', 'google', 'google-gemini', 'gemini-cli'
    ];
  }

  /**
   * Check if a provider is supported
   */
  static isProviderSupported(providerName: string): boolean {
    const normalizedName = providerName.toLowerCase().trim();
    return this.getSupportedProviders().includes(normalizedName);
  }
}
