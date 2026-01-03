/**
 * Sensitive Data Service Documentation Interface
 *
 * This file contains the fully-documented interface for handling sensitive
 * user data encryption and decryption. The service provides secure storage
 * and retrieval of authentication tokens, API keys, and other PII.
 *
 * @see SensitiveDataService for the class implementation
 * @see encryptUserFields for field-level encryption
 * @see decryptUserFields for field-level decryption
 */

import type { User } from '../db/schema.js';

/**
 * Claude authentication data structure
 */
export interface ClaudeAuthData {
  /** OAuth access token for Claude API */
  accessToken: string;
  /** OAuth refresh token for token renewal */
  refreshToken: string;
  /** Token expiration timestamp */
  expiresAt?: number;
}

/**
 * Codex (OpenAI) authentication data structure
 */
export interface CodexAuthData {
  /** API key for direct API access */
  apiKey?: string;
  /** OAuth access token (if using OAuth flow) */
  accessToken?: string;
  /** OAuth refresh token */
  refreshToken?: string;
  /** Token expiration timestamp */
  expiresAt?: number;
}

/**
 * Gemini authentication data structure
 */
export interface GeminiAuthData {
  /** OAuth access token for Gemini API */
  accessToken: string;
  /** OAuth refresh token for token renewal */
  refreshToken: string;
  /** Token expiration timestamp */
  expiresAt?: number;
}

/**
 * Image AI provider API keys
 */
export interface ImageAiKeysData {
  /** OpenAI API key for DALL-E */
  openai?: string;
  /** Stability AI API key */
  stability?: string;
  /** Midjourney API key */
  midjourney?: string;
  /** Other provider keys */
  [key: string]: string | undefined;
}

/**
 * Sensitive fields in user record (decrypted form)
 */
export interface SensitiveUserFields {
  /** GitHub OAuth access token */
  githubAccessToken: string | null;
  /** Claude authentication data */
  claudeAuth: ClaudeAuthData | null;
  /** Codex/OpenAI authentication data */
  codexAuth: CodexAuthData | null;
  /** Gemini authentication data */
  geminiAuth: GeminiAuthData | null;
  /** OpenRouter API key */
  openrouterApiKey: string | null;
  /** Image AI provider API keys */
  imageAiKeys: ImageAiKeysData | null;
}

/**
 * Encrypted representation for database storage
 */
export interface EncryptedUserFields {
  /** Encrypted GitHub token */
  githubAccessToken: string | null;
  /** Encrypted Claude auth (JSON string when encrypted) */
  claudeAuth: unknown;
  /** Encrypted Codex auth */
  codexAuth: unknown;
  /** Encrypted Gemini auth */
  geminiAuth: unknown;
  /** Encrypted OpenRouter key */
  openrouterApiKey: string | null;
  /** Encrypted image AI keys */
  imageAiKeys: unknown;
}

/**
 * Interface for Sensitive Data Service with full documentation.
 *
 * The Sensitive Data Service provides centralized encryption and decryption
 * for sensitive user data stored in the database. It handles OAuth tokens,
 * API keys, and other credentials that require at-rest encryption.
 *
 * ## Encrypted Fields
 *
 * | Field | Type | Description |
 * |-------|------|-------------|
 * | githubAccessToken | string | GitHub OAuth access token |
 * | claudeAuth | JSON | Claude OAuth tokens (access + refresh) |
 * | codexAuth | JSON | OpenAI/Codex credentials |
 * | geminiAuth | JSON | Google Gemini OAuth tokens |
 * | openrouterApiKey | string | OpenRouter API key |
 * | imageAiKeys | JSON | Image generation provider keys |
 *
 * ## Encryption Behavior
 *
 * - Encryption is controlled by `ENCRYPTION_KEY` environment variable
 * - When disabled, data is stored as plaintext (development only)
 * - Uses AES-256-GCM with random IV per encryption
 * - Encrypted values are prefixed with `enc:` for detection
 *
 * ## ORM Integration
 *
 * The Drizzle ORM has encrypted column types that handle encryption
 * automatically. This service is used for:
 * - Operations outside the ORM (migrations, CLI)
 * - Backward compatibility with pre-encryption data
 * - Explicit encryption/decryption control
 *
 * ## Usage
 *
 * ```typescript
 * const sensitiveService = createSensitiveDataService(db, users);
 *
 * // Get decrypted Claude auth
 * const claudeAuth = await sensitiveService.getClaudeAuth(userId);
 * if (claudeAuth) {
 *   await callClaudeAPI(claudeAuth.accessToken);
 * }
 *
 * // Update with automatic encryption
 * await sensitiveService.updateClaudeAuth(userId, {
 *   accessToken: 'new-token',
 *   refreshToken: 'new-refresh',
 * });
 * ```
 *
 * ## Security Considerations
 *
 * - Never log decrypted values
 * - Always use service methods rather than direct DB access
 * - Rotate encryption key periodically (requires re-encryption)
 * - Audit access to sensitive fields
 */
export interface ISensitiveDataServiceDocumentation {
  /**
   * Get a user with all sensitive fields decrypted.
   *
   * Fetches the user record and decrypts all sensitive fields.
   * Use this when you need access to multiple credentials at once.
   *
   * @param userId - The user ID to fetch
   * @returns User with decrypted fields, or null if not found
   *
   * @example
   * ```typescript
   * const user = await sensitiveService.getUserWithDecryptedFields(userId);
   *
   * if (user?.claudeAuth) {
   *   // Use Claude credentials
   *   await initClaudeClient(user.claudeAuth);
   * }
   *
   * if (user?.githubAccessToken) {
   *   // Use GitHub token
   *   await initGitHubClient(user.githubAccessToken);
   * }
   * ```
   */
  getUserWithDecryptedFields(userId: string): Promise<User | null>;

  /**
   * Update multiple sensitive fields at once.
   *
   * Encrypts all provided fields and updates them in a single
   * database operation.
   *
   * @param userId - The user ID to update
   * @param fields - Partial set of sensitive fields to update
   *
   * @example
   * ```typescript
   * // Update multiple auth providers
   * await sensitiveService.updateSensitiveFields(userId, {
   *   claudeAuth: { accessToken: 'claude-token', refreshToken: 'claude-refresh' },
   *   geminiAuth: { accessToken: 'gemini-token', refreshToken: 'gemini-refresh' },
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Clear specific fields
   * await sensitiveService.updateSensitiveFields(userId, {
   *   codexAuth: null,
   *   openrouterApiKey: null,
   * });
   * ```
   */
  updateSensitiveFields(
    userId: string,
    fields: Partial<SensitiveUserFields>
  ): Promise<void>;

  /**
   * Get decrypted Claude authentication for a user.
   *
   * @param userId - The user ID to fetch Claude auth for
   * @returns Decrypted Claude auth data, or null if not set
   *
   * @example
   * ```typescript
   * const claudeAuth = await sensitiveService.getClaudeAuth(userId);
   *
   * if (!claudeAuth) {
   *   return res.redirect('/auth/claude');
   * }
   *
   * // Check if token needs refresh
   * if (claudeAuth.expiresAt && claudeAuth.expiresAt < Date.now()) {
   *   const refreshed = await refreshClaudeToken(claudeAuth.refreshToken);
   *   await sensitiveService.updateClaudeAuth(userId, refreshed);
   * }
   * ```
   */
  getClaudeAuth(userId: string): Promise<ClaudeAuthData | null>;

  /**
   * Update Claude authentication for a user.
   *
   * @param userId - The user ID to update
   * @param claudeAuth - New Claude auth data (or null to clear)
   *
   * @example
   * ```typescript
   * // Save new OAuth tokens from callback
   * await sensitiveService.updateClaudeAuth(userId, {
   *   accessToken: tokens.access_token,
   *   refreshToken: tokens.refresh_token,
   *   expiresAt: Date.now() + tokens.expires_in * 1000,
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Disconnect Claude
   * await sensitiveService.updateClaudeAuth(userId, null);
   * ```
   */
  updateClaudeAuth(userId: string, claudeAuth: ClaudeAuthData | null): Promise<void>;

  /**
   * Get decrypted Codex/OpenAI authentication for a user.
   *
   * @param userId - The user ID to fetch Codex auth for
   * @returns Decrypted Codex auth data, or null if not set
   *
   * @example
   * ```typescript
   * const codexAuth = await sensitiveService.getCodexAuth(userId);
   *
   * if (codexAuth?.apiKey) {
   *   openai = new OpenAI({ apiKey: codexAuth.apiKey });
   * }
   * ```
   */
  getCodexAuth(userId: string): Promise<CodexAuthData | null>;

  /**
   * Update Codex/OpenAI authentication for a user.
   *
   * @param userId - The user ID to update
   * @param codexAuth - New Codex auth data (or null to clear)
   *
   * @example
   * ```typescript
   * // Save API key from settings form
   * await sensitiveService.updateCodexAuth(userId, {
   *   apiKey: req.body.openaiApiKey,
   * });
   * ```
   */
  updateCodexAuth(userId: string, codexAuth: CodexAuthData | null): Promise<void>;

  /**
   * Get decrypted Gemini authentication for a user.
   *
   * @param userId - The user ID to fetch Gemini auth for
   * @returns Decrypted Gemini auth data, or null if not set
   *
   * @example
   * ```typescript
   * const geminiAuth = await sensitiveService.getGeminiAuth(userId);
   *
   * if (geminiAuth) {
   *   const client = new GeminiClient(geminiAuth.accessToken);
   * }
   * ```
   */
  getGeminiAuth(userId: string): Promise<GeminiAuthData | null>;

  /**
   * Update Gemini authentication for a user.
   *
   * @param userId - The user ID to update
   * @param geminiAuth - New Gemini auth data (or null to clear)
   *
   * @example
   * ```typescript
   * await sensitiveService.updateGeminiAuth(userId, {
   *   accessToken: tokens.access_token,
   *   refreshToken: tokens.refresh_token,
   *   expiresAt: Date.now() + tokens.expires_in * 1000,
   * });
   * ```
   */
  updateGeminiAuth(userId: string, geminiAuth: GeminiAuthData | null): Promise<void>;

  /**
   * Get decrypted GitHub access token for a user.
   *
   * @param userId - The user ID to fetch GitHub token for
   * @returns Decrypted GitHub access token, or null if not set
   *
   * @example
   * ```typescript
   * const githubToken = await sensitiveService.getGitHubAccessToken(userId);
   *
   * if (githubToken) {
   *   const octokit = new Octokit({ auth: githubToken });
   *   const repos = await octokit.repos.listForAuthenticatedUser();
   * }
   * ```
   */
  getGitHubAccessToken(userId: string): Promise<string | null>;

  /**
   * Update GitHub access token for a user.
   *
   * @param userId - The user ID to update
   * @param token - New GitHub access token (or null to clear)
   *
   * @example
   * ```typescript
   * // Save token from OAuth callback
   * await sensitiveService.updateGitHubAccessToken(userId, accessToken);
   * ```
   *
   * @example
   * ```typescript
   * // Revoke GitHub access
   * await sensitiveService.updateGitHubAccessToken(userId, null);
   * ```
   */
  updateGitHubAccessToken(userId: string, token: string | null): Promise<void>;

  /**
   * Get decrypted OpenRouter API key for a user.
   *
   * @param userId - The user ID to fetch OpenRouter key for
   * @returns Decrypted OpenRouter API key, or null if not set
   *
   * @example
   * ```typescript
   * const apiKey = await sensitiveService.getOpenRouterApiKey(userId);
   *
   * if (apiKey) {
   *   const response = await fetch('https://openrouter.ai/api/v1/chat', {
   *     headers: { 'Authorization': `Bearer ${apiKey}` },
   *   });
   * }
   * ```
   */
  getOpenRouterApiKey(userId: string): Promise<string | null>;

  /**
   * Update OpenRouter API key for a user.
   *
   * @param userId - The user ID to update
   * @param apiKey - New OpenRouter API key (or null to clear)
   *
   * @example
   * ```typescript
   * await sensitiveService.updateOpenRouterApiKey(userId, 'sk-or-...');
   * ```
   */
  updateOpenRouterApiKey(userId: string, apiKey: string | null): Promise<void>;

  /**
   * Get decrypted image AI provider keys for a user.
   *
   * @param userId - The user ID to fetch image AI keys for
   * @returns Decrypted image AI keys, or null if not set
   *
   * @example
   * ```typescript
   * const keys = await sensitiveService.getImageAiKeys(userId);
   *
   * if (keys?.openai) {
   *   // Use DALL-E
   *   await generateWithDallE(keys.openai, prompt);
   * } else if (keys?.stability) {
   *   // Fall back to Stability AI
   *   await generateWithStability(keys.stability, prompt);
   * }
   * ```
   */
  getImageAiKeys(userId: string): Promise<ImageAiKeysData | null>;

  /**
   * Update image AI provider keys for a user.
   *
   * @param userId - The user ID to update
   * @param keys - New image AI keys (or null to clear all)
   *
   * @example
   * ```typescript
   * // Set multiple provider keys
   * await sensitiveService.updateImageAiKeys(userId, {
   *   openai: 'sk-...',
   *   stability: 'sk-...',
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Update single provider (merge with existing)
   * const existing = await sensitiveService.getImageAiKeys(userId);
   * await sensitiveService.updateImageAiKeys(userId, {
   *   ...existing,
   *   openai: 'new-key',
   * });
   * ```
   */
  updateImageAiKeys(userId: string, keys: ImageAiKeysData | null): Promise<void>;
}

/**
 * Encrypt sensitive user fields for database storage.
 *
 * Takes plaintext sensitive fields and returns encrypted versions
 * suitable for database storage. Uses AES-256-GCM encryption when
 * encryption is enabled.
 *
 * @param fields - Partial set of sensitive fields to encrypt
 * @returns Encrypted field values for database storage
 *
 * @example
 * ```typescript
 * const encrypted = encryptUserFields({
 *   githubAccessToken: 'gho_abc123',
 *   claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
 * });
 *
 * await db.update(users).set(encrypted).where(eq(users.id, userId));
 * ```
 */
export function encryptUserFields(
  fields: Partial<SensitiveUserFields>
): Partial<EncryptedUserFields>;

/**
 * Decrypt sensitive user fields from database.
 *
 * Takes a user record (or partial) and returns decrypted sensitive
 * field values. Handles both encrypted and plaintext values for
 * backward compatibility.
 *
 * @param user - User record with potentially encrypted fields
 * @returns Decrypted sensitive field values
 *
 * @example
 * ```typescript
 * const [user] = await db.select().from(users).where(eq(users.id, userId));
 * const sensitive = decryptUserFields(user);
 *
 * console.log(sensitive.claudeAuth?.accessToken);
 * ```
 */
export function decryptUserFields(user: Partial<User>): Partial<SensitiveUserFields>;

/**
 * Decrypt a full user object.
 *
 * Returns a new user object with all sensitive fields decrypted.
 * Does not modify the original object.
 *
 * @param user - User record with potentially encrypted fields
 * @returns New user object with decrypted sensitive fields
 *
 * @example
 * ```typescript
 * const [encryptedUser] = await db.select().from(users).where(eq(users.id, userId));
 * const user = decryptUser(encryptedUser);
 *
 * // All sensitive fields are now accessible
 * console.log(user.githubAccessToken);
 * console.log(user.claudeAuth?.accessToken);
 * ```
 */
export function decryptUser<T extends Partial<User>>(user: T): T;

/**
 * Check if a user record has any encrypted fields.
 *
 * Detects the `enc:` prefix on string values to determine if
 * encryption was applied.
 *
 * @param user - User record to check
 * @returns True if any sensitive field is encrypted
 *
 * @example
 * ```typescript
 * if (hasEncryptedFields(user)) {
 *   console.log('User data is encrypted at rest');
 * } else {
 *   console.warn('User data may be stored in plaintext');
 * }
 * ```
 */
export function hasEncryptedFields(user: Partial<User>): boolean;

/**
 * Check if a user record has unencrypted sensitive data.
 *
 * Useful for migration status checking. Returns true if any
 * sensitive field contains plaintext data.
 *
 * @param user - User record to check
 * @returns True if any sensitive field is unencrypted
 *
 * @example
 * ```typescript
 * // Migration script
 * const users = await db.select().from(usersTable);
 *
 * const needsEncryption = users.filter(hasUnencryptedSensitiveData);
 * console.log(`${needsEncryption.length} users need encryption`);
 *
 * for (const user of needsEncryption) {
 *   await migrateUserEncryption(user);
 * }
 * ```
 */
export function hasUnencryptedSensitiveData(user: Partial<User>): boolean;

/**
 * Create a SensitiveDataService instance.
 *
 * Factory function to create a service instance with the provided
 * database connection and users table reference.
 *
 * @param db - Database connection (NodePgDatabase)
 * @param users - Users table schema reference
 * @returns Configured SensitiveDataService instance
 *
 * @example
 * ```typescript
 * import { db, users } from '../db/index.js';
 *
 * const sensitiveService = createSensitiveDataService(db, users);
 *
 * // Use in route handler
 * app.get('/api/user/tokens', async (req, res) => {
 *   const user = await sensitiveService.getUserWithDecryptedFields(req.userId);
 *   res.json({
 *     hasGitHub: !!user?.githubAccessToken,
 *     hasClaude: !!user?.claudeAuth,
 *     hasGemini: !!user?.geminiAuth,
 *   });
 * });
 * ```
 */
export function createSensitiveDataService(
  db: unknown,
  users: unknown
): ISensitiveDataServiceDocumentation;
