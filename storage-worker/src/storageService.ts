import { Client as MinioClient } from 'minio';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

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
}
