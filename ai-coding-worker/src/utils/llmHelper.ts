import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { logger } from '@webedt/shared';
import { CredentialManager } from './credentialManager';

/**
 * Helper for making one-off LLM requests for session title and branch name generation
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
   * Run a raw query with a custom prompt (public method for one-off queries)
   */
  async runRawQuery(prompt: string): Promise<string> {
    return this.runQuery(prompt, 1);
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
