/**
 * Title Generator for Claude Remote Sessions
 *
 * Four-method fallback system:
 * 1. claude.ai dust endpoint (fastest, ~1s, requires browser cookies)
 * 2. OpenRouter API (fast, ~1-2s, requires OPENROUTER_API_KEY)
 * 3. Temp Sonnet session via API (reliable, ~8-10s, uses OAuth)
 * 4. Local fallback (instant, uses Title Case truncation)
 *
 * All methods return { title, branch_name } in consistent format.
 */

import { randomUUID } from 'crypto';
import type { GeneratedTitle, TitleGeneratorConfig, TitleGenerationEvent, TitleGenerationCallback } from './types.js';

// Constants
const CLAUDE_AI_URL = 'https://claude.ai';
const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';

// JSON prompt used by methods 2 and 3 for consistency
const JSON_PROMPT_TEMPLATE = `Generate a title and git branch name that SUMMARIZE the core intent of this coding request. Do NOT just use the first few words - analyze the full request and create a concise summary.

Respond with ONLY valid JSON, no other text:
{"title": "Concise summary title", "branch_name": "claude/summarized-intent"}

Rules:
- Title: 3-6 words that capture the MAIN PURPOSE of the request
- Branch: starts with "claude/", kebab-case, 2-4 words summarizing the key action
- Title and branch should express the same concept (branch is kebab-case version of title idea)
- Focus on WHAT is being done, not HOW the user phrased it

Examples:
- "I want to update the prompt that generates..." → Title: "Improve Title Generation Prompt", Branch: "claude/improve-title-generation"
- "Can you help me fix the bug where..." → Title: "Fix Authentication Bug", Branch: "claude/fix-auth-bug"
- "Please add a new feature for..." → Title: "Add Export Feature", Branch: "claude/add-export-feature"

Request: "{{PROMPT}}"`;

/**
 * Generate branch name from title (used by methods 1 and 4)
 */
function generateBranchFromTitle(title: string): string {
  const words = title.slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  return `claude/${words || 'session'}`;
}

/**
 * Method 4: Local fallback - extract key action words from prompt
 * Attempts basic summarization by removing filler words and extracting the core intent
 */
function generateTitleLocal(prompt: string): { title: string; branch_name: string } {
  // Common filler words to remove for better summarization
  const fillerWords = new Set([
    'i', 'want', 'to', 'the', 'a', 'an', 'please', 'can', 'you', 'help', 'me',
    'with', 'for', 'this', 'that', 'it', 'is', 'be', 'are', 'was', 'were',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'need', 'just', 'also', 'so', 'if', 'when',
    'where', 'how', 'what', 'which', 'who', 'why', 'all', 'each', 'every', 'both',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same',
    'than', 'too', 'very', 'just', 'but', 'and', 'or', 'as', 'at', 'by', 'from',
    'in', 'into', 'of', 'on', 'out', 'over', 'through', 'under', 'up', 'down',
    'about', 'after', 'before', 'between', 'during', 'like', 'make', 'sure'
  ]);

  // Clean the prompt
  const cleaned = prompt
    .replace(/\n/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim();

  // Extract meaningful words (non-filler words)
  const words = cleaned.split(/\s+/).filter(word =>
    word.length > 2 && !fillerWords.has(word)
  );

  // Take up to 5 meaningful words for the title
  const titleWords = words.slice(0, 5);

  // If we didn't get enough meaningful words, use original approach
  if (titleWords.length < 2) {
    const fallbackWords = cleaned.split(/\s+/).slice(0, 5);
    const title = fallbackWords
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    return {
      title: title || 'New Session',
      branch_name: generateBranchFromTitle(title || 'session'),
    };
  }

  // Convert to Title Case
  const title = titleWords
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    title,
    branch_name: generateBranchFromTitle(title),
  };
}

/**
 * Parse JSON response from LLM (methods 2 and 3)
 */
function parseJsonResponse(content: string): { title: string; branch_name: string } | null {
  const jsonMatch = content.match(/\{[\s\S]*?"title"[\s\S]*?"branch_name"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.title && parsed.branch_name) {
        return { title: parsed.title, branch_name: parsed.branch_name };
      }
    } catch {
      // JSON parse failed
    }
  }
  return null;
}

/**
 * Method 1: claude.ai dust endpoint (requires browser cookies)
 * Returns { title, branch_name } directly from the endpoint
 */
async function tryDustEndpoint(
  prompt: string,
  config: TitleGeneratorConfig
): Promise<{ title: string; branch_name: string } | null> {
  const { claudeCookies, orgUuid } = config;

  if (!claudeCookies || !orgUuid) {
    return null;
  }

  try {
    const response = await fetch(
      `${CLAUDE_AI_URL}/api/organizations/${orgUuid}/dust/generate_title_and_branch`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': claudeCookies,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': CLAUDE_AI_URL,
          'Referer': `${CLAUDE_AI_URL}/code`,
          'anthropic-client-platform': 'web_claude_ai',
          'anthropic-client-version': '1.0.0',
        },
        body: JSON.stringify({ first_session_message: prompt }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { title?: string; branch_name?: string };
    if (data.title && data.branch_name) {
      return { title: data.title, branch_name: data.branch_name };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Method 2: OpenRouter API (uses x-ai/grok-4.1-fast)
 * Returns { title, branch_name } via JSON prompt
 */
async function tryOpenRouter(
  prompt: string,
  config: TitleGeneratorConfig
): Promise<{ title: string; branch_name: string } | null> {
  const { openRouterApiKey } = config;

  if (!openRouterApiKey) {
    return null;
  }

  const titlePrompt = JSON_PROMPT_TEMPLATE.replace('{{PROMPT}}', prompt);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openRouterApiKey}`,
      },
      body: JSON.stringify({
        model: 'x-ai/grok-4.1-fast',
        messages: [{ role: 'user', content: titlePrompt }],
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content;
    if (content) {
      return parseJsonResponse(content);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build headers for Anthropic API
 */
function buildHeaders(accessToken: string, orgUuid?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'Content-Type': 'application/json',
  };
  if (orgUuid) {
    headers['x-organization-uuid'] = orgUuid;
  }
  return headers;
}

/**
 * Method 3: Create temp Sonnet session via API
 * Returns { title, branch_name } via JSON prompt
 */
async function trySonnetSession(
  prompt: string,
  config: TitleGeneratorConfig
): Promise<{ title: string; branch_name: string } | null> {
  const { accessToken, orgUuid, environmentId } = config;

  if (!accessToken || !environmentId) {
    return null;
  }

  const titlePrompt = JSON_PROMPT_TEMPLATE.replace('{{PROMPT}}', prompt);

  const payload = {
    events: [{
      type: 'event',
      data: {
        uuid: randomUUID(),
        session_id: '',
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: titlePrompt },
      },
    }],
    environment_id: environmentId,
    session_context: { model: 'claude-sonnet-4-20250514' },
  };

  try {
    // Create session
    const createRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: buildHeaders(accessToken, orgUuid),
      body: JSON.stringify(payload),
    });

    if (!createRes.ok) {
      return null;
    }

    const session = await createRes.json() as { id: string };

    // Poll for completion (max 60 seconds)
    for (let i = 0; i < 30; i++) {
      const statusRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${session.id}`, {
        headers: buildHeaders(accessToken, orgUuid),
      });
      const status = await statusRes.json() as { session_status: string };

      if (status.session_status === 'idle' || status.session_status === 'completed') {
        // Get events and extract response
        const eventsRes = await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${session.id}/events`, {
          headers: buildHeaders(accessToken, orgUuid),
        });
        const events = await eventsRes.json() as {
          data?: Array<{
            type: string;
            message?: { content?: Array<{ type: string; text?: string }> };
          }>;
        };

        let result: { title: string; branch_name: string } | null = null;
        for (const event of (events.data || [])) {
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                result = parseJsonResponse(block.text);
                if (result) break;
              }
            }
          }
          if (result) break;
        }

        // Archive the temp session
        await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${session.id}/archive`, {
          method: 'POST',
          headers: buildHeaders(accessToken, orgUuid),
          body: JSON.stringify({}),
        }).catch(() => {});

        return result;
      }

      if (status.session_status === 'failed') {
        // Archive and return null
        await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${session.id}/archive`, {
          method: 'POST',
          headers: buildHeaders(accessToken, orgUuid),
          body: JSON.stringify({}),
        }).catch(() => {});
        return null;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    // Timeout - archive and return null
    await fetch(`${CLAUDE_API_BASE_URL}/v1/sessions/${session.id}/archive`, {
      method: 'POST',
      headers: buildHeaders(accessToken, orgUuid),
      body: JSON.stringify({}),
    }).catch(() => {});

    return null;
  } catch {
    return null;
  }
}

/**
 * Helper to emit title generation events
 */
async function emit(
  onProgress: TitleGenerationCallback | undefined,
  event: TitleGenerationEvent
): Promise<void> {
  if (onProgress) {
    await onProgress(event);
  }
}

/**
 * Generate a title and branch name for a session with 4-method fallback
 *
 * Methods (in order of preference):
 * 1. claude.ai dust endpoint - fastest (~1s), requires CLAUDE_COOKIES
 * 2. OpenRouter API          - fast (~1-2s), requires OPENROUTER_API_KEY
 * 3. Temp Sonnet session     - reliable (~8-10s), uses OAuth credentials
 * 4. Local fallback          - instant, uses Title Case truncation
 *
 * @param prompt - The user's prompt to generate a title for
 * @param config - Configuration for title generation methods
 * @param onProgress - Optional callback for progress events
 */
export async function generateTitle(
  prompt: string,
  config: TitleGeneratorConfig = {},
  onProgress?: TitleGenerationCallback
): Promise<GeneratedTitle> {
  // Method 1: Try claude.ai dust endpoint (fastest)
  if (config.claudeCookies && config.orgUuid) {
    await emit(onProgress, { type: 'title_generation', method: 'dust', status: 'trying' });
    const dustResult = await tryDustEndpoint(prompt, config);
    if (dustResult) {
      await emit(onProgress, {
        type: 'title_generation',
        method: 'dust',
        status: 'success',
        title: dustResult.title,
        branch_name: dustResult.branch_name,
      });
      return { ...dustResult, source: 'dust' };
    }
    await emit(onProgress, { type: 'title_generation', method: 'dust', status: 'failed' });
  } else {
    await emit(onProgress, { type: 'title_generation', method: 'dust', status: 'skipped' });
  }

  // Method 2: Try OpenRouter API (fast)
  if (config.openRouterApiKey) {
    await emit(onProgress, { type: 'title_generation', method: 'openrouter', status: 'trying' });
    const openRouterResult = await tryOpenRouter(prompt, config);
    if (openRouterResult) {
      await emit(onProgress, {
        type: 'title_generation',
        method: 'openrouter',
        status: 'success',
        title: openRouterResult.title,
        branch_name: openRouterResult.branch_name,
      });
      return { ...openRouterResult, source: 'openrouter' };
    }
    await emit(onProgress, { type: 'title_generation', method: 'openrouter', status: 'failed' });
  } else {
    await emit(onProgress, { type: 'title_generation', method: 'openrouter', status: 'skipped' });
  }

  // Method 3: Try temp Sonnet session (reliable but slower)
  if (config.accessToken && config.environmentId) {
    await emit(onProgress, { type: 'title_generation', method: 'session', status: 'trying' });
    const sessionResult = await trySonnetSession(prompt, config);
    if (sessionResult) {
      await emit(onProgress, {
        type: 'title_generation',
        method: 'session',
        status: 'success',
        title: sessionResult.title,
        branch_name: sessionResult.branch_name,
      });
      return { ...sessionResult, source: 'session' };
    }
    await emit(onProgress, { type: 'title_generation', method: 'session', status: 'failed' });
  } else {
    await emit(onProgress, { type: 'title_generation', method: 'session', status: 'skipped' });
  }

  // Method 4: Local fallback (instant)
  await emit(onProgress, { type: 'title_generation', method: 'local', status: 'trying' });
  const localResult = generateTitleLocal(prompt);
  await emit(onProgress, {
    type: 'title_generation',
    method: 'local',
    status: 'success',
    title: localResult.title,
    branch_name: localResult.branch_name,
  });
  return { ...localResult, source: 'fallback' };
}

/**
 * Quick synchronous title generation (fallback only)
 * Use this when you need immediate title without async
 */
export function generateTitleSync(prompt: string): { title: string; branch_name: string } {
  return generateTitleLocal(prompt);
}
