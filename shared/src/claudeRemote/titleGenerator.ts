/**
 * Title Generator for Claude Remote Sessions
 *
 * Three-tier fallback system:
 * 1. Claude.ai generate_title_and_branch endpoint
 * 2. Haiku model one-off LLM request
 * 3. Sanitized prompt fallback
 */

import type { GeneratedTitle, TitleGeneratorConfig } from './types.js';

/**
 * Try Claude.ai's generate_title_and_branch endpoint
 */
async function tryClaudeAiEndpoint(
  prompt: string,
  config: TitleGeneratorConfig
): Promise<string | null> {
  const { accessToken, orgUuid } = config;

  if (!accessToken || !orgUuid) {
    return null;
  }

  try {
    const response = await fetch(
      `https://claude.ai/api/organizations/${orgUuid}/dust/generate_title_and_branch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ first_session_message: prompt }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { title?: string; branch_name?: string };
    return data.title || null;
  } catch {
    return null;
  }
}

/**
 * Try Haiku model for title generation
 */
async function tryHaikuModel(
  prompt: string,
  config: TitleGeneratorConfig
): Promise<string | null> {
  const { accessToken, anthropicApiKey } = config;
  const apiKey = anthropicApiKey || accessToken;

  if (!apiKey) {
    return null;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Generate a short, concise title (5-8 words max) for a coding session with this request. Return ONLY the title, no quotes or explanation:\n\n${prompt.slice(0, 500)}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      content?: Array<{ type: string; text?: string }>;
    };

    const textBlock = data.content?.find(block => block.type === 'text');
    if (textBlock?.text) {
      // Clean up the response - remove quotes, trim
      return textBlock.text.replace(/^["']|["']$/g, '').trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sanitize prompt into a readable title
 * - Capitalize first letter of each word
 * - Remove special characters except basic punctuation
 * - Truncate to reasonable length
 */
function sanitizePromptToTitle(prompt: string): string {
  // Take first 60 characters
  let text = prompt.slice(0, 60);

  // Replace newlines and multiple spaces with single space
  text = text.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Remove special characters but keep letters, numbers, spaces, and basic punctuation
  text = text.replace(/[^\w\s.,!?'-]/g, '');

  // Title case: capitalize first letter of each word
  text = text
    .split(' ')
    .map(word => {
      if (word.length === 0) return '';
      // Keep short words lowercase unless they're the first word
      const lowerWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'];
      if (lowerWords.includes(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  // Ensure first character is capitalized
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Add ellipsis if truncated
  if (prompt.length > 60) {
    text = text.trimEnd();
    // Remove trailing punctuation before adding ellipsis
    text = text.replace(/[.,!?-]+$/, '');
    text += '...';
  }

  return text || 'Coding Session';
}

/**
 * Generate a title for a session with 3-tier fallback
 */
export async function generateTitle(
  prompt: string,
  config: TitleGeneratorConfig = {}
): Promise<GeneratedTitle> {
  // Tier 1: Try Claude.ai endpoint
  const claudeAiTitle = await tryClaudeAiEndpoint(prompt, config);
  if (claudeAiTitle) {
    return { title: claudeAiTitle, source: 'claude_ai' };
  }

  // Tier 2: Try Haiku model
  const haikuTitle = await tryHaikuModel(prompt, config);
  if (haikuTitle) {
    return { title: haikuTitle, source: 'haiku' };
  }

  // Tier 3: Fallback to sanitized prompt
  return {
    title: sanitizePromptToTitle(prompt),
    source: 'fallback',
  };
}

/**
 * Quick synchronous title generation (fallback only)
 * Use this when you need immediate title without async
 */
export function generateTitleSync(prompt: string): string {
  return sanitizePromptToTitle(prompt);
}
