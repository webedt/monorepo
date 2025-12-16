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
import type { GeneratedTitle, TitleGeneratorConfig } from './types.js';

// Constants
const CLAUDE_AI_URL = 'https://claude.ai';
const CLAUDE_API_BASE_URL = 'https://api.anthropic.com';

// JSON prompt used by methods 2 and 3 for consistency
const JSON_PROMPT_TEMPLATE = `Generate a title and git branch name for this coding request. Respond with ONLY valid JSON, no other text:
{"title": "Short descriptive title", "branch_name": "claude/kebab-case-branch"}

Rules:
- Title: 3-6 words, concise, sentence case
- Branch: starts with "claude/", kebab-case, 2-4 words after prefix

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
 * Method 4: Local fallback - convert prompt to Title Case
 */
function generateTitleLocal(prompt: string): { title: string; branch_name: string } {
  // Clean and truncate prompt
  const cleaned = prompt.slice(0, 50).replace(/\n/g, ' ').trim();

  // Convert to Title Case
  const title = cleaned
    .toLowerCase()
    .split(' ')
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
 * Generate a title and branch name for a session with 4-method fallback
 *
 * Methods (in order of preference):
 * 1. claude.ai dust endpoint - fastest (~1s), requires CLAUDE_COOKIES
 * 2. OpenRouter API          - fast (~1-2s), requires OPENROUTER_API_KEY
 * 3. Temp Sonnet session     - reliable (~8-10s), uses OAuth credentials
 * 4. Local fallback          - instant, uses Title Case truncation
 */
export async function generateTitle(
  prompt: string,
  config: TitleGeneratorConfig = {}
): Promise<GeneratedTitle> {
  // Method 1: Try claude.ai dust endpoint (fastest)
  const dustResult = await tryDustEndpoint(prompt, config);
  if (dustResult) {
    return { ...dustResult, source: 'dust' };
  }

  // Method 2: Try OpenRouter API (fast)
  const openRouterResult = await tryOpenRouter(prompt, config);
  if (openRouterResult) {
    return { ...openRouterResult, source: 'openrouter' };
  }

  // Method 3: Try temp Sonnet session (reliable but slower)
  const sessionResult = await trySonnetSession(prompt, config);
  if (sessionResult) {
    return { ...sessionResult, source: 'session' };
  }

  // Method 4: Local fallback (instant)
  return { ...generateTitleLocal(prompt), source: 'fallback' };
}

/**
 * Quick synchronous title generation (fallback only)
 * Use this when you need immediate title without async
 */
export function generateTitleSync(prompt: string): { title: string; branch_name: string } {
  return generateTitleLocal(prompt);
}
