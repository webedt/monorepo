import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger';
import { CredentialManager } from './credentialManager';

/**
 * Helper for making one-off LLM requests for commit message and branch name generation
 * Uses Haiku for fast, cost-effective responses
 * Reads credentials from ~/.claude/.credentials.json (same as Claude Agent SDK)
 */
export class LLMHelper {
  private client: Anthropic;

  constructor() {
    // Read credentials from the file written by CredentialManager
    // This ensures we use the same auth as the Claude Agent SDK
    const credentialPath = CredentialManager.getClaudeCredentialPath();
    const credentials = CredentialManager.readCredentialFile(credentialPath);

    // Check for OAuth tokens first (claudeAiOauth format)
    if (credentials.claudeAiOauth?.accessToken) {
      const accessToken = credentials.claudeAiOauth.accessToken;
      this.client = new Anthropic({ authToken: accessToken });
      logger.info('LLMHelper: Initialized with OAuth token from credentials file', { component: 'LLMHelper' });
    }
    // Fall back to API key
    else if (credentials.apiKey) {
      this.client = new Anthropic({ apiKey: credentials.apiKey });
      logger.info('LLMHelper: Initialized with API key from credentials file', { component: 'LLMHelper' });
    }
    // Unknown format
    else {
      throw new Error('No valid authentication found in credentials file');
    }
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
}
