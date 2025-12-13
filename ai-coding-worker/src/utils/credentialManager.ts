import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { SecureCredentialManager } from './secureCredentialManager';

/**
 * Utility for managing provider credential files
 *
 * Security enhancements:
 * - Creates directories and files with restricted permissions (700/600)
 * - Supports session-isolated credential directories
 * - Validates credentials don't leak into logs
 * - Uses atomic writes to prevent partial credential files
 * - Integrates with SecureCredentialManager for encryption support
 */
export class CredentialManager {
  // Session-specific home directory for credential isolation
  private static sessionHomeDir: string | null = null;

  /**
   * Set a session-specific home directory for credential isolation
   * All credential operations will use this directory instead of the real home
   */
  static setSessionHome(sessionDir: string): void {
    this.sessionHomeDir = sessionDir;
    // Ensure the directory exists with secure permissions
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    }
    fs.chmodSync(sessionDir, 0o700);
    console.log(`[CredentialManager] Session home set to: ${SecureCredentialManager.redactPath(sessionDir)}`);
  }

  /**
   * Clear the session-specific home directory
   */
  static clearSessionHome(): void {
    this.sessionHomeDir = null;
    console.log('[CredentialManager] Session home cleared, using default home directory');
  }

  /**
   * Get the effective home directory (session-specific or real)
   */
  static getEffectiveHome(): string {
    return this.sessionHomeDir || os.homedir();
  }

  /**
   * Write credentials to a file with secure permissions
   * @param credentialPath - Absolute path to credential file
   * @param credentials - Credentials object to write
   */
  static writeCredentialFile(credentialPath: string, credentials: any): void {
    try {
      // Ensure directory exists with secure permissions
      const dir = path.dirname(credentialPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // Enforce secure permissions on directory
      fs.chmodSync(dir, 0o700);

      // Write credentials atomically (write to temp file, then rename)
      const tempPath = `${credentialPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;
      fs.writeFileSync(
        tempPath,
        JSON.stringify(credentials, null, 2),
        { mode: 0o600 }
      );
      fs.renameSync(tempPath, credentialPath);

      // Enforce secure permissions on file
      fs.chmodSync(credentialPath, 0o600);

      // Log with redacted path to avoid leaking sensitive directory info
      console.log(`[CredentialManager] Credentials written to: ${SecureCredentialManager.redactPath(credentialPath)}`);
    } catch (error) {
      throw new Error(
        `Failed to write credentials: ${error instanceof Error ? error.message : String(error)}`
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
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.claude/.credentials.json (or session equivalent)
   */
  static getClaudeCredentialPath(): string {
    return path.join(this.getEffectiveHome(), '.claude', '.credentials.json');
  }

  /**
   * Get credential path for Codex SDK
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.codex/auth.json (or session equivalent)
   */
  static getCodexCredentialPath(): string {
    return path.join(this.getEffectiveHome(), '.codex', 'auth.json');
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
   * Get credential path for Gemini OAuth (used by Gemini CLI)
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.gemini/oauth_creds.json (or session equivalent)
   */
  static getGeminiOAuthCredentialPath(): string {
    return path.join(this.getEffectiveHome(), '.gemini', 'oauth_creds.json');
  }

  /**
   * Get credential path for Gemini settings
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.gemini/settings.json (or session equivalent)
   */
  static getGeminiSettingsPath(): string {
    return path.join(this.getEffectiveHome(), '.gemini', 'settings.json');
  }

  /**
   * Get credential path for Gemini env file
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.gemini/.env (or session equivalent)
   */
  static getGeminiEnvPath(): string {
    return path.join(this.getEffectiveHome(), '.gemini', '.env');
  }

  /**
   * Get credential path for GitHub CLI config
   * Uses session-specific home if set for credential isolation
   * @returns Absolute path to ~/.config/gh/hosts.yml (or session equivalent)
   */
  static getGitHubConfigPath(): string {
    return path.join(this.getEffectiveHome(), '.config', 'gh', 'hosts.yml');
  }

  /**
   * Cleanup session credentials when session ends
   * Securely deletes all credential files in the session directory
   */
  static cleanupSessionCredentials(): void {
    if (!this.sessionHomeDir) {
      return;
    }

    try {
      SecureCredentialManager.secureDeleteDirectory(this.sessionHomeDir);
      this.sessionHomeDir = null;
      console.log('[CredentialManager] Session credentials cleaned up');
    } catch (error) {
      console.warn('[CredentialManager] Failed to cleanup session credentials:',
        error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Write Gemini credentials
   * OAuth only - writes to ~/.gemini/oauth_creds.json for Gemini CLI
   *
   * @param authentication - Gemini OAuth JSON structure
   */
  static writeGeminiCredentials(authentication: string): void {
    let parsed: any;

    try {
      parsed = JSON.parse(authentication);
    } catch {
      throw new Error('Invalid Gemini credentials: must be valid JSON OAuth credentials');
    }

    // Support both camelCase and snake_case formats
    const accessToken = parsed.accessToken || parsed.access_token;
    const refreshToken = parsed.refreshToken || parsed.refresh_token;
    const expiresAt = parsed.expiresAt || parsed.expiry_date;

    if (!accessToken || !refreshToken) {
      throw new Error('Invalid Gemini credentials: missing accessToken/access_token or refreshToken/refresh_token');
    }

    // Write to oauth_creds.json for Gemini CLI
    const oauthCredentialPath = this.getGeminiOAuthCredentialPath();

    // Format for Gemini CLI oauth_creds.json (uses snake_case)
    const oauthCredentials = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: parsed.tokenType || parsed.token_type || 'Bearer',
      expiry_date: expiresAt || (Date.now() + 3600000), // Default 1 hour
      scope: parsed.scope || 'openid https://www.googleapis.com/auth/userinfo.email'
    };

    this.writeCredentialFile(oauthCredentialPath, oauthCredentials);
    console.log('[CredentialManager] Wrote Gemini OAuth credentials to:', oauthCredentialPath);

    // Also create a basic settings.json if it doesn't exist
    const settingsPath = this.getGeminiSettingsPath();
    if (!fs.existsSync(settingsPath)) {
      this.writeCredentialFile(settingsPath, {
        selectedAuthType: 'oauth',
        theme: 'system'
      });
      console.log('[CredentialManager] Created Gemini settings.json');
    }
  }

  /**
   * Check if Gemini has OAuth credentials
   * @returns true if OAuth credentials file exists
   */
  static hasGeminiOAuthCredentials(): boolean {
    return fs.existsSync(this.getGeminiOAuthCredentialPath());
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
