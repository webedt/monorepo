import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';
import { CredentialManager } from '../utils/credentialManager';

/**
 * Codex provider for Cursor/OpenAI Codex integration
 *
 * Note: This is a placeholder implementation. The actual Cursor/Codex SDK
 * integration will be added when the SDK is available.
 */
export class CodexProvider extends BaseProvider {
  constructor(authentication: string, workspace: string) {
    super(authentication, workspace);

    // Write authentication to ~/.codex/auth.json
    CredentialManager.writeCodexCredentials(authentication);
  }

  async execute(
    userRequest: string,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    console.log('[CodexProvider] Starting execution...');

    // Send init message
    onEvent({
      type: 'assistant_message',
      data: {
        type: 'system',
        subtype: 'init',
        session_id: `codex-${Date.now()}`,
        message: 'Codex provider initialized'
      }
    });

    // TODO: Integrate with actual Cursor/Codex SDK
    // For now, send a placeholder message
    onEvent({
      type: 'assistant_message',
      data: {
        type: 'text',
        text: 'Codex provider is not yet fully implemented. This is a placeholder response.'
      }
    });

    console.log('[CodexProvider] Execution completed');
  }

  async validateToken(): Promise<boolean> {
    try {
      const credPath = CredentialManager.getCodexCredentialPath();
      return CredentialManager.credentialFileExists(credPath);
    } catch (error) {
      console.error('[CodexProvider] Token validation failed:', error);
      return false;
    }
  }

  getProviderName(): string {
    return 'codex';
  }
}
