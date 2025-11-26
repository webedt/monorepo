import { query } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';
import { CredentialManager } from './credentialManager';

/**
 * Helper for making one-off LLM requests for commit message and branch name generation
 * Uses Haiku for fast, cost-effective responses
 * Uses the same Claude credentials as the main execute function (from ~/.claude/.credentials.json)
 */
export class LLMHelper {
  private workspace: string;

  constructor(workspace: string) {
    this.workspace = workspace;
  }

  /**
   * Check if Claude credentials are available
   */
  static isConfigured(): boolean {
    const credPath = CredentialManager.getClaudeCredentialPath();
    return CredentialManager.credentialFileExists(credPath);
  }

  /**
   * Run a simple query using Claude Agent SDK
   * Returns the text response from the assistant
   */
  private async runQuery(prompt: string): Promise<string> {
    let result = '';

    logger.info('LLMHelper: Starting query', {
      component: 'LLMHelper',
      promptLength: prompt.length,
      workspace: this.workspace
    });

    try {
      const queryStream = query({
        prompt,
        options: {
          model: 'claude-sonnet-4-5-20250929',
          cwd: this.workspace,
          allowDangerouslySkipPermissions: true,
          permissionMode: 'bypassPermissions',
          maxTurns: 1, // Single turn, just need the response
        }
      });

      for await (const message of queryStream) {
        logger.info('LLMHelper: Received message', {
          component: 'LLMHelper',
          messageType: message.type,
          subtype: (message as any).subtype
        });

        // Extract text from assistant messages
        if (message.type === 'assistant' && message.message?.content) {
          const content = message.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === 'text' && item.text) {
                result += item.text;
              }
            }
          }
        }

        // Check for errors
        if (message.type === 'result' && (message as any).is_error) {
          logger.error('LLMHelper: Query returned error result', null, {
            component: 'LLMHelper',
            result: (message as any).result
          });
        }
      }

      logger.info('LLMHelper: Query completed', {
        component: 'LLMHelper',
        resultLength: result.length,
        resultPreview: result.substring(0, 100)
      });

    } catch (error) {
      logger.error('LLMHelper: Query stream error', error, {
        component: 'LLMHelper'
      });
      throw error;
    }

    return result.trim();
  }

  /**
   * Generate a commit message from git diff output
   */
  async generateCommitMessage(gitStatus: string, gitDiff: string): Promise<string> {
    try {
      const prompt = `Analyze the following git changes and generate a concise, conventional commit message. Follow these rules:
- Use conventional commit format (e.g., "feat:", "fix:", "refactor:", "docs:", etc.)
- Keep the summary line under 72 characters
- Be specific about what changed
- Only return the commit message, nothing else - no explanation, just the commit message text

Git status:
${gitStatus}

Git diff:
${gitDiff.substring(0, 4000)}

Commit message:`;

      const commitMessage = await this.runQuery(prompt);

      logger.info('Generated commit message', {
        component: 'LLMHelper',
        commitMessage
      });

      return commitMessage || 'chore: auto-commit changes';
    } catch (error) {
      logger.error('Failed to generate commit message', error, {
        component: 'LLMHelper'
      });
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
      logger.info('LLMHelper: Generating session title and branch name', {
        component: 'LLMHelper',
        userRequestLength: userRequest.length,
        parentBranch
      });

      const prompt = `Based on the following user request, generate BOTH a session title and a git branch name.

User request:
${userRequest.substring(0, 1000)}

Parent branch: ${parentBranch}

Return your response in this exact format (no other text):
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

Response:`;

      const text = await this.runQuery(prompt);

      logger.info('LLMHelper: Raw LLM response', {
        component: 'LLMHelper',
        response: text
      });

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
      return {
        title: 'New Session',
        branchName: 'auto-request'
      };
    }
  }
}
