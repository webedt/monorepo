import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/**
 * Secure Credential Manager
 *
 * Addresses security vulnerabilities in credential handling:
 * - Creates secure temporary directories with restricted permissions (700)
 * - Uses environment variables exclusively for production credentials
 * - Prevents credentials from being visible in process lists or logs
 * - Supports credential rotation without restart
 * - Encrypts sensitive data at rest
 */
export class SecureCredentialManager {
  private static encryptionKey: Buffer | null = null;
  private static credentialCache: Map<string, { value: string; expiresAt: number }> = new Map();
  private static rotationCallbacks: Map<string, (newCredential: string) => void> = new Map();

  /**
   * Initialize encryption key from environment or generate a session key
   * This key is used for encrypting credentials at rest
   */
  private static getEncryptionKey(): Buffer {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Try to get key from environment (for production)
    const envKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (envKey) {
      // Hash the key to ensure it's the right length (32 bytes for AES-256)
      this.encryptionKey = crypto.createHash('sha256').update(envKey).digest();
    } else {
      // Generate a session-specific key (credentials won't survive restart)
      this.encryptionKey = crypto.randomBytes(32);
    }

    return this.encryptionKey;
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  static encrypt(plaintext: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Return IV + AuthTag + Encrypted data (all hex encoded)
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  static decrypt(ciphertext: string): string {
    const key = this.getEncryptionKey();
    const parts = ciphertext.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Create a secure temporary directory with restricted permissions (700)
   * Uses cryptographically random names to prevent predictability
   */
  static createSecureTempDir(prefix: string = 'secure-'): string {
    const randomSuffix = crypto.randomBytes(16).toString('hex');
    const tempDir = path.join(os.tmpdir(), `${prefix}${randomSuffix}`);

    // Create directory with secure permissions (owner only: rwx)
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });

    // Double-check and enforce permissions (some systems may not respect mode in mkdirSync)
    fs.chmodSync(tempDir, 0o700);

    return tempDir;
  }

  /**
   * Create a secure session directory for credential isolation
   * Each session gets its own directory with unique credentials
   */
  static createSecureSessionDir(sessionId: string): string {
    const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const sessionDir = path.join(os.tmpdir(), `session-${sanitizedSessionId}-${randomSuffix}`);

    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(sessionDir, 0o700);

    return sessionDir;
  }

  /**
   * Write credentials to a file with secure permissions
   * Encrypts the credentials before writing
   */
  static writeSecureCredentialFile(credentialPath: string, credentials: any, encrypt: boolean = true): void {
    try {
      // Ensure directory exists with secure permissions
      const dir = path.dirname(credentialPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      }
      // Ensure directory has correct permissions
      fs.chmodSync(dir, 0o700);

      // Prepare content
      let content: string;
      if (encrypt) {
        const jsonContent = JSON.stringify(credentials);
        content = this.encrypt(jsonContent);
      } else {
        content = JSON.stringify(credentials, null, 2);
      }

      // Write file atomically (write to temp file, then rename)
      const tempPath = `${credentialPath}.tmp.${crypto.randomBytes(8).toString('hex')}`;
      fs.writeFileSync(tempPath, content, { mode: 0o600 });
      fs.renameSync(tempPath, credentialPath);

      // Ensure file has correct permissions
      fs.chmodSync(credentialPath, 0o600);

      // Redact credential info from logs
      console.log(`[SecureCredentialManager] Credentials written to: ${this.redactPath(credentialPath)}`);
    } catch (error) {
      throw new Error(
        `Failed to write credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Read credentials from a file
   * Decrypts if the file was encrypted
   */
  static readSecureCredentialFile(credentialPath: string): any {
    try {
      if (!fs.existsSync(credentialPath)) {
        throw new Error('Credential file not found');
      }

      const content = fs.readFileSync(credentialPath, 'utf8');

      // Try to parse as JSON first (unencrypted)
      try {
        return JSON.parse(content);
      } catch {
        // If JSON parse fails, try to decrypt
        const decrypted = this.decrypt(content);
        return JSON.parse(decrypted);
      }
    } catch (error) {
      throw new Error(
        `Failed to read credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Securely delete a credential file by overwriting before deletion
   */
  static secureDeleteCredentialFile(credentialPath: string): void {
    try {
      if (!fs.existsSync(credentialPath)) {
        return;
      }

      const stats = fs.statSync(credentialPath);
      const size = stats.size;

      // Overwrite with random data 3 times
      for (let i = 0; i < 3; i++) {
        const randomData = crypto.randomBytes(size);
        fs.writeFileSync(credentialPath, randomData);
        fs.fdatasyncSync(fs.openSync(credentialPath, 'r+'));
      }

      // Finally delete the file
      fs.unlinkSync(credentialPath);
      console.log(`[SecureCredentialManager] Securely deleted: ${this.redactPath(credentialPath)}`);
    } catch (error) {
      // If secure delete fails, try regular delete
      try {
        fs.unlinkSync(credentialPath);
      } catch {
        // Ignore errors on cleanup
      }
    }
  }

  /**
   * Securely delete a directory and all its contents
   */
  static secureDeleteDirectory(dirPath: string): void {
    try {
      if (!fs.existsSync(dirPath)) {
        return;
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          this.secureDeleteDirectory(fullPath);
        } else {
          this.secureDeleteCredentialFile(fullPath);
        }
      }

      fs.rmdirSync(dirPath);
      console.log(`[SecureCredentialManager] Securely deleted directory: ${this.redactPath(dirPath)}`);
    } catch (error) {
      // Try regular delete as fallback
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch {
        // Ignore errors on cleanup
      }
    }
  }

  /**
   * Validate that a configuration object does not contain embedded credentials
   */
  static validateNoEmbeddedCredentials(config: any, configPath: string = 'config'): string[] {
    const issues: string[] = [];
    const sensitivePatterns = [
      { pattern: /^(sk-|ghp_|gho_|github_pat_)/i, name: 'API key' },
      { pattern: /^(Bearer\s+|Basic\s+)/i, name: 'Authorization header' },
      { pattern: /password|passwd|secret|token|apikey|api_key|access_token|refresh_token/i, name: 'credential field' },
    ];

    const checkValue = (value: any, path: string) => {
      if (typeof value === 'string') {
        for (const { pattern, name } of sensitivePatterns) {
          if (pattern.test(value)) {
            // Check if it looks like an actual credential (not a field name)
            if (value.length > 20 || value.includes('-') || /^[a-zA-Z0-9+/=]{20,}$/.test(value)) {
              issues.push(`${path}: Potential ${name} detected. Use environment variables instead.`);
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        for (const [key, val] of Object.entries(value)) {
          // Flag if the key suggests credentials
          if (/password|secret|token|apikey|api_key|credential/i.test(key)) {
            if (typeof val === 'string' && val.length > 0 && !val.startsWith('${')) {
              issues.push(`${path}.${key}: Credential field should use environment variables.`);
            }
          }
          checkValue(val, `${path}.${key}`);
        }
      }
    };

    checkValue(config, configPath);
    return issues;
  }

  /**
   * Get credential from environment variable with validation
   */
  static getCredentialFromEnv(envVarName: string, required: boolean = true): string | undefined {
    const value = process.env[envVarName];

    if (required && !value) {
      throw new Error(`Required environment variable ${envVarName} is not set`);
    }

    return value;
  }

  /**
   * Set credential in environment variable (for child processes)
   * Uses a secure approach that doesn't expose the full value in logs
   */
  static setCredentialEnv(envVarName: string, value: string): void {
    process.env[envVarName] = value;
    console.log(`[SecureCredentialManager] Set environment variable: ${envVarName} (${this.redactValue(value)})`);
  }

  /**
   * Clear credential from environment variable
   */
  static clearCredentialEnv(envVarName: string): void {
    delete process.env[envVarName];
    console.log(`[SecureCredentialManager] Cleared environment variable: ${envVarName}`);
  }

  /**
   * Register a callback for credential rotation
   */
  static onCredentialRotation(credentialType: string, callback: (newCredential: string) => void): void {
    this.rotationCallbacks.set(credentialType, callback);
  }

  /**
   * Rotate a credential and notify all registered callbacks
   */
  static rotateCredential(credentialType: string, newCredential: string): void {
    // Update cache
    this.credentialCache.set(credentialType, {
      value: newCredential,
      expiresAt: Date.now() + 3600000 // 1 hour default TTL
    });

    // Notify callback
    const callback = this.rotationCallbacks.get(credentialType);
    if (callback) {
      callback(newCredential);
    }

    console.log(`[SecureCredentialManager] Credential rotated: ${credentialType}`);
  }

  /**
   * Cache a credential with optional TTL
   */
  static cacheCredential(key: string, value: string, ttlMs: number = 3600000): void {
    this.credentialCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  /**
   * Get cached credential (returns undefined if expired or not found)
   */
  static getCachedCredential(key: string): string | undefined {
    const cached = this.credentialCache.get(key);
    if (!cached) {
      return undefined;
    }

    if (Date.now() > cached.expiresAt) {
      this.credentialCache.delete(key);
      return undefined;
    }

    return cached.value;
  }

  /**
   * Clear all cached credentials
   */
  static clearCredentialCache(): void {
    this.credentialCache.clear();
    console.log('[SecureCredentialManager] Credential cache cleared');
  }

  /**
   * Redact a value for logging (show only first/last few characters)
   */
  static redactValue(value: string): string {
    if (!value || value.length < 8) {
      return '***';
    }
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  }

  /**
   * Redact a path for logging (hide home directory and session-specific parts)
   */
  static redactPath(filePath: string): string {
    const home = os.homedir();
    let redacted = filePath.replace(home, '~');
    // Redact session IDs in paths
    redacted = redacted.replace(/session-[a-zA-Z0-9_-]+/g, 'session-***');
    return redacted;
  }

  /**
   * Create a git credential helper configuration that doesn't embed tokens in URLs
   * Instead of using https://token@github.com, configure git to use credential helper
   */
  static configureGitCredentialHelper(workspacePath: string, token: string): void {
    const gitConfigPath = path.join(workspacePath, '.git', 'config');

    // Only proceed if this is a git repository
    if (!fs.existsSync(path.join(workspacePath, '.git'))) {
      return;
    }

    try {
      // Set up credential helper to use store with a secure file
      const credentialStorePath = path.join(os.tmpdir(), `git-credentials-${crypto.randomBytes(8).toString('hex')}`);

      // Write credentials to the store file
      const credentialEntry = `https://oauth2:${token}@github.com\n`;
      fs.writeFileSync(credentialStorePath, credentialEntry, { mode: 0o600 });

      // Configure git to use this credential store
      const { execSync } = require('child_process');
      execSync(`git config credential.helper 'store --file=${credentialStorePath}'`, {
        cwd: workspacePath,
        stdio: 'pipe'
      });

      console.log('[SecureCredentialManager] Git credential helper configured');
    } catch (error) {
      console.warn('[SecureCredentialManager] Failed to configure git credential helper:',
        error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Validate that a URL does not contain embedded credentials
   */
  static validateUrlNoCredentials(url: string): boolean {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) {
        return false;
      }
      return true;
    } catch {
      return true; // If it's not a valid URL, we can't check for credentials
    }
  }

  /**
   * Sanitize a URL by removing any embedded credentials
   */
  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Verify file permissions are secure (readable only by owner)
   */
  static verifySecurePermissions(filePath: string): boolean {
    try {
      const stats = fs.statSync(filePath);
      const mode = stats.mode;

      // Check that group and others have no permissions (mode & 0o077 should be 0)
      return (mode & 0o077) === 0;
    } catch {
      return false;
    }
  }

  /**
   * Enforce secure permissions on a file or directory
   */
  static enforceSecurePermissions(filePath: string, isDirectory: boolean = false): void {
    const mode = isDirectory ? 0o700 : 0o600;
    fs.chmodSync(filePath, mode);
  }
}
