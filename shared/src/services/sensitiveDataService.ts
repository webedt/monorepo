/**
 * Sensitive Data Service
 *
 * Provides centralized encryption/decryption for sensitive user data stored in the database.
 * Handles the following fields in the users table:
 * - githubAccessToken (text)
 * - claudeAuth (JSON with accessToken, refreshToken)
 * - codexAuth (JSON with apiKey, accessToken, refreshToken)
 * - geminiAuth (JSON with accessToken, refreshToken)
 * - openrouterApiKey (text)
 * - imageAiKeys (JSON with provider API keys)
 */

import { eq } from 'drizzle-orm';

import type { User } from '../db/schema.js';

import { safeDecrypt, safeDecryptJson, safeEncrypt, safeEncryptJson, isEncryptionEnabled, isEncrypted } from '../utils/encryption.js';
import { logger } from '../utils/logging/logger.js';

/**
 * Claude authentication data structure
 */
export interface ClaudeAuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Codex authentication data structure
 */
export interface CodexAuthData {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Gemini authentication data structure
 */
export interface GeminiAuthData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

/**
 * Image AI keys data structure
 */
export interface ImageAiKeysData {
  openrouter?: string;
  cometapi?: string;
  google?: string;
}

/**
 * Sensitive fields in the user record
 */
export interface SensitiveUserFields {
  githubAccessToken: string | null;
  claudeAuth: ClaudeAuthData | null;
  codexAuth: CodexAuthData | null;
  geminiAuth: GeminiAuthData | null;
  openrouterApiKey: string | null;
  imageAiKeys: ImageAiKeysData | null;
}

/**
 * Encrypted representation of sensitive user fields (for database storage)
 */
export interface EncryptedUserFields {
  githubAccessToken: string | null;
  claudeAuth: unknown; // JSON column - will be encrypted string when encryption is enabled
  codexAuth: unknown;
  geminiAuth: unknown;
  openrouterApiKey: string | null;
  imageAiKeys: unknown;
}

/**
 * Encrypt sensitive user fields for database storage
 */
export function encryptUserFields(fields: Partial<SensitiveUserFields>): Partial<EncryptedUserFields> {
  const encrypted: Partial<EncryptedUserFields> = {};

  if (fields.githubAccessToken !== undefined) {
    encrypted.githubAccessToken = safeEncrypt(fields.githubAccessToken);
  }

  if (fields.claudeAuth !== undefined) {
    if (fields.claudeAuth === null) {
      encrypted.claudeAuth = null;
    } else if (isEncryptionEnabled()) {
      encrypted.claudeAuth = safeEncryptJson(fields.claudeAuth);
    } else {
      encrypted.claudeAuth = fields.claudeAuth;
    }
  }

  if (fields.codexAuth !== undefined) {
    if (fields.codexAuth === null) {
      encrypted.codexAuth = null;
    } else if (isEncryptionEnabled()) {
      encrypted.codexAuth = safeEncryptJson(fields.codexAuth);
    } else {
      encrypted.codexAuth = fields.codexAuth;
    }
  }

  if (fields.geminiAuth !== undefined) {
    if (fields.geminiAuth === null) {
      encrypted.geminiAuth = null;
    } else if (isEncryptionEnabled()) {
      encrypted.geminiAuth = safeEncryptJson(fields.geminiAuth);
    } else {
      encrypted.geminiAuth = fields.geminiAuth;
    }
  }

  if (fields.openrouterApiKey !== undefined) {
    encrypted.openrouterApiKey = safeEncrypt(fields.openrouterApiKey);
  }

  if (fields.imageAiKeys !== undefined) {
    if (fields.imageAiKeys === null) {
      encrypted.imageAiKeys = null;
    } else if (isEncryptionEnabled()) {
      encrypted.imageAiKeys = safeEncryptJson(fields.imageAiKeys);
    } else {
      encrypted.imageAiKeys = fields.imageAiKeys;
    }
  }

  return encrypted;
}

/**
 * Decrypt sensitive user fields from database
 */
export function decryptUserFields(user: Partial<User>): Partial<SensitiveUserFields> {
  const decrypted: Partial<SensitiveUserFields> = {};

  if (user.githubAccessToken !== undefined) {
    decrypted.githubAccessToken = safeDecrypt(user.githubAccessToken);
  }

  if (user.claudeAuth !== undefined) {
    if (user.claudeAuth === null) {
      decrypted.claudeAuth = null;
    } else if (typeof user.claudeAuth === 'string' && isEncrypted(user.claudeAuth)) {
      decrypted.claudeAuth = safeDecryptJson<ClaudeAuthData>(user.claudeAuth);
    } else {
      decrypted.claudeAuth = user.claudeAuth as ClaudeAuthData;
    }
  }

  if (user.codexAuth !== undefined) {
    if (user.codexAuth === null) {
      decrypted.codexAuth = null;
    } else if (typeof user.codexAuth === 'string' && isEncrypted(user.codexAuth)) {
      decrypted.codexAuth = safeDecryptJson<CodexAuthData>(user.codexAuth);
    } else {
      decrypted.codexAuth = user.codexAuth as CodexAuthData;
    }
  }

  if (user.geminiAuth !== undefined) {
    if (user.geminiAuth === null) {
      decrypted.geminiAuth = null;
    } else if (typeof user.geminiAuth === 'string' && isEncrypted(user.geminiAuth)) {
      decrypted.geminiAuth = safeDecryptJson<GeminiAuthData>(user.geminiAuth);
    } else {
      decrypted.geminiAuth = user.geminiAuth as GeminiAuthData;
    }
  }

  if (user.openrouterApiKey !== undefined) {
    decrypted.openrouterApiKey = safeDecrypt(user.openrouterApiKey);
  }

  if (user.imageAiKeys !== undefined) {
    if (user.imageAiKeys === null) {
      decrypted.imageAiKeys = null;
    } else if (typeof user.imageAiKeys === 'string' && isEncrypted(user.imageAiKeys)) {
      decrypted.imageAiKeys = safeDecryptJson<ImageAiKeysData>(user.imageAiKeys);
    } else {
      decrypted.imageAiKeys = user.imageAiKeys as ImageAiKeysData;
    }
  }

  return decrypted;
}

/**
 * Decrypt a full user object, returning a new object with decrypted sensitive fields
 */
export function decryptUser<T extends Partial<User>>(user: T): T {
  if (!user) return user;

  const sensitiveFields = decryptUserFields(user);

  return {
    ...user,
    ...sensitiveFields,
  };
}

/**
 * Check if a user record has any encrypted fields
 */
export function hasEncryptedFields(user: Partial<User>): boolean {
  if (user.githubAccessToken && isEncrypted(user.githubAccessToken)) {
    return true;
  }
  if (user.claudeAuth && typeof user.claudeAuth === 'string' && isEncrypted(user.claudeAuth)) {
    return true;
  }
  if (user.codexAuth && typeof user.codexAuth === 'string' && isEncrypted(user.codexAuth)) {
    return true;
  }
  if (user.geminiAuth && typeof user.geminiAuth === 'string' && isEncrypted(user.geminiAuth)) {
    return true;
  }
  if (user.openrouterApiKey && isEncrypted(user.openrouterApiKey)) {
    return true;
  }
  if (user.imageAiKeys && typeof user.imageAiKeys === 'string' && isEncrypted(user.imageAiKeys)) {
    return true;
  }
  return false;
}

/**
 * Check if a user record has any unencrypted sensitive data
 * (useful for migration status checking)
 */
export function hasUnencryptedSensitiveData(user: Partial<User>): boolean {
  if (user.githubAccessToken && !isEncrypted(user.githubAccessToken)) {
    return true;
  }
  if (user.claudeAuth && typeof user.claudeAuth === 'object') {
    return true;
  }
  if (user.codexAuth && typeof user.codexAuth === 'object') {
    return true;
  }
  if (user.geminiAuth && typeof user.geminiAuth === 'object') {
    return true;
  }
  if (user.openrouterApiKey && !isEncrypted(user.openrouterApiKey)) {
    return true;
  }
  if (user.imageAiKeys && typeof user.imageAiKeys === 'object') {
    return true;
  }
  return false;
}

/**
 * Database operations for sensitive user data
 */
export class SensitiveDataService {
  private db: any;
  private usersTable: any;

  constructor(db: any, usersTable: any) {
    this.db = db;
    this.usersTable = usersTable;
  }

  /**
   * Get a user with decrypted sensitive fields
   */
  async getUserWithDecryptedFields(userId: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user) return null;

    return decryptUser(user);
  }

  /**
   * Update sensitive fields for a user (encrypts before storage)
   */
  async updateSensitiveFields(
    userId: string,
    fields: Partial<SensitiveUserFields>
  ): Promise<void> {
    const encrypted = encryptUserFields(fields);

    await this.db
      .update(this.usersTable)
      .set(encrypted)
      .where(eq(this.usersTable.id, userId));

    logger.debug('Updated sensitive fields for user', {
      component: 'SensitiveDataService',
      userId,
      fields: Object.keys(fields),
      encrypted: isEncryptionEnabled(),
    });
  }

  /**
   * Get Claude auth for a user (decrypted)
   */
  async getClaudeAuth(userId: string): Promise<ClaudeAuthData | null> {
    const [user] = await this.db
      .select({ claudeAuth: this.usersTable.claudeAuth })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.claudeAuth) return null;

    const decrypted = decryptUserFields({ claudeAuth: user.claudeAuth });
    return decrypted.claudeAuth || null;
  }

  /**
   * Update Claude auth for a user
   */
  async updateClaudeAuth(userId: string, claudeAuth: ClaudeAuthData | null): Promise<void> {
    await this.updateSensitiveFields(userId, { claudeAuth });
  }

  /**
   * Get Codex auth for a user (decrypted)
   */
  async getCodexAuth(userId: string): Promise<CodexAuthData | null> {
    const [user] = await this.db
      .select({ codexAuth: this.usersTable.codexAuth })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.codexAuth) return null;

    const decrypted = decryptUserFields({ codexAuth: user.codexAuth });
    return decrypted.codexAuth || null;
  }

  /**
   * Update Codex auth for a user
   */
  async updateCodexAuth(userId: string, codexAuth: CodexAuthData | null): Promise<void> {
    await this.updateSensitiveFields(userId, { codexAuth });
  }

  /**
   * Get Gemini auth for a user (decrypted)
   */
  async getGeminiAuth(userId: string): Promise<GeminiAuthData | null> {
    const [user] = await this.db
      .select({ geminiAuth: this.usersTable.geminiAuth })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.geminiAuth) return null;

    const decrypted = decryptUserFields({ geminiAuth: user.geminiAuth });
    return decrypted.geminiAuth || null;
  }

  /**
   * Update Gemini auth for a user
   */
  async updateGeminiAuth(userId: string, geminiAuth: GeminiAuthData | null): Promise<void> {
    await this.updateSensitiveFields(userId, { geminiAuth });
  }

  /**
   * Get GitHub access token for a user (decrypted)
   */
  async getGitHubAccessToken(userId: string): Promise<string | null> {
    const [user] = await this.db
      .select({ githubAccessToken: this.usersTable.githubAccessToken })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.githubAccessToken) return null;

    return safeDecrypt(user.githubAccessToken);
  }

  /**
   * Update GitHub access token for a user
   */
  async updateGitHubAccessToken(userId: string, token: string | null): Promise<void> {
    await this.updateSensitiveFields(userId, { githubAccessToken: token });
  }

  /**
   * Get OpenRouter API key for a user (decrypted)
   */
  async getOpenRouterApiKey(userId: string): Promise<string | null> {
    const [user] = await this.db
      .select({ openrouterApiKey: this.usersTable.openrouterApiKey })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.openrouterApiKey) return null;

    return safeDecrypt(user.openrouterApiKey);
  }

  /**
   * Update OpenRouter API key for a user
   */
  async updateOpenRouterApiKey(userId: string, apiKey: string | null): Promise<void> {
    await this.updateSensitiveFields(userId, { openrouterApiKey: apiKey });
  }

  /**
   * Get image AI keys for a user (decrypted)
   */
  async getImageAiKeys(userId: string): Promise<ImageAiKeysData | null> {
    const [user] = await this.db
      .select({ imageAiKeys: this.usersTable.imageAiKeys })
      .from(this.usersTable)
      .where(eq(this.usersTable.id, userId))
      .limit(1);

    if (!user?.imageAiKeys) return null;

    const decrypted = decryptUserFields({ imageAiKeys: user.imageAiKeys });
    return decrypted.imageAiKeys || null;
  }

  /**
   * Update image AI keys for a user
   */
  async updateImageAiKeys(userId: string, keys: ImageAiKeysData | null): Promise<void> {
    await this.updateSensitiveFields(userId, { imageAiKeys: keys });
  }
}

/**
 * Create a SensitiveDataService instance
 */
export function createSensitiveDataService(db: any, usersTable: any): SensitiveDataService {
  return new SensitiveDataService(db, usersTable);
}
