import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

export interface SessionMetadata {
  sessionId: string;
  createdAt: string;
  lastModified: string;
  size?: number;
  [key: string]: any;
}

export interface StorageClientOptions {
  baseUrl: string;
  timeout?: number;
}

/**
 * Client for communicating with the storage-worker service
 * Provides a simple interface for session storage operations
 */
export class StorageClient {
  private baseUrl: string;
  private timeout: number;

  constructor(options: StorageClientOptions | string) {
    if (typeof options === 'string') {
      this.baseUrl = options;
      this.timeout = 60000; // 60 seconds default
    } else {
      this.baseUrl = options.baseUrl;
      this.timeout = options.timeout || 60000;
    }

    // Remove trailing slash
    this.baseUrl = this.baseUrl.replace(/\/$/, '');

    console.log(`StorageClient initialized: ${this.baseUrl}`);
  }

  /**
   * Upload a session tarball to storage
   */
  async uploadSession(sessionId: string, tarballPath: string): Promise<void> {
    if (!fs.existsSync(tarballPath)) {
      throw new Error(`Tarball not found: ${tarballPath}`);
    }

    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionId}/upload`;
    const fileStream = fs.createReadStream(tarballPath);
    const stats = fs.statSync(tarballPath);

    return new Promise((resolve, reject) => {
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

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `Upload failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`Upload failed with status ${res.statusCode}`));
              }
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Upload request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Upload request timed out'));
      });

      fileStream.pipe(req);

      fileStream.on('error', (error) => {
        req.destroy();
        reject(new Error(`Failed to read tarball: ${error.message}`));
      });
    });
  }

  /**
   * Download a session tarball from storage
   * Returns true if session was found and downloaded, false if not found
   */
  async downloadSession(sessionId: string, destinationPath: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionId}/download`;

    // Ensure destination directory exists
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

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
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `Download failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`Download failed with status ${res.statusCode}`));
              }
            });
            return;
          }

          const fileStream = fs.createWriteStream(destinationPath);

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve(true);
          });

          fileStream.on('error', (error) => {
            fs.unlinkSync(destinationPath);
            reject(new Error(`Failed to write tarball: ${error.message}`));
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Download request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download request timed out'));
      });

      req.end();
    });
  }

  /**
   * List all sessions in storage
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const url = `${this.baseUrl}/api/storage-worker/sessions`;

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
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data);
                resolve(response.sessions || []);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `List failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`List failed with status ${res.statusCode}`));
              }
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`List request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('List request timed out'));
      });

      req.end();
    });
  }

  /**
   * Get session metadata
   */
  async getSessionMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionId}`;

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
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 404) {
              resolve(null);
              return;
            }

            if (res.statusCode === 200) {
              try {
                const metadata = JSON.parse(data);
                resolve(metadata);
              } catch (error) {
                reject(new Error('Failed to parse response'));
              }
            } else {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `Get metadata failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`Get metadata failed with status ${res.statusCode}`));
              }
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Get metadata request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Get metadata request timed out'));
      });

      req.end();
    });
  }

  /**
   * Check if a session exists in storage
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionId}`;

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'HEAD',
          timeout: this.timeout,
        },
        (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else if (res.statusCode === 404) {
            resolve(false);
          } else {
            reject(new Error(`Session exists check failed with status ${res.statusCode}`));
          }
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Session exists request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Session exists request timed out'));
      });

      req.end();
    });
  }

  /**
   * Delete a session from storage
   */
  async deleteSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/api/storage-worker/sessions/${sessionId}`;

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'DELETE',
          timeout: this.timeout,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `Delete failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`Delete failed with status ${res.statusCode}`));
              }
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Delete request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Delete request timed out'));
      });

      req.end();
    });
  }

  /**
   * Delete multiple sessions from storage
   */
  async deleteSessions(sessionIds: string[]): Promise<void> {
    const url = `${this.baseUrl}/api/storage-worker/sessions/bulk-delete`;
    const body = JSON.stringify({ sessionIds });

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const urlObj = new URL(url);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: this.timeout,
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || `Bulk delete failed with status ${res.statusCode}`));
              } catch {
                reject(new Error(`Bulk delete failed with status ${res.statusCode}`));
              }
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(new Error(`Bulk delete request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Bulk delete request timed out'));
      });

      req.write(body);
      req.end();
    });
  }
}
