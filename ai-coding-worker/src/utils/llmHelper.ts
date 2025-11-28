import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';
import { CredentialManager } from './credentialManager';

/**
 * Helper for making one-off LLM requests for commit message and branch name generation
 * Uses Claude Agent SDK (same as main execution) to leverage OAuth authentication
 * Uses Haiku for fast, cost-effective responses
 */
export class LLMHelper {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || '/tmp';
    logger.info('LLMHelper: Initialized with Claude Agent SDK', { component: 'LLMHelper', cwd: this.cwd });
  }

  /**
   * Check if Claude credentials are available
   */
  static isConfigured(): boolean {
    const credPath = CredentialManager.getClaudeCredentialPath();
    return CredentialManager.credentialFileExists(credPath);
  }

  /**
   * Run a quick query using Claude Agent SDK
   */
  private async runQuery(prompt: string, maxTurns: number = 1): Promise<string> {
    const options: Options = {
      model: 'claude-haiku-4-5-20251001',
      cwd: this.cwd,
      maxTurns,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
    };

    let result = '';

    const queryStream = query({ prompt, options });

    for await (const message of queryStream) {
      // Capture the final result (only on success subtype)
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.result;
      }
      // Also capture assistant text messages
      else if (message.type === 'assistant' && message.message?.content) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'text' && item.text) {
              result = item.text;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Generate a commit message from git diff output
   */
  async generateCommitMessage(gitStatus: string, gitDiff: string): Promise<string> {
    try {
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

      const result = await this.runQuery(prompt);
      const commitMessage = result.trim();

      logger.info('Generated commit message', {
        component: 'LLMHelper',
        commitMessage
      });

      return commitMessage || 'Update files';
    } catch (error) {
      logger.error('Failed to generate commit message', error, {
        component: 'LLMHelper'
      });
      return 'Update files';
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
    logger.info('generateSessionTitleAndBranch called', {
      component: 'LLMHelper',
      userRequestLength: userRequest.length,
      parentBranch
    });

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

    const result = await this.runQuery(prompt);

    logger.info('Claude Agent SDK response', {
      component: 'LLMHelper',
      result
    });

    // Parse the response
    const titleMatch = result.match(/TITLE:\s*(.+)/i);
    const branchMatch = result.match(/BRANCH:\s*(.+)/i);

    let title = titleMatch ? titleMatch[1].trim() : 'New Session';
    let branchName = branchMatch ? branchMatch[1].trim() : 'auto-request';

    // Clean up title (ensure max 80 chars with ellipsis if truncated, remove quotes if present)
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

    logger.info('Generated session title and branch name', {
      component: 'LLMHelper',
      title,
      branchName
    });

    return { title, branchName };
  }
}
