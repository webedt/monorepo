/**
 * AI Worker Client
 * Client for making requests to the AI Coding Worker service
 * Used for one-off LLM queries (session titles, branch names, commit messages)
 *
 * Supports both DNSRR routing (legacy) and Worker Coordinator (new).
 * When USE_WORKER_COORDINATOR is enabled, queries are routed to specific
 * available workers instead of relying on DNS round-robin.
 */

import { AI_WORKER_URL, USE_WORKER_COORDINATOR } from '../../config/env.js';
import { logger } from '@webedt/shared';
import { workerCoordinator, WorkerAssignment } from '../workerCoordinator/workerCoordinator.js';
import { v4 as uuidv4 } from 'uuid';

export interface QueryRequest {
  prompt: string;
  codingAssistantProvider: string;
  codingAssistantAuthentication: string;
  queryType?: 'session_title_branch' | 'commit_message' | 'generic';
}

export interface QueryResponse {
  success: boolean;
  result: string;
  queryType?: string;
  containerId?: string;
  error?: string;
  message?: string;
}

export class AIWorkerClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl?: string, timeout?: number) {
    this.baseUrl = baseUrl || AI_WORKER_URL;
    this.timeout = timeout || 30000; // 30 seconds for one-off queries
  }

  /**
   * Run a one-off LLM query through the AI worker
   */
  async query(request: QueryRequest): Promise<string> {
    // Generate a unique query ID for tracking
    const queryId = `query-${uuidv4().substring(0, 8)}`;

    // Determine worker URL - use coordinator if enabled
    let workerUrl: string;
    let workerAssignment: WorkerAssignment | null = null;

    if (USE_WORKER_COORDINATOR) {
      workerAssignment = await workerCoordinator.acquireWorker(queryId);

      if (!workerAssignment) {
        throw new Error('No AI workers available for query. All workers are currently busy.');
      }

      workerUrl = workerAssignment.url;

      logger.info('Worker acquired for query via coordinator', {
        component: 'AIWorkerClient',
        queryId,
        workerId: workerAssignment.worker.id,
        containerId: workerAssignment.worker.containerId,
        workerUrl,
        queryType: request.queryType
      });
    } else {
      workerUrl = this.baseUrl;
    }

    const url = `${workerUrl}/query`;

    logger.info('Sending query to AI worker', {
      component: 'AIWorkerClient',
      url,
      queryType: request.queryType,
      promptLength: request.prompt.length,
      useCoordinator: USE_WORKER_COORDINATOR
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string; error?: string };
        const errorMsg = `AI worker query failed (${response.status}): ${errorBody.message || errorBody.error}`;

        // Mark worker as failed if using coordinator
        if (workerAssignment) {
          workerCoordinator.markWorkerFailed(workerAssignment.worker.id, queryId, errorMsg);
        }

        throw new Error(errorMsg);
      }

      const result = await response.json() as QueryResponse;

      if (!result.success) {
        throw new Error(result.message || result.error || 'Query failed');
      }

      logger.info('AI worker query completed', {
        component: 'AIWorkerClient',
        queryType: request.queryType,
        resultLength: result.result.length,
        useCoordinator: USE_WORKER_COORDINATOR
      });

      return result.result;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // Mark worker as failed on timeout if using coordinator
        if (workerAssignment) {
          workerCoordinator.markWorkerFailed(workerAssignment.worker.id, queryId, 'Request timeout');
        }
        throw new Error('AI worker query timed out');
      }

      logger.error('AI worker query failed', error, {
        component: 'AIWorkerClient',
        queryType: request.queryType,
        useCoordinator: USE_WORKER_COORDINATOR
      });

      throw error;
    } finally {
      // Release worker back to pool
      if (workerAssignment) {
        workerAssignment.release();
      }
    }
  }

  /**
   * Generate session title and branch name
   */
  async generateSessionTitleAndBranch(
    userRequest: string,
    parentBranch: string,
    provider: string,
    authentication: string
  ): Promise<{ title: string; branchName: string }> {
    const prompt = `Based on the following user request, generate BOTH a session title and a git branch name.

User request:
${userRequest.substring(0, 1000)}

Parent branch: ${parentBranch}

Return your response in this EXACT format (two lines only, no other text):
TITLE: [3-6 word human-readable title]
BRANCH: [lowercase-hyphenated-branch-name]

Rules for TITLE:
- 3-6 words, human-readable, descriptive
- Capitalize properly
- No special characters except spaces
- Keep concise, max 80 characters (shorter is better)

Rules for BRANCH:
- Lowercase only, use hyphens as separators
- Max 40 characters, no special characters
- Only the descriptive part (no "claude/" prefix)
- Focus on the main action or feature

Return ONLY the two lines in the exact format above:`;

    const result = await this.query({
      prompt,
      codingAssistantProvider: provider,
      codingAssistantAuthentication: authentication,
      queryType: 'session_title_branch'
    });

    // Parse the response
    const titleMatch = result.match(/TITLE:\s*(.+)/i);
    const branchMatch = result.match(/BRANCH:\s*(.+)/i);

    let title = titleMatch ? titleMatch[1].trim() : 'New Session';
    let branchName = branchMatch ? branchMatch[1].trim() : 'auto-request';

    // Clean up title
    title = title.replace(/^["']|["']$/g, '');
    if (title.length > 80) {
      title = title.substring(0, 77) + '...';
    }

    // Ensure branch name is valid
    branchName = branchName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);

    logger.info('Generated session title and branch name via AI worker', {
      component: 'AIWorkerClient',
      title,
      branchName
    });

    return { title, branchName };
  }

  /**
   * Generate commit message from git diff
   */
  async generateCommitMessage(
    gitStatus: string,
    gitDiff: string,
    provider: string,
    authentication: string
  ): Promise<string> {
    const prompt = `Analyze the following git changes and generate a concise commit message. Follow these rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Keep the summary line under 72 characters
- Be specific about what changed
- Only return the commit message text, nothing else - no explanations, no markdown

Git status:
${gitStatus}

Git diff:
${gitDiff.substring(0, 4000)}

Return ONLY the commit message:`;

    const result = await this.query({
      prompt,
      codingAssistantProvider: provider,
      codingAssistantAuthentication: authentication,
      queryType: 'commit_message'
    });

    const commitMessage = result.trim();

    logger.info('Generated commit message via AI worker', {
      component: 'AIWorkerClient',
      commitMessage
    });

    return commitMessage || 'Update files';
  }
}
