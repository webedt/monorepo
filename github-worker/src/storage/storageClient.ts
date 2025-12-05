import * as fs from 'fs';
import * as path from 'path';
import * as tar from 'tar';
import * as https from 'https';
import * as http from 'http';
import { logger } from '../utils/logger';
import { SessionMetadata } from '../types';

/**
 * Storage client for communicating with storage-worker service
 * Handles session download/upload for GitHub operations
 */
export class StorageClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    const storageUrl = process.env.STORAGE_WORKER_URL || 'http://webedt-app-storage-worker-t1avua_storage-worker:3000';
    this.baseUrl = storageUrl.replace(/\/$/, '');
    this.timeout = parseInt(process.env.STORAGE_WORKER_TIMEOUT || '60000', 10);

    logger.info('Storage client initialized', {
      component: 'StorageClient',
      baseUrl: this.baseUrl
    });
  }

  /**
   * Download session from storage to local workspace
   */
  async downloadSession(sessionPath: string, localPath: string): Promise<boolean> {
    const tarPath = `${localPath}-complete.tar.gz`;
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
        logger.info('Session not found in storage, creating new workspace', {
          component: 'StorageClient',
          sessionPath
        });
        fs.mkdirSync(localPath, { recursive: true });
        return false;
      }

      // Extract tarball
      const tmpExtractDir = `${localPath}-extract`;
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
    const tarPath = `${localPath}-complete.tar.gz`;

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
   * Get session metadata from local workspace
   */
  getMetadata(localPath: string): SessionMetadata | null {
    const metadataPath = path.join(localPath, '.session-metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content) as SessionMetadata;
    } catch (error) {
      logger.error('Failed to read metadata', error, {
        component: 'StorageClient'
      });
      return null;
    }
  }

  /**
   * Save session metadata to local workspace
   */
  saveMetadata(localPath: string, metadata: SessionMetadata): void {
    const metadataPath = path.join(localPath, '.session-metadata.json');

    try {
      metadata.lastModified = new Date().toISOString();
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to save metadata', error, {
        component: 'StorageClient'
      });
      throw error;
    }
  }

  /**
   * Get the workspace path within a session directory
   */
  getWorkspacePath(sessionRoot: string, metadata: SessionMetadata): string {
    if (metadata.github?.clonedPath) {
      return path.join(sessionRoot, metadata.github.clonedPath);
    }
    return sessionRoot;
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
        await fs.promises.copyFile(srcPath, destPath);
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
}
