/**
 * Storage service for session management with MinIO
 * Handles session tarball upload/download and file operations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import * as tar from 'tar';
import { createGunzip } from 'zlib';
import { getMinioClient, getBucket, initializeBucket } from './minioClient.js';
import { logger } from '../../utils/logger.js';
import { validateSessionPath } from '../../utils/sessionPathHelper.js';

export interface SessionMetadata {
  sessionPath: string;
  createdAt: string;
  lastModified: string;
  size?: number;
  [key: string]: unknown;
}

export interface FileInfo {
  path: string;
  size: number;
  type: 'file' | 'directory';
}

/**
 * Storage service class - manages session storage in MinIO
 */
class StorageServiceClass {
  private initialized = false;

  /**
   * Initialize the storage service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await initializeBucket();
    this.initialized = true;
    logger.info('Storage service initialized', { component: 'StorageService' });
  }

  /**
   * Upload a session tarball to MinIO
   */
  async uploadSession(sessionPath: string, tarballPath: string): Promise<void> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball not found: ${tarballPath}`);
    }

    const stats = fs.statSync(tarballPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

    logger.info(`Uploading session ${sessionPath} (${sizeMB} MB)...`, { component: 'StorageService' });

    await minio.fPutObject(bucket, objectName, tarballPath);

    logger.info(`Session ${sessionPath} uploaded successfully`, { component: 'StorageService' });
  }

  /**
   * Upload a session tarball from a stream
   */
  async uploadSessionStream(sessionPath: string, stream: Readable, size?: number): Promise<void> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    logger.info(`Uploading session ${sessionPath} from stream...`, { component: 'StorageService' });

    await minio.putObject(bucket, objectName, stream, size);

    logger.info(`Session ${sessionPath} uploaded successfully from stream`, { component: 'StorageService' });
  }

  /**
   * Download a session tarball from MinIO
   * Returns true if session was found and downloaded, false if not found
   */
  async downloadSession(sessionPath: string, destinationPath: string): Promise<boolean> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      logger.info(`Downloading session ${sessionPath}...`, { component: 'StorageService' });

      const destDir = path.dirname(destinationPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      await minio.fGetObject(bucket, objectName, destinationPath);

      logger.info(`Session ${sessionPath} downloaded successfully`, { component: 'StorageService' });
      return true;
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        logger.info(`Session ${sessionPath} not found in MinIO`, { component: 'StorageService' });
        return false;
      }
      logger.error(`Failed to download session ${sessionPath}`, err, { component: 'StorageService' });
      throw err;
    }
  }

  /**
   * Get a session tarball as a stream
   */
  async getSessionStream(sessionPath: string): Promise<Readable> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    logger.info(`Streaming session ${sessionPath}...`, { component: 'StorageService' });
    return await minio.getObject(bucket, objectName);
  }

  /**
   * Download session and return as Buffer (for GitHubOperations compatibility)
   * Returns null if session doesn't exist
   */
  async downloadSessionToBuffer(sessionPath: string): Promise<Buffer | null> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      logger.info(`Downloading session ${sessionPath} to buffer...`, { component: 'StorageService' });
      const stream = await minio.getObject(bucket, objectName);
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        logger.info(`Session ${sessionPath} not found in MinIO`, { component: 'StorageService' });
        return null;
      }
      throw err;
    }
  }

  /**
   * Extract a session tarball Buffer to a directory path
   */
  async extractSessionToPath(sessionData: Buffer, destinationPath: string): Promise<void> {
    logger.info(`Extracting session to ${destinationPath}...`, { component: 'StorageService' });

    if (!fs.existsSync(destinationPath)) {
      fs.mkdirSync(destinationPath, { recursive: true });
    }

    const gunzip = createGunzip();
    const readable = Readable.from(sessionData);

    return new Promise((resolve, reject) => {
      const extractStream = tar.extract({ cwd: destinationPath });
      readable.pipe(gunzip).pipe(extractStream);

      extractStream.on('finish', () => {
        logger.info(`Session extracted to ${destinationPath}`, { component: 'StorageService' });
        resolve();
      });
      extractStream.on('error', reject);
      gunzip.on('error', reject);
    });
  }

  /**
   * Upload a session from a directory path (creates tarball and uploads)
   */
  async uploadSessionFromPath(sessionPath: string, sourcePath: string): Promise<void> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;
    const tmpTarball = path.join(os.tmpdir(), `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.tar.gz`);

    try {
      logger.info(`Creating tarball from ${sourcePath}...`, { component: 'StorageService' });

      await tar.create(
        { gzip: true, file: tmpTarball, cwd: sourcePath },
        ['.']
      );

      const stats = fs.statSync(tmpTarball);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      logger.info(`Uploading session ${sessionPath} (${sizeMB} MB)...`, { component: 'StorageService' });

      await minio.fPutObject(bucket, objectName, tmpTarball);

      logger.info(`Session ${sessionPath} uploaded successfully from path`, { component: 'StorageService' });
    } finally {
      try {
        if (fs.existsSync(tmpTarball)) {
          fs.unlinkSync(tmpTarball);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * List all sessions in MinIO
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const minio = getMinioClient();
    const bucket = getBucket();

    const stream = minio.listObjects(bucket, '', true);
    const sessions = new Map<string, SessionMetadata>();

    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name) {
          const sessionPath = obj.name.replace('/session.tar.gz', '');

          if (!sessions.has(sessionPath)) {
            sessions.set(sessionPath, {
              sessionPath,
              createdAt: obj.lastModified?.toISOString() || new Date().toISOString(),
              lastModified: obj.lastModified?.toISOString() || new Date().toISOString(),
              size: obj.size,
            });
          }
        }
      });

      stream.on('end', () => {
        resolve(Array.from(sessions.values()));
      });

      stream.on('error', (err) => {
        logger.error('Error listing sessions', err, { component: 'StorageService' });
        reject(err);
      });
    });
  }

  /**
   * Check if a session exists in MinIO
   */
  async sessionExists(sessionPath: string): Promise<boolean> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      await minio.statObject(bucket, objectName);
      return true;
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Get session metadata
   */
  async getSessionMetadata(sessionPath: string): Promise<SessionMetadata | null> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      const stat = await minio.statObject(bucket, objectName);
      return {
        sessionPath,
        createdAt: stat.lastModified?.toISOString() || new Date().toISOString(),
        lastModified: stat.lastModified?.toISOString() || new Date().toISOString(),
        size: stat.size,
      };
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Delete a session from MinIO
   */
  async deleteSession(sessionPath: string): Promise<void> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    await minio.removeObject(bucket, objectName);
    logger.info(`Session ${sessionPath} deleted successfully`, { component: 'StorageService' });
  }

  /**
   * Delete multiple sessions from MinIO
   */
  async deleteSessions(sessionPaths: string[]): Promise<void> {
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectNames = sessionPaths.map(p => `${p}/session.tar.gz`);

    await minio.removeObjects(bucket, objectNames);
    logger.info(`Deleted ${sessionPaths.length} sessions successfully`, { component: 'StorageService' });
  }

  /**
   * List files in a session tarball
   */
  async listSessionFiles(sessionPath: string): Promise<FileInfo[]> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;
    const files: FileInfo[] = [];

    const stream = await minio.getObject(bucket, objectName);

    return new Promise((resolve, reject) => {
      const gunzip = createGunzip();
      const parser = new tar.Parser();

      parser.on('entry', (entry) => {
        const normalizedPath = entry.path.replace(/^\.?\//, '');
        files.push({
          path: normalizedPath,
          size: entry.size || 0,
          type: entry.type === 'Directory' ? 'directory' : 'file',
        });
        entry.resume();
      });

      parser.on('end', () => resolve(files));
      parser.on('error', reject);

      stream.pipe(gunzip).pipe(parser);
      gunzip.on('error', reject);
    });
  }

  /**
   * Get a specific file from a session tarball
   */
  async getSessionFile(sessionPath: string, filePath: string): Promise<{ content: Buffer; mimeType: string } | null> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      const stream = await minio.getObject(bucket, objectName);

      return new Promise((resolve, reject) => {
        const gunzip = createGunzip();
        const parser = new tar.Parser();
        let found = false;
        const chunks: Buffer[] = [];

        const normalizedFilePath = filePath.replace(/^\.?\//, '');

        parser.on('entry', (entry) => {
          const entryPath = entry.path.replace(/^\.?\//, '');

          if (entryPath === normalizedFilePath && entry.type === 'File') {
            found = true;
            entry.on('data', (chunk: Buffer) => chunks.push(chunk));
          } else {
            entry.resume();
          }
        });

        parser.on('end', () => {
          if (found && chunks.length > 0) {
            const content = Buffer.concat(chunks);
            const mimeType = this.getMimeType(filePath);
            resolve({ content, mimeType });
          } else {
            resolve(null);
          }
        });

        parser.on('error', reject);
        stream.pipe(gunzip).pipe(parser);
        gunzip.on('error', reject);
      });
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Write/update a file in a session tarball
   */
  async writeSessionFile(sessionPath: string, filePath: string, content: Buffer): Promise<void> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;
    const tmpDir = path.join(os.tmpdir(), `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    const tarPath = path.join(tmpDir, 'session.tar.gz');
    const extractDir = path.join(tmpDir, 'extracted');

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });

      // Try to download existing tarball
      try {
        await minio.fGetObject(bucket, objectName, tarPath);
        await tar.extract({ file: tarPath, cwd: extractDir });
      } catch (err: unknown) {
        const error = err as { code?: string };
        if (error.code !== 'NotFound' && error.code !== 'NoSuchKey') {
          throw err;
        }
        // Session doesn't exist, will create new one
      }

      // Write the file
      const normalizedFilePath = filePath.replace(/^\.?\//, '');
      const fullFilePath = path.join(extractDir, normalizedFilePath);
      const parentDir = path.dirname(fullFilePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(fullFilePath, content);

      // Remove old tarball if exists
      if (fs.existsSync(tarPath)) {
        fs.unlinkSync(tarPath);
      }

      // Create new tarball
      await tar.create(
        { gzip: true, file: tarPath, cwd: extractDir },
        ['.']
      );

      // Upload
      await minio.fPutObject(bucket, objectName, tarPath);

      logger.info(`File ${filePath} written to session ${sessionPath}`, { component: 'StorageService' });
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Delete a file from a session tarball
   */
  async deleteSessionFile(sessionPath: string, filePath: string): Promise<boolean> {
    validateSessionPath(sessionPath);
    const minio = getMinioClient();
    const bucket = getBucket();
    const objectName = `${sessionPath}/session.tar.gz`;
    const tmpDir = path.join(os.tmpdir(), `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    const tarPath = path.join(tmpDir, 'session.tar.gz');
    const extractDir = path.join(tmpDir, 'extracted');

    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });

      await minio.fGetObject(bucket, objectName, tarPath);
      await tar.extract({ file: tarPath, cwd: extractDir });

      const normalizedFilePath = filePath.replace(/^\.?\//, '');
      const fullFilePath = path.join(extractDir, normalizedFilePath);

      if (!fs.existsSync(fullFilePath)) {
        return false;
      }

      fs.unlinkSync(fullFilePath);
      fs.unlinkSync(tarPath);

      await tar.create(
        { gzip: true, file: tarPath, cwd: extractDir },
        ['.']
      );

      await minio.fPutObject(bucket, objectName, tarPath);

      logger.info(`File ${filePath} deleted from session ${sessionPath}`, { component: 'StorageService' });
      return true;
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'NotFound' || error.code === 'NoSuchKey') {
        return false;
      }
      throw err;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      // Text/Code
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.ts': 'text/typescript',
      '.tsx': 'text/typescript',
      '.jsx': 'application/javascript',
      '.json': 'application/json',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      // Fonts
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.otf': 'font/otf',
      // Audio/Video
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      // Archives
      '.zip': 'application/zip',
      '.tar': 'application/x-tar',
      '.gz': 'application/gzip',
      // Other
      '.pdf': 'application/pdf',
      '.wasm': 'application/wasm',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

// Export class for type usage and singleton instance
export { StorageServiceClass as StorageService };
export const storageService = new StorageServiceClass();
