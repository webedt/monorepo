import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Utility for managing provider credential files
 */
export class CredentialManager {
  /**
   * Write credentials to a file with secure permissions
   * @param credentialPath - Absolute path to credential file
   * @param credentials - Credentials object to write
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
   * Read credentials from a file
   * @param credentialPath - Absolute path to credential file
   * @returns Parsed credentials object
   */
  static readCredentialFile(credentialPath: string): any {
    try {
      if (!fs.existsSync(credentialPath)) {
        throw new Error(`Credential file not found: ${credentialPath}`);
      }

      const content = fs.readFileSync(credentialPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to read credentials from ${credentialPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get credential path for Claude Agent SDK
   * @returns Absolute path to ~/.claude/.credentials.json
   */
  static getClaudeCredentialPath(): string {
    return path.join(os.homedir(), '.claude', '.credentials.json');
  }

  /**
   * Get credential path for Codex SDK
   * @returns Absolute path to ~/.codex/auth.json
   */
  static getCodexCredentialPath(): string {
    return path.join(os.homedir(), '.codex', 'auth.json');
  }

  /**
   * Write Claude Agent SDK credentials
   * @param authentication - Anthropic API key or OAuth JSON string
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
        // Frontend sent OAuth tokens without wrapper - add it
        credentials = {
          claudeAiOauth: {
            accessToken: parsed.accessToken,
            refreshToken: parsed.refreshToken,
            expiresAt: parsed.expiresAt || (Date.now() + 86400000), // Default to 24h if not provided
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
      // Unknown format, write as-is and let SDK handle it
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
   * Write Codex SDK credentials
   * Supports multiple authentication formats:
   * - JSON with apiKey field (OpenAI API key)
   * - JSON with accessToken/refreshToken (ChatGPT subscription OAuth)
   * - Plain string (treated as API key)
   *
   * Also sets OPENAI_API_KEY environment variable for SDK
   *
   * @param authentication - Codex authentication token or JSON structure
   */
  static writeCodexCredentials(authentication: string): void {
    const credentialPath = this.getCodexCredentialPath();

    // Parse authentication if it's JSON, otherwise treat as plain auth token
    let credentials: any;
    let apiKey: string | undefined;

    try {
      const parsed = JSON.parse(authentication);

      // Check for API key format
      if (parsed.apiKey) {
        apiKey = parsed.apiKey;
        credentials = {
          apiKey: parsed.apiKey,
          createdAt: new Date().toISOString()
        };
        console.log('[CredentialManager] Using OpenAI API key authentication for Codex');
      }
      // Check for ChatGPT subscription OAuth format
      else if (parsed.accessToken) {
        credentials = {
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt: parsed.expiresAt,
          createdAt: new Date().toISOString()
        };
        console.log('[CredentialManager] Using ChatGPT OAuth authentication for Codex');
      }
      // Unknown format, write as-is
      else {
        credentials = parsed;
        console.log('[CredentialManager] Using unknown format for Codex credentials');
      }
    } catch {
      // Not JSON, treat as plain API key
      apiKey = authentication;
      credentials = {
        apiKey: authentication,
        createdAt: new Date().toISOString()
      };
      console.log('[CredentialManager] Using plain API key string for Codex');
    }

    // Set OPENAI_API_KEY environment variable if we have an API key
    // The Codex SDK reads from this env var
    if (apiKey) {
      process.env.OPENAI_API_KEY = apiKey;
      console.log('[CredentialManager] Set OPENAI_API_KEY environment variable');
    }

    this.writeCredentialFile(credentialPath, credentials);
  }

  /**
   * Check if credential file exists
   * @param credentialPath - Path to check
   * @returns true if file exists
   */
  static credentialFileExists(credentialPath: string): boolean {
    return fs.existsSync(credentialPath);
  }
}
