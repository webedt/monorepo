import * as https from 'https';
import * as http from 'http';
import { logger } from '../utils/logger';

/**
 * Client for communicating with the GitHub Worker service
 * Handles SSE streaming for real-time progress updates
 */

export interface CloneRepositoryRequest {
  sessionId: string;
  repoUrl: string;
  branch?: string;
  directory?: string;
  accessToken: string;
}

export interface CloneRepositoryResult {
  clonedPath: string;
  branch: string;
  wasCloned: boolean;
}

export interface InitSessionRequest {
  sessionId: string;
  repoUrl: string;
  branch?: string;
  directory?: string;
  userRequest: string;
  claudeCredentials: string;
  githubAccessToken: string;
}

export interface InitSessionResult {
  clonedPath: string;
  branch: string;
  wasCloned: boolean;
  branchName: string;
  sessionTitle: string;
  sessionPath: string;
}

export interface CreateBranchRequest {
  sessionId: string;
  userRequest: string;
  baseBranch: string;
  repoUrl: string;
  claudeCredentials: string;
  githubAccessToken: string;
}

export interface CreateBranchResult {
  branchName: string;
  sessionTitle: string;
  sessionPath: string;
}

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
  type: 'progress' | 'completed' | 'error' | 'branch_created' | 'session_name' | 'commit_progress';
  stage?: string;
  message?: string;
  data?: any;
  error?: string;
  code?: string;
  timestamp: string;
  // Additional fields from github-worker events
  branchName?: string;
  baseBranch?: string;
  sessionPath?: string;
  sessionName?: string;
  branch?: string;
  commitHash?: string;
}

type SSEEventCallback = (event: SSEEvent) => void;

export class GitHubWorkerClient {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    // Default to internal Docker service URL if GITHUB_WORKER_URL is not set
    const githubWorkerUrl = process.env.GITHUB_WORKER_URL || 'http://webedt-app-github-workers-x4o1nh_github-worker:5002';
    this.baseUrl = githubWorkerUrl.replace(/\/$/, '');
    this.timeout = parseInt(process.env.GITHUB_WORKER_TIMEOUT || '120000', 10);

    logger.info('GitHub Worker client initialized', {
      component: 'GitHubWorkerClient',
      baseUrl: this.baseUrl
    });
  }

  /**
   * Clone a repository into a session
   */
  async cloneRepository(
    request: CloneRepositoryRequest,
    onEvent?: SSEEventCallback
  ): Promise<CloneRepositoryResult> {
    return this.makeSSERequest<CloneRepositoryResult>(
      '/clone-repository',
      request,
      onEvent
    );
  }

  /**
   * Initialize a session: clone repository and create branch in one operation
   */
  async initSession(
    request: InitSessionRequest,
    onEvent?: SSEEventCallback
  ): Promise<InitSessionResult> {
    return this.makeSSERequest<InitSessionResult>(
      '/init-session',
      request,
      onEvent
    );
  }

  /**
   * Create a branch with LLM-generated name
   */
  async createBranch(
    request: CreateBranchRequest,
    onEvent?: SSEEventCallback
  ): Promise<CreateBranchResult> {
    return this.makeSSERequest<CreateBranchResult>(
      '/create-branch',
      request,
      onEvent
    );
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

      logger.info('Making request to GitHub Worker', {
        component: 'GitHubWorkerClient',
        endpoint,
        url
      });

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
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const eventData = line.substring(6);
                  const event: SSEEvent = JSON.parse(eventData);

                  // Forward event to callback
                  if (onEvent) {
                    onEvent(event);
                  }

                  // Handle completion
                  if (event.type === 'completed' && event.data) {
                    result = event.data as T;
                  }

                  // Handle error
                  if (event.type === 'error') {
                    reject(new Error(event.error || 'Unknown error'));
                  }
                } catch (parseError) {
                  logger.warn('Failed to parse SSE event', {
                    component: 'GitHubWorkerClient',
                    line,
                    error: parseError instanceof Error ? parseError.message : String(parseError)
                  });
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
        logger.error('Request to GitHub Worker failed', err, {
          component: 'GitHubWorkerClient',
          endpoint
        });
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
