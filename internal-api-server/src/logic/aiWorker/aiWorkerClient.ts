/**
 * AI Worker Client
 * Client for making requests to the AI Coding Worker service
 * Used for one-off LLM queries (session titles, branch names, commit messages)
 *
 * Uses Worker Coordinator for direct routing to available Docker Swarm tasks.
 */

import { logger } from '@webedt/shared';
import { workerCoordinator, WorkerAssignment } from '../execution/workerCoordinator.js';
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
  private timeout: number;

  constructor(timeout?: number) {
    this.timeout = timeout || 30000; // 30 seconds for one-off queries
  }

  /**
   * Run a one-off LLM query through the AI worker
   */
  async query(request: QueryRequest): Promise<string> {
    // Generate a unique query ID for tracking
    const queryId = `query-${uuidv4().substring(0, 8)}`;

    // Acquire worker via coordinator (no fallback)
    const workerAssignment = await workerCoordinator.acquireWorker(queryId);

    if (!workerAssignment) {
      throw new Error('No AI workers available for query. Worker coordinator could not find any running workers in Docker Swarm.');
    }

    const workerUrl = workerAssignment.url;

    logger.info('Worker acquired for query via coordinator', {
      component: 'AIWorkerClient',
      queryId,
      workerId: workerAssignment.worker.id,
      containerId: workerAssignment.worker.containerId,
      workerUrl,
      queryType: request.queryType
    });

    const url = `${workerUrl}/query`;

    logger.info('Sending query to AI worker', {
      component: 'AIWorkerClient',
      url,
      queryType: request.queryType,
      promptLength: request.prompt.length
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
        resultLength: result.result.length
      });

      return result.result;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // Mark worker as failed on timeout
        workerCoordinator.markWorkerFailed(workerAssignment.worker.id, queryId, 'Request timeout');
        throw new Error('AI worker query timed out');
      }

      logger.error('AI worker query failed', error, {
        component: 'AIWorkerClient',
        queryType: request.queryType
      });

      throw error;
    } finally {
      // Release worker back to pool
      workerAssignment.release();
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
    const prompt = `SUMMARIZE the core intent of the following user request into a session title and git branch name.

IMPORTANT: Do NOT just use the first few words. Analyze the FULL request and identify:
1. What is the main ACTION being requested? (add, fix, update, refactor, etc.)
2. What is the TARGET of that action? (auth, UI, API, title generation, etc.)

User request:
${userRequest.substring(0, 1000)}

Parent branch: ${parentBranch}

Return your response in this EXACT format (two lines only, no other text):
TITLE: [3-6 word summary of the core intent]
BRANCH: [lowercase-hyphenated-summary]

Rules for TITLE:
- 3-6 words that capture the MAIN PURPOSE, not just the first words
- Start with an action verb when possible (Add, Fix, Update, Improve, etc.)
- Capitalize properly (Title Case)
- Max 80 characters

Rules for BRANCH:
- Lowercase, hyphen-separated summary of the same concept as the title
- Max 40 characters, no special characters except hyphens
- Only the descriptive part (no "claude/" prefix - that's added later)
- Should match the title's meaning (e.g., title "Fix Auth Bug" → branch "fix-auth-bug")

Examples:
- "I want to update the prompt that generates the title..." → TITLE: Improve Title Generation Prompt / BRANCH: improve-title-generation
- "Can you help me fix the bug where users can't log in..." → TITLE: Fix User Login Bug / BRANCH: fix-user-login-bug
- "Please add dark mode to the settings page..." → TITLE: Add Settings Dark Mode / BRANCH: add-settings-dark-mode

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

  /**
   * Generate commit message from file changes (for code files)
   */
  async generateCommitMessageFromChanges(
    modifiedFiles: string[],
    provider: string,
    authentication: string
  ): Promise<string> {
    const fileList = modifiedFiles.join('\n');
    const prompt = `Generate a concise git commit message for the following modified files. Follow these rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Keep the summary line under 72 characters
- Be specific about what changed based on the file names/paths
- Only return the commit message text, nothing else - no explanations, no markdown

Modified files:
${fileList}

Return ONLY the commit message:`;

    const result = await this.query({
      prompt,
      codingAssistantProvider: provider,
      codingAssistantAuthentication: authentication,
      queryType: 'commit_message'
    });

    const commitMessage = result.trim();

    logger.info('Generated commit message from file list via AI worker', {
      component: 'AIWorkerClient',
      commitMessage,
      fileCount: modifiedFiles.length
    });

    return commitMessage || `Update ${modifiedFiles.length} file(s)`;
  }

  /**
   * Generate commit message for image changes by comparing before/after images
   */
  async generateImageCommitMessage(
    modifiedImages: Array<{
      path: string;
      beforeBase64?: string;  // Original image as base64 data URL
      afterBase64: string;    // Modified image as base64 data URL
    }>,
    provider: string,
    authentication: string
  ): Promise<string> {
    // Build a prompt that describes the images
    // Note: The AI worker will need to handle vision models for actual image comparison
    const imageDescriptions = modifiedImages.map(img => {
      const isNew = !img.beforeBase64;
      return `- ${img.path} (${isNew ? 'NEW' : 'MODIFIED'})`;
    }).join('\n');

    // For now, we'll create a text-based prompt.
    // If vision capabilities are available, the AI worker can use them.
    const prompt = `Generate a concise git commit message for the following image changes. Follow these rules:
- Use imperative mood (e.g., "Add sprite" not "Added sprite")
- Keep the summary line under 72 characters
- Be specific about what changed based on the file names/paths
- Only return the commit message text, nothing else - no explanations, no markdown

Image changes:
${imageDescriptions}

Return ONLY the commit message:`;

    const result = await this.query({
      prompt,
      codingAssistantProvider: provider,
      codingAssistantAuthentication: authentication,
      queryType: 'commit_message'
    });

    const commitMessage = result.trim();

    logger.info('Generated image commit message via AI worker', {
      component: 'AIWorkerClient',
      commitMessage,
      imageCount: modifiedImages.length
    });

    return commitMessage || `Update ${modifiedImages.length} image(s)`;
  }
}
