import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';

/**
 * Helper for making one-off LLM requests for commit message generation
 * Uses Haiku for fast, cost-effective responses
 * Supports both API keys and OAuth tokens
 */
export class LLMHelper {
  private client: Anthropic;

  constructor(authToken: string) {
    // Detect if OAuth token (starts with sk-ant-oat) or API key (starts with sk-ant-api)
    if (authToken.startsWith('sk-ant-oat')) {
      // OAuth token - use authToken parameter
      this.client = new Anthropic({ authToken });
    } else {
      // API key - use apiKey parameter
      this.client = new Anthropic({ apiKey: authToken });
    }
  }

  /**
   * Create an LLMHelper instance with the best available API key.
   * Priority:
   * 1. User-provided API key (if it's a real API key, not OAuth)
   * 2. Environment variable ANTHROPIC_API_KEY
   *
   * Returns null if no valid API key is available for direct API calls.
   */
  static createWithFallback(userAuth?: string | null): LLMHelper | null {
    // Check if user provided a real API key (not OAuth)
    if (userAuth && userAuth.startsWith('sk-ant-api')) {
      logger.info('LLMHelper: Using user-provided API key', { component: 'LLMHelper' });
      return new LLMHelper(userAuth);
    }

    // Fall back to environment variable
    const envApiKey = process.env.ANTHROPIC_API_KEY;
    if (envApiKey) {
      logger.info('LLMHelper: Using ANTHROPIC_API_KEY from environment', { component: 'LLMHelper' });
      return new LLMHelper(envApiKey);
    }

    // No valid API key available
    logger.info('LLMHelper: No API key available for direct API calls', {
      component: 'LLMHelper',
      hasUserAuth: !!userAuth,
      isOAuth: userAuth?.startsWith('sk-ant-oat')
    });
    return null;
  }

  /**
   * Generate a commit message from git diff output
   */
  async generateCommitMessage(gitStatus: string, gitDiff: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Analyze the following git changes and generate a concise, conventional commit message. Follow these rules:
- Use conventional commit format (e.g., "feat:", "fix:", "refactor:", "docs:", etc.)
- Keep the summary line under 72 characters
- Be specific about what changed
- Only return the commit message, nothing else

Git status:
${gitStatus}

Git diff:
${gitDiff.substring(0, 4000)}

Commit message:`
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      const commitMessage = content.text.trim();

      logger.info('Generated commit message', {
        component: 'LLMHelper',
        commitMessage
      });

      return commitMessage;
    } catch (error) {
      logger.error('Failed to generate commit message', error, {
        component: 'LLMHelper'
      });
      // Fallback commit message
      return 'chore: auto-commit changes';
    }
  }

  /**
   * Generate both session title and branch name from user request in one call
   * Returns both title (3-6 words, human-readable) and branch name (git-friendly)
   */
  async generateSessionTitleAndBranch(
    userRequest: string,
    parentBranch: string
  ): Promise<{ title: string; branchName: string }> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: `Based on the following user request, generate BOTH a session title and a git branch name.

User request:
${userRequest.substring(0, 1000)}

Parent branch: ${parentBranch}

Return your response in this exact format:
TITLE: [3-6 word human-readable title]
BRANCH: [lowercase-hyphenated-branch-name]

Rules for TITLE:
- 3-6 words
- Human-readable, descriptive
- Capitalize properly
- No special characters except spaces

Rules for BRANCH:
- Lowercase only
- Use hyphens as separators
- Max 40 characters
- No special characters
- Only the descriptive part (no "claude/" prefix)
- Focus on the main action or feature

Response:`
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      const text = content.text.trim();

      // Parse the response
      const titleMatch = text.match(/TITLE:\s*(.+)/i);
      const branchMatch = text.match(/BRANCH:\s*(.+)/i);

      let title = titleMatch ? titleMatch[1].trim() : 'New Session';
      let branchName = branchMatch ? branchMatch[1].trim() : 'auto-request';

      // Clean up title (ensure max 60 chars, remove quotes if present)
      title = title
        .replace(/^["']|["']$/g, '')
        .substring(0, 60);

      // Ensure branch name is valid
      branchName = branchName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 40);

      logger.info('Generated session title and branch name', {
        component: 'LLMHelper',
        title,
        branchName
      });

      return { title, branchName };
    } catch (error) {
      logger.error('Failed to generate session title and branch name', error, {
        component: 'LLMHelper'
      });
      // Fallback
      return {
        title: 'New Session',
        branchName: 'auto-request'
      };
    }
  }

  /**
   * Generate a branch name from user request
   * @deprecated Use generateSessionTitleAndBranch instead for better efficiency
   */
  async generateBranchName(userRequest: string, baseBranch: string): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Generate a concise, valid git branch name based on the following user request.
Rules:
- Lowercase only
- Use hyphens as separators
- Max 40 characters (excluding prefix)
- No special characters
- Only return the descriptive part, nothing else (no "claude/" prefix)
- Focus on the main action or feature

Base branch: ${baseBranch}

User request:
${userRequest.substring(0, 1000)}

Branch name (descriptive part only):`
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      let descriptivePart = content.text.trim();
      // Ensure it's a valid branch name part
      descriptivePart = descriptivePart
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 40);

      logger.info('Generated branch name descriptive part', {
        component: 'LLMHelper',
        descriptivePart
      });

      return descriptivePart;
    } catch (error) {
      logger.error('Failed to generate branch name', error, {
        component: 'LLMHelper'
      });
      // Fallback
      return `auto-request`;
    }
  }
}
