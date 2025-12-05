import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Utility for managing Claude credential files for LLM-based naming
 */
export class CredentialManager {
  /**
   * Write credentials to a file with secure permissions
   */
  static writeCredentialFile(credentialPath: string, credentials: any): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(credentialPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }

      // Write credentials as JSON
      fs.writeFileSync(
        credentialPath,
        JSON.stringify(credentials, null, 2),
        { mode: 0o600 }
      );

      console.log(`[CredentialManager] Credentials written to: ${credentialPath}`);
    } catch (error) {
      throw new Error(
        `Failed to write credentials to ${credentialPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get credential path for Claude Agent SDK
   */
  static getClaudeCredentialPath(): string {
    return path.join(os.homedir(), '.claude', '.credentials.json');
  }

  /**
   * Write Claude Agent SDK credentials
   * Used for LLM-based session naming and commit message generation
   */
  static writeClaudeCredentials(authentication: string): void {
    const credentialPath = this.getClaudeCredentialPath();

    // Parse authentication if it's JSON, otherwise treat as plain API key
    let credentials: any;
    try {
      const parsed = JSON.parse(authentication);

      // Check if it's already in the correct format with claudeAiOauth wrapper
      if (parsed.claudeAiOauth) {
        credentials = parsed;
      }
      // Check if it's raw OAuth tokens that need to be wrapped
      else if (parsed.accessToken && parsed.refreshToken) {
        credentials = {
          claudeAiOauth: {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresAt: parsed.expiresAt || (Date.now() + 86400000),
            scopes: parsed.scopes || ['user:inference', 'user:profile'],
            subscriptionType: parsed.subscriptionType || 'max'
          }
        };
        console.log('[CredentialManager] Wrapped OAuth tokens in claudeAiOauth format');
      }
      // Check if it's a plain API key in object format
      else if (parsed.apiKey) {
        credentials = parsed;
      }
      // Unknown format, write as-is
      else {
        credentials = parsed;
      }
    } catch {
      // Not JSON, treat as plain API key
      credentials = {
        apiKey: authentication,
        createdAt: new Date().toISOString()
      };
    }

    this.writeCredentialFile(credentialPath, credentials);
  }

  /**
   * Check if credential file exists
   */
  static credentialFileExists(credentialPath: string): boolean {
    return fs.existsSync(credentialPath);
  }

  /**
   * Clean up credential files (called on worker exit)
   */
  static cleanup(): void {
    try {
      const credPath = this.getClaudeCredentialPath();
      if (fs.existsSync(credPath)) {
        fs.unlinkSync(credPath);
        console.log('[CredentialManager] Cleaned up credential file');
      }
    } catch (error) {
      console.warn('[CredentialManager] Failed to cleanup credentials:', error);
    }
  }
}
