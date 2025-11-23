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
   * Generate a branch name from user request
   */
  async generateBranchName(userRequest: string): Promise<string> {
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
- Max 50 characters
- No special characters
- Only return the branch name, nothing else

User request:
${userRequest.substring(0, 1000)}

Branch name:`
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      let branchName = content.text.trim();
      // Ensure it's a valid branch name
      branchName = branchName.replace(/[^a-z0-9-\/]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

      logger.info('Generated branch name', {
        component: 'LLMHelper',
        branchName
      });

      return branchName;
    } catch (error) {
      logger.error('Failed to generate branch name', error, {
        component: 'LLMHelper'
      });
      // Fallback
      return `feature/auto-request`;
    }
  }
}
