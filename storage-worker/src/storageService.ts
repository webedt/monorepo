import { Client as MinioClient } from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Readable } from 'stream';
import * as tar from 'tar';
import { createGunzip } from 'zlib';

export interface SessionMetadata {
  sessionPath: string; // Format: {owner}/{repo}/{branch}
  createdAt: string;
  lastModified: string;
  size?: number;
  [key: string]: any;
}

/**
 * MinIO storage service for session management
 * Handles upload/download of session tarballs
 */
export class StorageService {
  private minio: MinioClient;
  private bucket: string;
  private enabled: boolean;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT;
    const port = parseInt(process.env.MINIO_PORT || '9000', 10);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    // Support both MINIO_ROOT_USER (Docker) and MINIO_ACCESS_KEY (legacy)
    const accessKey = process.env.MINIO_ROOT_USER || process.env.MINIO_ACCESS_KEY || 'minioadmin';
    const secretKey = process.env.MINIO_ROOT_PASSWORD || process.env.MINIO_SECRET_KEY || 'minioadmin';
    this.bucket = process.env.MINIO_BUCKET || 'sessions';

    this.enabled = !!endpoint;

    if (!this.enabled) {
      console.warn('MinIO not configured. Storage service disabled.');
      throw new Error('MinIO configuration required for storage service');
    }

    this.minio = new MinioClient({
      endPoint: endpoint!,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    console.log(`MinIO storage service initialized: ${endpoint}:${port} (bucket: ${this.bucket})`);
  }

  /**
   * Initialize MinIO bucket (call on startup)
   */
  async initialize(): Promise<void> {
    try {
      const exists = await this.minio.bucketExists(this.bucket);
      if (!exists) {
        await this.minio.makeBucket(this.bucket);
        console.log(`Created MinIO bucket: ${this.bucket}`);
      } else {
        console.log(`Using existing MinIO bucket: ${this.bucket}`);
      }
    } catch (error) {
      console.error('Failed to initialize MinIO bucket:', error);
      throw error;
    }
  }

  /**
   * Upload a session tarball to MinIO
   */
  async uploadSession(sessionPath: string, tarballPath: string): Promise<void> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      // Verify file exists
      if (!fs.existsSync(tarballPath)) {
        throw new Error(`Tarball not found: ${tarballPath}`);
      }

      // Get file size for metadata
      const stats = fs.statSync(tarballPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      console.log(`Uploading session ${sessionPath} (${sizeMB} MB)...`);

      // Upload to MinIO
      await this.minio.fPutObject(this.bucket, objectName, tarballPath);

      console.log(`Session ${sessionPath} uploaded successfully`);
    } catch (error) {
      console.error(`Failed to upload session ${sessionPath}:`, error);
      throw error;
    }
  }

  /**
   * Upload a session tarball from a stream
   */
  async uploadSessionStream(sessionPath: string, stream: Readable, size?: number): Promise<void> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      console.log(`Uploading session ${sessionPath} from stream...`);

      // Upload to MinIO from stream
      await this.minio.putObject(this.bucket, objectName, stream, size);

      console.log(`Session ${sessionPath} uploaded successfully from stream`);
    } catch (error) {
      console.error(`Failed to upload session ${sessionPath} from stream:`, error);
      throw error;
    }
  }

  /**
   * Download a session tarball from MinIO
   */
  async downloadSession(sessionPath: string, destinationPath: string): Promise<boolean> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      console.log(`Downloading session ${sessionPath}...`);

      // Ensure destination directory exists
      const destDir = path.dirname(destinationPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Download from MinIO
      await this.minio.fGetObject(this.bucket, objectName, destinationPath);

      console.log(`Session ${sessionPath} downloaded successfully`);
      return true;
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        console.log(`Session ${sessionPath} not found in MinIO`);
        return false;
      }
      console.error(`Failed to download session ${sessionPath}:`, err);
      throw err;
    }
  }

  /**
   * Get a session tarball as a stream
   */
  async getSessionStream(sessionPath: string): Promise<Readable> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      console.log(`Streaming session ${sessionPath}...`);
      const stream = await this.minio.getObject(this.bucket, objectName);
      return stream;
    } catch (error) {
      console.error(`Failed to stream session ${sessionPath}:`, error);
      throw error;
    }
  }

  /**
   * List all sessions in MinIO
   */
  async listSessions(): Promise<SessionMetadata[]> {
    try {
      const stream = this.minio.listObjects(this.bucket, '', true);
      const sessions = new Map<string, SessionMetadata>();

      return new Promise((resolve, reject) => {
        stream.on('data', (obj) => {
          // Extract session path from object name: {owner}/{repo}/{branch}/session.tar.gz
          if (obj.name) {
            // Remove the "/session.tar.gz" suffix to get the session path
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
          console.error('Error listing sessions:', err);
          reject(err);
        });
      });
    } catch (error) {
      console.error('Failed to list sessions:', error);
      throw error;
    }
  }

  /**
   * Check if a session exists in MinIO
   */
  async sessionExists(sessionPath: string): Promise<boolean> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      await this.minio.statObject(this.bucket, objectName);
      return true;
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Get session metadata
   */
  async getSessionMetadata(sessionPath: string): Promise<SessionMetadata | null> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      const stat = await this.minio.statObject(this.bucket, objectName);
      return {
        sessionPath,
        createdAt: stat.lastModified?.toISOString() || new Date().toISOString(),
        lastModified: stat.lastModified?.toISOString() || new Date().toISOString(),
        size: stat.size,
      };
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Delete a session from MinIO
   */
  async deleteSession(sessionPath: string): Promise<void> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      await this.minio.removeObject(this.bucket, objectName);
      console.log(`Session ${sessionPath} deleted successfully`);
    } catch (error) {
      console.error(`Failed to delete session ${sessionPath}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple sessions from MinIO
   */
  async deleteSessions(sessionPaths: string[]): Promise<void> {
    const objectNames = sessionPaths.map(path => `${path}/session.tar.gz`);

    try {
      await this.minio.removeObjects(this.bucket, objectNames);
      console.log(`Deleted ${sessionPaths.length} sessions successfully`);
    } catch (error) {
      console.error(`Failed to delete sessions:`, error);
      throw error;
    }
  }

  /**
   * List files in a session tarball
   * Returns array of file paths and their metadata
   */
  async listSessionFiles(sessionPath: string): Promise<{ path: string; size: number; type: 'file' | 'directory' }[]> {
    const objectName = `${sessionPath}/session.tar.gz`;
    const files: { path: string; size: number; type: 'file' | 'directory' }[] = [];

    try {
      const stream = await this.minio.getObject(this.bucket, objectName);

      return new Promise((resolve, reject) => {
        const gunzip = createGunzip();
        const parser = new tar.Parser();

        parser.on('entry', (entry) => {
          // Normalize path (remove leading ./ or /) to match getSessionFile behavior
          const normalizedPath = entry.path.replace(/^\.?\//, '');
          files.push({
            path: normalizedPath,
            size: entry.size || 0,
            type: entry.type === 'Directory' ? 'directory' : 'file',
          });
          entry.resume(); // Drain the entry
        });

        parser.on('end', () => {
          resolve(files);
        });

        parser.on('error', (err) => {
          reject(err);
        });

        stream.pipe(gunzip).pipe(parser);

        gunzip.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error(`Failed to list files in session ${sessionPath}:`, error);
      throw error;
    }
  }

  /**
   * Get a specific file from a session tarball
   * Returns the file content as a Buffer and its mime type
   */
  async getSessionFile(sessionPath: string, filePath: string): Promise<{ content: Buffer; mimeType: string } | null> {
    const objectName = `${sessionPath}/session.tar.gz`;

    try {
      const stream = await this.minio.getObject(this.bucket, objectName);

      return new Promise((resolve, reject) => {
        const gunzip = createGunzip();
        const parser = new tar.Parser();
        let found = false;
        const chunks: Buffer[] = [];

        // Normalize the file path (remove leading ./ or /)
        const normalizedFilePath = filePath.replace(/^\.?\//, '');

        parser.on('entry', (entry) => {
          // Normalize entry path for comparison
          const entryPath = entry.path.replace(/^\.?\//, '');

          if (entryPath === normalizedFilePath && entry.type === 'File') {
            found = true;
            entry.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });
            entry.on('end', () => {
              // Don't resolve here - wait for parser to finish
            });
          } else {
            entry.resume(); // Skip this entry
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

        parser.on('error', (err) => {
          reject(err);
        });

        stream.pipe(gunzip).pipe(parser);

        gunzip.on('error', (err) => {
          reject(err);
        });
      });
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        return null;
      }
      console.error(`Failed to get file ${filePath} from session ${sessionPath}:`, err);
      throw err;
    }
  }

  /**
   * Write/update a file in a session tarball
   * Downloads the tarball, extracts, modifies the file, re-tarballs, and uploads
   */
  async writeSessionFile(sessionPath: string, filePath: string, content: Buffer): Promise<void> {
    const objectName = `${sessionPath}/session.tar.gz`;
    const tmpDir = path.join(os.tmpdir(), `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    const tarPath = path.join(tmpDir, 'session.tar.gz');
    const extractDir = path.join(tmpDir, 'extracted');

    try {
      // Create temp directory
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });

      // Download existing tarball
      await this.minio.fGetObject(this.bucket, objectName, tarPath);

      // Extract tarball
      await tar.extract({
        file: tarPath,
        cwd: extractDir,
      });

      // Normalize file path and write the new content
      const normalizedFilePath = filePath.replace(/^\.?\//, '');
      const fullFilePath = path.join(extractDir, normalizedFilePath);

      // Ensure parent directory exists
      const parentDir = path.dirname(fullFilePath);
      fs.mkdirSync(parentDir, { recursive: true });

      // Write the file
      fs.writeFileSync(fullFilePath, content);

      // Remove old tarball
      fs.unlinkSync(tarPath);

      // Create new tarball
      await tar.create(
        {
          gzip: true,
          file: tarPath,
          cwd: extractDir,
        },
        ['.']
      );

      // Upload new tarball
      await this.minio.fPutObject(this.bucket, objectName, tarPath);

      console.log(`File ${filePath} written to session ${sessionPath}`);
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        // Session doesn't exist - create new tarball with just this file
        fs.mkdirSync(extractDir, { recursive: true });

        const normalizedFilePath = filePath.replace(/^\.?\//, '');
        const fullFilePath = path.join(extractDir, normalizedFilePath);

        const parentDir = path.dirname(fullFilePath);
        fs.mkdirSync(parentDir, { recursive: true });

        fs.writeFileSync(fullFilePath, content);

        await tar.create(
          {
            gzip: true,
            file: tarPath,
            cwd: extractDir,
          },
          ['.']
        );

        await this.minio.fPutObject(this.bucket, objectName, tarPath);

        console.log(`Created new session ${sessionPath} with file ${filePath}`);
      } else {
        console.error(`Failed to write file ${filePath} to session ${sessionPath}:`, err);
        throw err;
      }
    } finally {
      // Cleanup temp directory
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
    const objectName = `${sessionPath}/session.tar.gz`;
    const tmpDir = path.join(os.tmpdir(), `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    const tarPath = path.join(tmpDir, 'session.tar.gz');
    const extractDir = path.join(tmpDir, 'extracted');

    try {
      // Create temp directory
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.mkdirSync(extractDir, { recursive: true });

      // Download existing tarball
      await this.minio.fGetObject(this.bucket, objectName, tarPath);

      // Extract tarball
      await tar.extract({
        file: tarPath,
        cwd: extractDir,
      });

      // Normalize file path and delete
      const normalizedFilePath = filePath.replace(/^\.?\//, '');
      const fullFilePath = path.join(extractDir, normalizedFilePath);

      if (!fs.existsSync(fullFilePath)) {
        return false; // File doesn't exist
      }

      // Delete the file
      fs.unlinkSync(fullFilePath);

      // Remove old tarball
      fs.unlinkSync(tarPath);

      // Create new tarball
      await tar.create(
        {
          gzip: true,
          file: tarPath,
          cwd: extractDir,
        },
        ['.']
      );

      // Upload new tarball
      await this.minio.fPutObject(this.bucket, objectName, tarPath);

      console.log(`File ${filePath} deleted from session ${sessionPath}`);
      return true;
    } catch (err: any) {
      if (err.code === 'NotFound' || err.code === 'NoSuchKey') {
        return false; // Session doesn't exist
      }
      console.error(`Failed to delete file ${filePath} from session ${sessionPath}:`, err);
      throw err;
    } finally {
      // Cleanup temp directory
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
