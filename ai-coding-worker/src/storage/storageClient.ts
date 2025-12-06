import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as https from 'https';
import * as http from 'http';
import { logger } from '../utils/logger';
import { SessionMetadata, SSEEvent } from '../types';

/**
 * Storage client for communicating with main-server storage endpoints
 * (Previously communicated with storage-worker, now consolidated into main-server)
 */
export class StorageClient {
  private baseUrl: string;
  private timeout: number;
  private enabled: boolean;

  constructor() {
    // Default to main-server URL if STORAGE_WORKER_URL is not set
    // Note: storage endpoints are now served by main-server at /api/storage-worker/*
    const storageUrl = process.env.STORAGE_WORKER_URL || 'http://main-server:3000';
    this.enabled = true;
    this.baseUrl = storageUrl.replace(/\/$/, '');
    this.timeout = parseInt(process.env.STORAGE_WORKER_TIMEOUT || '60000', 10);

    logger.info('Storage worker client initialized', {
      component: 'StorageClient',
      baseUrl: this.baseUrl
    });
  }

  /**
   * Initialize storage (no-op for client, server handles bucket creation)
   */
  async initialize(): Promise<void> {
    if (!this.enabled) return;
    logger.info('Storage client initialized', { component: 'StorageClient' });
  }

  /**
   * Download session from storage to local workspace
   */
  async downloadSession(sessionPath: string, localPath: string): Promise<boolean> {
    if (!this.enabled) {
      // Without storage worker, just create empty directory
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
      }
      return false;
    }

    const tarPath = `${localPath}-complete.tar.gz`;
    // Session path should not contain slashes (validated by storage-worker)
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionPath}/download`;

    try {
      logger.info('Downloading session from storage', {
        component: 'StorageClient',
        sessionPath,
        url
      });

      // Ensure destination directory exists
      const destDir = path.dirname(tarPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const downloaded = await this.downloadFile(url, tarPath);

      if (!downloaded) {
        // New session - create empty workspace
        logger.info('Session not found in storage, creating new workspace', {
          component: 'StorageClient',
          sessionPath
        });
        fs.mkdirSync(localPath, { recursive: true });
        return false;
      }

      // Extract tarball
      const tmpExtractDir = `${localPath}-extract`;
      const homeDir = process.env.HOME || '/home/worker';

      fs.mkdirSync(tmpExtractDir, { recursive: true });

      await tar.extract({
        file: tarPath,
        cwd: tmpExtractDir
      });

      // Move workspace contents to final location
      const workspaceExtractPath = path.join(tmpExtractDir, 'workspace');
      if (fs.existsSync(workspaceExtractPath)) {
        fs.mkdirSync(localPath, { recursive: true });
        await this.copyDirectory(workspaceExtractPath, localPath);
      } else {
        fs.mkdirSync(localPath, { recursive: true });
      }

      // Restore ~/.claude if it exists
      const claudeExtractPath = path.join(tmpExtractDir, '.claude');
      if (fs.existsSync(claudeExtractPath)) {
        const claudeDestPath = path.join(homeDir, '.claude');
        logger.info('Restoring ~/.claude from session backup', {
          component: 'StorageClient',
          sessionPath,
          claudeExtractPath,
          claudeDestPath
        });
        if (fs.existsSync(claudeDestPath)) {
          fs.rmSync(claudeDestPath, { recursive: true, force: true });
        }
        await this.copyDirectory(claudeExtractPath, claudeDestPath);
        logger.info('Restored ~/.claude successfully', {
          component: 'StorageClient',
          sessionPath
        });
      } else {
        logger.info('No ~/.claude found in session backup', {
          component: 'StorageClient',
          sessionPath,
          claudeExtractPath
        });
      }

      // Restore ~/.codex if it exists
      const codexExtractPath = path.join(tmpExtractDir, '.codex');
      if (fs.existsSync(codexExtractPath)) {
        const codexDestPath = path.join(homeDir, '.codex');
        if (fs.existsSync(codexDestPath)) {
          fs.rmSync(codexDestPath, { recursive: true, force: true });
        }
        await this.copyDirectory(codexExtractPath, codexDestPath);
      }

      // Cleanup
      fs.unlinkSync(tarPath);
      fs.rmSync(tmpExtractDir, { recursive: true, force: true });

      logger.info('Session downloaded successfully', {
        component: 'StorageClient',
        sessionPath,
        localPath
      });

      return true;
    } catch (err: any) {
      logger.error('Failed to download session', err, {
        component: 'StorageClient',
        sessionPath
      });
      throw err;
    }
  }

  /**
   * Upload session from local workspace to storage
   */
  async uploadSession(sessionPath: string, localPath: string): Promise<void> {
    if (!this.enabled) {
      logger.info('Storage worker disabled, skipping upload', {
        component: 'StorageClient',
        sessionPath
      });
      return;
    }

    const tarPath = `${localPath}-complete.tar.gz`;
    const homeDir = process.env.HOME || '/home/worker';
    const claudeDir = path.join(homeDir, '.claude');
    const codexDir = path.join(homeDir, '.codex');

    try {
      logger.info('Uploading session to storage', {
        component: 'StorageClient',
        sessionPath,
        localPath
      });

      // Create temporary package directory
      const tmpPackageDir = `${localPath}-package`;
      fs.mkdirSync(tmpPackageDir, { recursive: true });

      // Copy workspace
      const workspaceDestDir = path.join(tmpPackageDir, 'workspace');
      await this.copyDirectory(localPath, workspaceDestDir);

      // Copy ~/.claude if exists
      if (fs.existsSync(claudeDir)) {
        const claudeDestDir = path.join(tmpPackageDir, '.claude');
        logger.info('Backing up ~/.claude to session storage', {
          component: 'StorageClient',
          sessionPath,
          claudeDir,
          claudeDestDir
        });
        await this.copyDirectory(claudeDir, claudeDestDir);
        logger.info('Backed up ~/.claude successfully', {
          component: 'StorageClient',
          sessionPath
        });
      } else {
        logger.info('No ~/.claude directory to backup', {
          component: 'StorageClient',
          sessionPath,
          claudeDir
        });
      }

      // Copy ~/.codex if exists
      if (fs.existsSync(codexDir)) {
        const codexDestDir = path.join(tmpPackageDir, '.codex');
        await this.copyDirectory(codexDir, codexDestDir);
      }

      // Create tarball
      await tar.create(
        {
          gzip: true,
          file: tarPath,
          cwd: tmpPackageDir
        },
        ['.']
      );

      // Upload to storage worker
      // Session path should not contain slashes (validated by storage-worker)
      const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionPath}/upload`;
      await this.uploadFile(url, tarPath);

      // Cleanup
      fs.unlinkSync(tarPath);
      fs.rmSync(tmpPackageDir, { recursive: true, force: true });

      logger.info('Session uploaded successfully', {
        component: 'StorageClient',
        sessionPath
      });
    } catch (error) {
      logger.error('Failed to upload session', error, {
        component: 'StorageClient',
        sessionPath
      });
      throw error;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<string[]> {
    if (!this.enabled) return [];

    const url = `${this.baseUrl}/api/storage-worker/sessions`;

    try {
      const response = await this.makeRequest(url, 'GET');
      const data = JSON.parse(response);
      return (data.sessions || []).map((s: any) => s.sessionId);
    } catch (error) {
      logger.error('Failed to list sessions', error, {
        component: 'StorageClient'
      });
      throw error;
    }
  }

  /**
   * Check if session exists
   */
  async sessionExists(sessionPath: string): Promise<boolean> {
    if (!this.enabled) return false;

    // Session path should not contain slashes (validated by storage-worker)
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionPath}`;

    try {
      await this.makeRequest(url, 'HEAD');
      return true;
    } catch (err: any) {
      if (err.statusCode === 404) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionPath: string): Promise<void> {
    if (!this.enabled) return;

    // Session path should not contain slashes (validated by storage-worker)
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionPath}`;

    try {
      await this.makeRequest(url, 'DELETE');
      logger.info('Session deleted from storage', {
        component: 'StorageClient',
        sessionPath
      });
    } catch (error) {
      logger.error('Failed to delete session', error, {
        component: 'StorageClient',
        sessionPath
      });
      throw error;
    }
  }

  /**
   * Get session metadata from local workspace
   */
  async getMetadata(sessionPath: string, localPath: string): Promise<SessionMetadata | null> {
    const metadataPath = path.join(localPath, '.session-metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as SessionMetadata;
    } catch (error) {
      logger.error('Failed to read metadata', error, {
        component: 'StorageClient',
        sessionPath
      });
      return null;
    }
  }

  /**
   * Save session metadata to local workspace
   */
  saveMetadata(sessionPath: string, localPath: string, metadata: SessionMetadata): void {
    const metadataPath = path.join(localPath, '.session-metadata.json');

    try {
      metadata.updatedAt = new Date().toISOString();
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to save metadata', error, {
        component: 'StorageClient',
        sessionPath
      });
      throw error;
    }
  }

  /**
   * Get stream events from session directory
   */
  getStreamEvents(sessionPath: string, localPath: string): SSEEvent[] {
    const eventsPath = path.join(localPath, '.stream-events.jsonl');

    if (!fs.existsSync(eventsPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(eventsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      return lines.map(line => JSON.parse(line));
    } catch (error) {
      logger.error('Failed to read stream events', error, {
        component: 'StorageClient',
        sessionPath
      });
      return [];
    }
  }

  /**
   * Append stream event to session directory
   */
  appendStreamEvent(sessionPath: string, localPath: string, event: SSEEvent): void {
    const eventsPath = path.join(localPath, '.stream-events.jsonl');

    try {
      const eventLine = JSON.stringify(event) + '\n';
      fs.appendFileSync(eventsPath, eventLine, 'utf-8');
    } catch (error) {
      logger.error('Failed to append stream event', error, {
        component: 'StorageClient',
        sessionPath
      });
    }
  }

  // Helper methods

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        // Remove existing destination file first to avoid permission issues
        try {
          await fs.promises.unlink(destPath);
        } catch {
          // File doesn't exist, that's fine
        }

        // Try copyFile first, fall back to read/write if permission denied
        // (handles git pack files with restrictive permissions)
        try {
          await fs.promises.copyFile(srcPath, destPath);
        } catch (err: any) {
          if (err.code === 'EACCES') {
            // Permission denied - read file contents and write to destination
            const content = await fs.promises.readFile(srcPath);
            await fs.promises.writeFile(destPath, content);
          } else {
            throw err;
          }
        }
      }
    }
  }

  private async uploadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(filePath);
      const stats = fs.statSync(filePath);
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/gzip',
            'Content-Length': stats.size,
          },
          timeout: this.timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Upload failed: ${res.statusCode} ${data}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upload timeout'));
      });

      fileStream.pipe(req);
      fileStream.on('error', reject);
    });
  }

  private async downloadFile(url: string, destPath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'GET',
          timeout: this.timeout,
        },
        (res) => {
          if (res.statusCode === 404) {
            resolve(false);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: ${res.statusCode}`));
            return;
          }

          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve(true);
          });

          fileStream.on('error', (err) => {
            fs.unlinkSync(destPath);
            reject(err);
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });

      req.end();
    });
  }

  private async makeRequest(url: string, method: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method,
          timeout: this.timeout,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              const err: any = new Error(`Request failed: ${res.statusCode}`);
              err.statusCode = res.statusCode;
              reject(err);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }
}
