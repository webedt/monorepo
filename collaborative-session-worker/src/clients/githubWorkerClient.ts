import * as https from 'https';
import * as http from 'http';

/**
 * Client for communicating with the GitHub Worker service
 * Used by Collaborative Session Worker for auto-commit operations
 */

export interface CommitAndPushRequest {
  sessionId: string;
  claudeCredentials: string;
  githubAccessToken: string;
  userId?: string;
}

export interface CommitAndPushResult {
  commitHash: string;
  commitMessage: string;
  branch: string;
  pushed: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface SSEEvent {
  type: 'progress' | 'completed' | 'error';
  stage?: string;
  message?: string;
  data?: any;
  error?: string;
  code?: string;
  timestamp: string;
}

type SSEEventCallback = (event: SSEEvent) => void;

export class GitHubWorkerClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    const githubWorkerUrl = process.env.GITHUB_WORKER_URL || 'http://github-worker:5002';
    this.baseUrl = githubWorkerUrl.replace(/\/$/, '');
    this.timeout = parseInt(process.env.GITHUB_WORKER_TIMEOUT || '120000', 10);

    console.log(`[GitHubWorkerClient] Initialized with baseUrl: ${this.baseUrl}`);
  }

  /**
   * Commit changes and push to remote
   */
  async commitAndPush(
    request: CommitAndPushRequest,
    onEvent?: SSEEventCallback
  ): Promise<CommitAndPushResult> {
    return this.makeSSERequest<CommitAndPushResult>(
      '/commit-and-push',
      request,
      onEvent
    );
  }

  /**
   * Make an SSE request to the GitHub Worker
   */
  private makeSSERequest<T>(
    endpoint: string,
    body: any,
    onEvent?: SSEEventCallback
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;
      const urlObj = new URL(url);
      const protocol = url.startsWith('https') ? https : http;
      const bodyStr = JSON.stringify(body);

      console.log(`[GitHubWorkerClient] Making request to ${endpoint}`);

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (url.startsWith('https') ? 443 : 80),
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'Accept': 'text/event-stream'
          },
          timeout: this.timeout
        },
        (res) => {
          // Handle non-SSE responses (errors)
          if (res.statusCode === 429) {
            reject(new Error('GitHub Worker is busy, retry later'));
            return;
          }

          if (res.statusCode === 400) {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const error = JSON.parse(data);
                reject(new Error(error.message || 'Invalid request'));
              } catch {
                reject(new Error('Invalid request'));
              }
            });
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`GitHub Worker returned ${res.statusCode}`));
            return;
          }

          // Handle SSE stream
          let buffer = '';
          let result: T | null = null;

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();

            // Process complete SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const eventData = line.substring(6);
                  const event: SSEEvent = JSON.parse(eventData);

                  if (onEvent) {
                    onEvent(event);
                  }

                  if (event.type === 'completed' && event.data) {
                    result = event.data as T;
                  }

                  if (event.type === 'error') {
                    reject(new Error(event.error || 'Unknown error'));
                  }
                } catch (parseError) {
                  console.warn(`[GitHubWorkerClient] Failed to parse SSE event: ${line}`);
                }
              }
            }
          });

          res.on('end', () => {
            if (result !== null) {
              resolve(result);
            } else {
              reject(new Error('No result received from GitHub Worker'));
            }
          });

          res.on('error', reject);
        }
      );

      req.on('error', (err) => {
        console.error(`[GitHubWorkerClient] Request failed:`, err);
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub Worker request timeout'));
      });

      req.write(bodyStr);
      req.end();
    });
  }

  /**
   * Check if GitHub Worker is available
   */
  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const url = `${this.baseUrl}/health`;
      const urlObj = new URL(url);
      const protocol = url.startsWith('https') ? https : http;

      const req = protocol.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || (url.startsWith('https') ? 443 : 80),
          path: urlObj.pathname,
          method: 'GET',
          timeout: 5000
        },
        (res) => {
          resolve(res.statusCode === 200);
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }
}
