#!/usr/bin/env node
// Claude Web CLI - Pure HTTPS
//
// Usage:
//   claude-session "prompt"                      - Create new session and run prompt
//   claude-session archive <session_id>          - Archive a session
//   claude-session rename <session_id> <name>    - Rename a session
//   claude-session resume <session_id> "prompt"  - Resume session with new prompt
//   claude-session status <session_id>           - Get session status
//   claude-session events <session_id>           - Get session events

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// Load .env file if present (no dependencies)
function loadEnv() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}
loadEnv();

// Detect git remote URL from current directory
function detectGitUrl() {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    // Convert SSH URLs to HTTPS
    if (remoteUrl.startsWith('git@github.com:')) {
      return remoteUrl.replace('git@github.com:', 'https://github.com/').replace(/\.git$/, '');
    }
    // Remove .git suffix if present
    return remoteUrl.replace(/\.git$/, '');
  } catch {
    return null;
  }
}

// Configuration
const BASE_URL = 'https://api.anthropic.com';
const CLAUDE_AI_URL = 'https://claude.ai';
const gitUrl = process.env.CLAUDE_GIT_URL || detectGitUrl();
const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5-20251101';

// Known models available for Claude Code remote sessions
// Note: No dynamic API endpoint found for model listing - these are based on observed usage
const KNOWN_MODELS = [
  { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'Most capable model, best for complex tasks' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', description: 'Balanced performance and speed' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Fast and efficient' },
  { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5', description: 'Fastest model, good for simple tasks' },
];

// Fetch environments from claude.ai (requires org UUID)
async function fetchEnvironments(accessToken, orgUuid) {
  if (!orgUuid) return [];
  const url = `${CLAUDE_AI_URL}/v1/environment_providers/private/organizations/${orgUuid}/environments`;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'anthropic-client-platform': 'claude-session-cli',
        'anthropic-client-version': '1.0.0',
      }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.environments || [];
  } catch {
    return [];
  }
}

// Get environment ID from recent sessions (fallback)
async function getEnvironmentIdFromSessions(accessToken, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions?limit=1`, {
    headers: buildHeaders(accessToken, orgUuid)
  });
  if (!response.ok) return null;
  const data = await response.json();
  const sessions = data.data || [];
  if (sessions.length > 0 && sessions[0].environment_id) {
    return sessions[0].environment_id;
  }
  return null;
}

// Get environment ID - from env var, claude.ai API, or from recent session
async function getEnvironmentId(accessToken, orgUuid) {
  if (process.env.CLAUDE_ENVIRONMENT_ID) {
    return process.env.CLAUDE_ENVIRONMENT_ID;
  }

  // Try claude.ai environments API first
  const environments = await fetchEnvironments(accessToken, orgUuid);
  if (environments.length > 0) {
    // Prefer environment with "Default" in name, otherwise use first active one
    const defaultEnv = environments.find(e =>
      e.name?.toLowerCase().includes('default') && e.state === 'active'
    );
    const activeEnv = environments.find(e => e.state === 'active');
    const selected = defaultEnv || activeEnv || environments[0];
    emit({ type: 'info', message: `Using environment: ${selected.name} (${selected.environment_id})` });
    return selected.environment_id;
  }

  // Fallback: get from an existing session
  const envFromSession = await getEnvironmentIdFromSessions(accessToken, orgUuid);
  if (envFromSession) {
    emit({ type: 'info', message: `Using environment from recent session: ${envFromSession}` });
    return envFromSession;
  }

  throw new Error('No environment found. Set CLAUDE_ENVIRONMENT_ID or create a session at claude.ai/code first.');
}

// Read credentials from macOS Keychain
function getCredentialsFromKeychain() {
  if (process.platform !== 'darwin') return null;
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// Read credentials (Keychain on macOS, file elsewhere)
function getCredentials() {
  // Try Keychain first (macOS)
  const keychainCreds = getCredentialsFromKeychain();
  if (keychainCreds?.claudeAiOauth?.accessToken) {
    return {
      accessToken: keychainCreds.claudeAiOauth.accessToken,
      expiresAt: keychainCreds.claudeAiOauth.expiresAt,
    };
  }

  // Fall back to file (Linux/Windows or if Keychain fails)
  const credPath = join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(credPath)) {
    throw new Error('No OAuth credentials found. Run "claude login" first.');
  }
  const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
  if (!creds.claudeAiOauth?.accessToken) {
    throw new Error('No OAuth credentials found. Run "claude login" first.');
  }
  return {
    accessToken: creds.claudeAiOauth.accessToken,
    expiresAt: creds.claudeAiOauth.expiresAt,
  };
}

// Get organization UUID
function getOrgUuid() {
  if (process.env.CLAUDE_ORG_UUID) return process.env.CLAUDE_ORG_UUID;
  // Try Keychain first (macOS)
  const keychainCreds = getCredentialsFromKeychain();
  if (keychainCreds?.oauthAccount?.organizationUuid) {
    return keychainCreds.oauthAccount.organizationUuid;
  }
  // Try credentials file
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
    if (creds.oauthAccount?.organizationUuid) return creds.oauthAccount.organizationUuid;
  } catch {}
  try {
    const statsigDir = join(homedir(), '.claude', 'statsig');
    const files = readdirSync(statsigDir);
    for (const file of files) {
      if (file.startsWith('statsig.cached.evaluations')) {
        const content = readFileSync(join(statsigDir, file), 'utf-8');
        const match = content.match(/"organizationUUID":"([^"]+)"/);
        if (match) return match[1];
      }
    }
  } catch {}
  return null;
}

// Build headers
function buildHeaders(accessToken, orgUuid = null) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'ccr-byoc-2025-07-29',
    'Content-Type': 'application/json',
  };
  if (orgUuid) headers['x-organization-uuid'] = orgUuid;
  return headers;
}

// Emit JSONL
function emit(event) {
  console.log(JSON.stringify(event));
}

// Debug logging (only outputs when DEBUG env var is set)
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
function debugLog(message, context = {}) {
  if (DEBUG) {
    console.error(`[DEBUG] ${message}`, JSON.stringify(context));
  }
}

// === Title Generation ===
// Four methods with fallback chain:
// 1. claude.ai dust endpoint (fastest, ~1s, requires browser cookies)
// 2. OpenRouter API (fast, ~1-2s, requires OPENROUTER_API_KEY)
// 3. Temp Sonnet session via API (reliable, ~8-10s, uses OAuth)
// 4. Local fallback (instant, uses Title Case truncation)

// Generate branch name from title (used by all methods)
function generateBranchFromTitle(title) {
  const words = title.slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-');
  return `claude/${words || 'session'}`;
}

// Method 4: Local fallback - convert prompt to Title Case
function generateTitleLocal(prompt) {
  // Clean and truncate prompt
  const cleaned = prompt.slice(0, 50).replace(/\n/g, ' ').trim();

  // Convert to Title Case
  return cleaned
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Method 1: claude.ai dust endpoint (requires cookies from env) - returns { title, branch_name }
async function generateTitleViaDust(prompt, orgUuid) {
  const cookies = process.env.CLAUDE_COOKIES;
  if (!cookies) return null;

  const url = `${CLAUDE_AI_URL}/api/organizations/${orgUuid}/dust/generate_title_and_branch`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': CLAUDE_AI_URL,
        'Referer': `${CLAUDE_AI_URL}/code`,
        'anthropic-client-platform': 'web_claude_ai',
        'anthropic-client-version': '1.0.0',
      },
      body: JSON.stringify({ first_session_message: prompt })
    });

    if (!response.ok) return null;

    const data = await response.json();
    // dust endpoint returns { title, branch_name } directly
    if (data.title && data.branch_name) {
      return { title: data.title, branch_name: data.branch_name };
    }
    return null;
  } catch {
    return null;
  }
}

// Method 2: OpenRouter API (uses google/gemini-3-flash-preview) - returns { title, branch_name }
async function generateTitleViaOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const titlePrompt = `Generate a title and git branch name for this coding request. Respond with ONLY valid JSON, no other text:
{"title": "Short descriptive title", "branch_name": "claude/kebab-case-branch"}

Rules:
- Title: 3-6 words, concise, sentence case
- Branch: starts with "claude/", kebab-case, 2-4 words after prefix

Request: "${prompt}"`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'user', content: titlePrompt }],
        max_tokens: 100,
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      // Try to parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*?"title"[\s\S]*?"branch_name"[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.title && parsed.branch_name) {
            return parsed;
          }
        } catch {}
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Method 3: Create temp Sonnet session via API - returns { title, branch_name }
async function generateTitleViaSession(prompt, accessToken, orgUuid, environmentId) {
  // Use same JSON format as OpenRouter for consistency
  const titlePrompt = `Generate a title and git branch name for this coding request. Respond with ONLY valid JSON, no other text:
{"title": "Short descriptive title", "branch_name": "claude/kebab-case-branch"}

Rules:
- Title: 3-6 words, concise, sentence case
- Branch: starts with "claude/", kebab-case, 2-4 words after prefix

Request: "${prompt}"`;

  const payload = {
    events: [{
      type: 'event',
      data: {
        uuid: randomUUID(),
        session_id: '',
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: titlePrompt }
      }
    }],
    environment_id: environmentId,
    session_context: { model: 'claude-sonnet-4-20250514' }
  };

  try {
    // Create session
    const createRes = await fetch(`${BASE_URL}/v1/sessions`, {
      method: 'POST',
      headers: buildHeaders(accessToken, orgUuid),
      body: JSON.stringify(payload)
    });

    if (!createRes.ok) return null;
    const session = await createRes.json();

    // Poll for completion (max 60 seconds)
    for (let i = 0; i < 30; i++) {
      const statusRes = await fetch(`${BASE_URL}/v1/sessions/${session.id}`, {
        headers: buildHeaders(accessToken, orgUuid)
      });
      const status = await statusRes.json();

      if (status.session_status === 'idle' || status.session_status === 'completed') {
        // Get events and extract response
        const eventsRes = await fetch(`${BASE_URL}/v1/sessions/${session.id}/events`, {
          headers: buildHeaders(accessToken, orgUuid)
        });
        const events = await eventsRes.json();

        let result = null;
        for (const event of (events.data || [])) {
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                // Parse JSON from response (same logic as OpenRouter)
                const jsonMatch = block.text.match(/\{[\s\S]*?"title"[\s\S]*?"branch_name"[\s\S]*?\}/);
                if (jsonMatch) {
                  try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.title && parsed.branch_name) {
                      result = parsed;
                    }
                  } catch {}
                }
              }
            }
          }
        }

        // Archive the temp session (fire-and-forget with debug logging)
        fetch(`${BASE_URL}/v1/sessions/${session.id}/archive`, {
          method: 'POST',
          headers: buildHeaders(accessToken, orgUuid),
          body: JSON.stringify({})
        }).catch((error) => {
          debugLog('Failed to archive temp title generation session', {
            sessionId: session.id,
            error: error.message || String(error),
          });
        });

        return result;
      }

      if (status.session_status === 'failed') {
        // Archive and return null (fire-and-forget with debug logging)
        fetch(`${BASE_URL}/v1/sessions/${session.id}/archive`, {
          method: 'POST',
          headers: buildHeaders(accessToken, orgUuid),
          body: JSON.stringify({})
        }).catch((error) => {
          debugLog('Failed to archive temp title generation session after failure', {
            sessionId: session.id,
            error: error.message || String(error),
          });
        });
        return null;
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    // Timeout - archive and return null (fire-and-forget with debug logging)
    fetch(`${BASE_URL}/v1/sessions/${session.id}/archive`, {
      method: 'POST',
      headers: buildHeaders(accessToken, orgUuid),
      body: JSON.stringify({})
    }).catch((error) => {
      debugLog('Failed to archive temp title generation session after timeout', {
        sessionId: session.id,
        error: error.message || String(error),
      });
    });

    return null;
  } catch {
    return null;
  }
}

// Main function: try all four methods in order, returns { title, branch_name }
async function generateTitleAndBranch(prompt, accessToken, orgUuid, environmentId) {
  let result = null;

  // Method 1: Try claude.ai dust endpoint (fastest) - returns { title, branch_name }
  if (orgUuid) {
    emit({ type: 'title_generation', method: 'dust', status: 'trying' });
    result = await generateTitleViaDust(prompt, orgUuid);
    if (result) {
      emit({ type: 'title_generation', method: 'dust', status: 'success', ...result });
    } else {
      emit({ type: 'title_generation', method: 'dust', status: 'failed' });
    }
  }

  // Method 2: Try OpenRouter API (fast) - returns { title, branch_name }
  if (!result) {
    emit({ type: 'title_generation', method: 'openrouter', status: 'trying' });
    result = await generateTitleViaOpenRouter(prompt);
    if (result) {
      emit({ type: 'title_generation', method: 'openrouter', status: 'success', ...result });
    } else {
      emit({ type: 'title_generation', method: 'openrouter', status: 'failed' });
    }
  }

  // Method 3: Try temp Sonnet session (reliable but slower) - returns { title, branch_name }
  if (!result && accessToken && environmentId) {
    emit({ type: 'title_generation', method: 'session', status: 'trying' });
    result = await generateTitleViaSession(prompt, accessToken, orgUuid, environmentId);
    if (result) {
      emit({ type: 'title_generation', method: 'session', status: 'success', ...result });
    } else {
      emit({ type: 'title_generation', method: 'session', status: 'failed' });
    }
  }

  // Method 4: Local fallback (instant)
  if (!result) {
    emit({ type: 'title_generation', method: 'local', status: 'using' });
    const localTitle = generateTitleLocal(prompt);
    result = { title: localTitle, branch_name: generateBranchFromTitle(localTitle) };
    emit({ type: 'title_generation', method: 'local', status: 'success', ...result });
  }

  return result;
}

// === API Functions ===

async function createSession(accessToken, orgUuid, prompt, environmentId, titleInfo = null) {
  const eventUuid = randomUUID();

  // Use provided titleInfo or generate locally as fallback
  const title = titleInfo?.title || generateTitleLocal(prompt);
  const branchPrefix = titleInfo?.branch_name || generateBranchFromTitle(title);

  const repoMatch = gitUrl.match(/github\.com\/([^\/]+\/[^\/]+)/);
  const repoName = repoMatch ? repoMatch[1].replace(/\.git$/, '') : 'unknown/repo';

  const payload = {
    title,
    events: [{
      type: 'event',
      data: {
        uuid: eventUuid,
        session_id: '',
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt }
      }
    }],
    environment_id: environmentId,
    session_context: {
      sources: [{ type: 'git_repository', url: gitUrl }],
      outcomes: [{ type: 'git_repository', git_info: { type: 'github', repo: repoName, branches: [branchPrefix] } }],
      model
    }
  };

  const response = await fetch(`${BASE_URL}/v1/sessions`, {
    method: 'POST',
    headers: buildHeaders(accessToken, orgUuid),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create session: ${response.status} ${text}`);
  }
  return response.json();
}

async function getSession(accessToken, sessionId, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
    headers: buildHeaders(accessToken, orgUuid)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get session: ${response.status} ${text}`);
  }
  return response.json();
}

async function listSessions(accessToken, orgUuid, limit = 20, before = null) {
  const url = new URL(`${BASE_URL}/v1/sessions`);
  url.searchParams.set('limit', limit);
  if (before) url.searchParams.set('before', before);
  const response = await fetch(url, {
    headers: buildHeaders(accessToken, orgUuid)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list sessions: ${response.status} ${text}`);
  }
  return response.json();
}

async function getEvents(accessToken, sessionId, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/events`, {
    headers: buildHeaders(accessToken, orgUuid)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get events: ${response.status} ${text}`);
  }
  return response.json();
}

async function archiveSession(accessToken, sessionId, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: buildHeaders(accessToken, orgUuid),
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to archive: ${response.status} ${text}`);
  }
  return response.json();
}

async function renameSession(accessToken, sessionId, newTitle, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: buildHeaders(accessToken, orgUuid),
    body: JSON.stringify({ title: newTitle })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to rename: ${response.status} ${text}`);
  }
  return response.json();
}

async function sendMessage(accessToken, sessionId, message, orgUuid) {
  const payload = {
    events: [{
      type: 'user',
      uuid: randomUUID(),
      session_id: sessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: message }
    }]
  };
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: buildHeaders(accessToken, orgUuid),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to send message: ${response.status} ${text}`);
  }
  return response.json();
}

// Interrupt a session via WebSocket connection
// Uses the same format as claude.ai website:
// {"request_id":"xxx","type":"control_request","request":{"subtype":"interrupt"}}
async function interruptSessionWebSocket(accessToken, sessionId, orgUuid, abortOnly = false) {
  const WebSocket = (await import('ws')).default;

  const wsUrl = `wss://api.anthropic.com/v1/sessions/ws/${sessionId}/subscribe${orgUuid ? `?organization_uuid=${orgUuid}` : ''}`;

  emit({ type: 'ws_connecting', url: wsUrl, method: abortOnly ? 'abort_close' : 'control_request' });

  // Generate short random request ID like claude.ai does
  const generateRequestId = () => Math.random().toString(36).substring(2, 15);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'ccr-byoc-2025-07-29',
      }
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('WebSocket interrupt timed out after 10 seconds'));
      }
    }, 10000);

    ws.on('open', () => {
      emit({ type: 'ws_connected', sessionId });

      if (abortOnly) {
        // Abort approach: just close the connection immediately
        emit({ type: 'ws_aborting', message: 'Closing connection to abort session' });
        ws.close(1000, 'Client requested abort');
      } else {
        // Send interrupt using claude.ai format:
        // {"request_id":"xxx","type":"control_request","request":{"subtype":"interrupt"}}
        const interruptMsg = JSON.stringify({
          request_id: generateRequestId(),
          type: 'control_request',
          request: { subtype: 'interrupt' }
        });

        emit({ type: 'ws_sending', message: interruptMsg });
        ws.send(interruptMsg + '\n');  // claude.ai adds newline
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString().trim());
        emit({ type: 'ws_message', message: msg });

        // Check for interrupt acknowledgment or session stopped
        // After interrupt, server sends: {"message":{"content":[{"text":"[Request interrupted by user]"...
        if (msg.type === 'control_response' ||
            msg.type === 'result' ||
            (msg.type === 'user' && msg.message?.content?.[0]?.text?.includes('interrupted')) ||
            (msg.type === 'session_status' && msg.status === 'idle')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve({ success: true, response: msg });
          }
        }
      } catch (e) {
        emit({ type: 'ws_parse_error', error: e.message, raw: data.toString() });
      }
    });

    ws.on('error', (error) => {
      emit({ type: 'ws_error', error: error.message });
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(error);
      }
    });

    ws.on('close', (code, reason) => {
      emit({ type: 'ws_closed', code, reason: reason?.toString() });
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ success: true, method: 'connection_closed', code });
      }
    });
  });
}

// Fallback: Interrupt via HTTP (may corrupt session state - use WebSocket first)
async function interruptSessionHTTP(accessToken, sessionId, orgUuid) {
  const response = await fetch(`${BASE_URL}/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: buildHeaders(accessToken, orgUuid),
    body: JSON.stringify({
      events: [{
        type: 'control_request',
        action: 'interrupt',
        uuid: randomUUID()
      }]
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to interrupt session: ${response.status} ${text}`);
  }
  return response.json();
}

// Extract branch name from events
function extractBranchName(events) {
  for (const event of events) {
    if (event.tool_use_result?.stdout) {
      const match = event.tool_use_result.stdout.match(/claude\/[a-zA-Z0-9_-]+/);
      if (match) return match[0];
    }
    if (event.data?.extra?.args) {
      const argsStr = event.data.extra.args.join(' ');
      const match = argsStr.match(/branch `(claude\/[a-zA-Z0-9_-]+)`/);
      if (match) return match[1];
    }
  }
  return null;
}

// Poll session until completion
// options.skipExistingEvents: if true, first fetch all existing events and mark them as seen (for resume)
async function pollSession(accessToken, sessionId, orgUuid, options = {}) {
  const { skipExistingEvents = false } = options;
  let seenEventIds = new Set();
  let pollCount = 0;
  const pollIntervalMs = 2000;
  const maxPolls = 300;
  let title = null;
  let branch = null;
  let emittedInfo = false;

  // For resume: mark all existing events as seen so we only wait for NEW result
  if (skipExistingEvents) {
    try {
      const existingEvents = await getEvents(accessToken, sessionId, orgUuid);
      for (const event of existingEvents.data || []) {
        seenEventIds.add(event.uuid);
      }
      emit({ type: 'info', message: `Skipping ${seenEventIds.size} existing events, waiting for new result...` });
    } catch (error) {
      emit({ type: 'warning', message: `Could not fetch existing events: ${error.message}` });
    }
  }

  emit({ type: 'status', status: 'polling', sessionId });

  while (pollCount < maxPolls) {
    try {
      const session = await getSession(accessToken, sessionId, orgUuid);
      if (session.title && session.title !== title) title = session.title;

      emit({
        type: 'session_status',
        status: session.session_status,
        title: session.title,
        updatedAt: session.updated_at
      });

      const eventsResponse = await getEvents(accessToken, sessionId, orgUuid);
      const events = eventsResponse.data || [];

      if (!branch) branch = extractBranchName(events);
      if (!emittedInfo && title && branch) {
        emit({ type: 'session_info', title, branch, sessionId });
        emittedInfo = true;
      }

      for (const event of events) {
        if (!seenEventIds.has(event.uuid)) {
          seenEventIds.add(event.uuid);
          emit({ type: 'event', event });

          if (event.type === 'result') {
            emit({
              type: 'complete',
              result: event.result,
              totalCost: event.total_cost_usd,
              duration: event.duration_ms,
              turns: event.num_turns,
              title,
              branch
            });
            return;
          }
        }
      }

      if (session.session_status === 'completed' || session.session_status === 'failed') {
        emit({ type: 'status', status: session.session_status });
        return;
      }

      // For resume: also exit if session goes idle (no more work to do)
      if (skipExistingEvents && session.session_status === 'idle') {
        emit({ type: 'status', status: 'idle', message: 'Session is idle, resume complete' });
        return;
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
      pollCount++;
    } catch (error) {
      emit({ type: 'error', error: error.message });
      await new Promise(r => setTimeout(r, pollIntervalMs));
      pollCount++;
    }
  }
  emit({ type: 'timeout', message: 'Max polling time exceeded' });
}

// === Commands ===

async function cmdCreate(prompt) {
  const creds = getCredentials();
  if (Date.now() >= creds.expiresAt) {
    emit({ type: 'error', error: 'Token expired. Run "claude login" to refresh.' });
    process.exit(1);
  }
  if (!gitUrl) {
    emit({ type: 'error', error: 'No git URL found. Set CLAUDE_GIT_URL or run from a git repository.' });
    process.exit(1);
  }
  const orgUuid = getOrgUuid();
  const environmentId = await getEnvironmentId(creds.accessToken, orgUuid);

  emit({ type: 'status', status: 'starting', prompt });
  emit({ type: 'config', environmentId, gitUrl, model, hasOrgUuid: !!orgUuid });

  // Generate title and branch using fallback chain
  const titleInfo = await generateTitleAndBranch(prompt, creds.accessToken, orgUuid, environmentId);

  const session = await createSession(creds.accessToken, orgUuid, prompt, environmentId, titleInfo);
  emit({
    type: 'session_created',
    sessionId: session.id,
    environmentId: session.environment_id,
    title: titleInfo.title,
    branch: titleInfo.branch_name,
    webUrl: `https://claude.ai/code/${session.id}`
  });

  await pollSession(creds.accessToken, session.id, orgUuid);
}

async function cmdArchive(sessionId) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const session = await archiveSession(creds.accessToken, sessionId, orgUuid);
  emit({
    type: 'archived',
    sessionId: session.id,
    status: session.session_status,
    title: session.title
  });
}

async function cmdRename(sessionId, newTitle) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const session = await renameSession(creds.accessToken, sessionId, newTitle, orgUuid);
  emit({
    type: 'renamed',
    sessionId: session.id,
    title: session.title
  });
}

async function cmdResume(sessionId, prompt) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();

  emit({ type: 'status', status: 'resuming', sessionId, prompt });

  // Send message via HTTP and poll for results
  // Use skipExistingEvents=true so we wait for a NEW result, not exit on old ones
  await sendMessage(creds.accessToken, sessionId, prompt, orgUuid);
  emit({ type: 'message_sent', sessionId });
  await pollSession(creds.accessToken, sessionId, orgUuid, { skipExistingEvents: true });
}

async function cmdInterrupt(sessionId, options = {}) {
  const { useHttp = false, abortOnly = false } = options;
  const creds = getCredentials();
  const orgUuid = getOrgUuid();

  const method = useHttp ? 'http' : (abortOnly ? 'websocket_abort' : 'websocket_control');
  emit({ type: 'status', status: 'interrupting', sessionId, method });

  try {
    if (useHttp) {
      // HTTP method (may corrupt session state - use for testing only)
      const result = await interruptSessionHTTP(creds.accessToken, sessionId, orgUuid);
      emit({
        type: 'interrupt_sent',
        method: 'http',
        sessionId,
        events: result.events
      });
    } else {
      // WebSocket method
      // abortOnly=true: just close connection (like SDK AbortController)
      // abortOnly=false: send control_request interrupt message
      const result = await interruptSessionWebSocket(creds.accessToken, sessionId, orgUuid, abortOnly);
      emit({
        type: 'interrupt_sent',
        method: abortOnly ? 'websocket_abort' : 'websocket_control',
        sessionId,
        result
      });
    }
  } catch (error) {
    emit({ type: 'interrupt_error', error: error.message });
    // Don't rethrow - still check status below
  }

  // Wait briefly for the interrupt to propagate and check the session status
  await new Promise(r => setTimeout(r, 2000));
  const session = await getSession(creds.accessToken, sessionId, orgUuid);
  emit({
    type: 'interrupted',
    sessionId: session.id,
    status: session.session_status,
    title: session.title
  });
}

async function cmdStatus(sessionId) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const session = await getSession(creds.accessToken, sessionId, orgUuid);
  emit({
    type: 'status_result',
    sessionId: session.id,
    status: session.session_status,
    title: session.title,
    environmentId: session.environment_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    model: session.session_context?.model
  });
}

async function cmdEvents(sessionId) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const eventsResponse = await getEvents(creds.accessToken, sessionId, orgUuid);
  for (const event of eventsResponse.data || []) {
    emit({ type: 'event', event });
  }
}

async function cmdList(limit = 20, before = null) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const response = await listSessions(creds.accessToken, orgUuid, limit, before);
  for (const session of response.data || []) {
    emit({
      type: 'session',
      sessionId: session.id,
      status: session.session_status,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at
    });
  }
  emit({
    type: 'list_complete',
    count: (response.data || []).length,
    hasMore: response.has_more,
    lastId: response.last_id
  });
}

async function cmdModels() {
  const currentModel = process.env.CLAUDE_MODEL || 'claude-opus-4-5-20251101';
  for (const m of KNOWN_MODELS) {
    emit({
      type: 'model',
      id: m.id,
      name: m.name,
      description: m.description,
      current: m.id === currentModel
    });
  }
  emit({
    type: 'models_complete',
    count: KNOWN_MODELS.length,
    current: currentModel,
    note: 'Set CLAUDE_MODEL environment variable to use a different model'
  });
}

async function cmdGenerateTitle(prompt) {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();
  const environmentId = await getEnvironmentId(creds.accessToken, orgUuid);

  const result = await generateTitleAndBranch(prompt, creds.accessToken, orgUuid, environmentId);
  emit({
    type: 'title_result',
    title: result.title,
    branch_name: result.branch_name
  });
}

async function cmdListEnvs() {
  const creds = getCredentials();
  const orgUuid = getOrgUuid();

  // Try claude.ai environments API first
  const environments = await fetchEnvironments(creds.accessToken, orgUuid);
  if (environments.length > 0) {
    for (const env of environments) {
      emit({
        type: 'environment',
        environmentId: env.environment_id,
        name: env.name,
        kind: env.kind,
        state: env.state,
        createdAt: env.created_at
      });
    }
    emit({ type: 'envs_complete', count: environments.length });
    return;
  }

  // Fallback: get unique environment IDs from sessions
  const response = await listSessions(creds.accessToken, orgUuid, 100);
  const envIds = new Set();
  for (const session of response.data || []) {
    if (session.environment_id) {
      envIds.add(session.environment_id);
    }
  }

  for (const envId of envIds) {
    emit({
      type: 'environment',
      environmentId: envId
    });
  }
  emit({
    type: 'envs_complete',
    count: envIds.size,
    note: 'Environment IDs extracted from recent sessions. For full environment details, visit claude.ai/code'
  });
}

// === Main ===

function printUsage() {
  console.error(`Claude Web CLI

Usage:
  claude-session "prompt"                      Create new session and run prompt
  claude-session generate-title "prompt"       Generate title and branch name only
  claude-session list [limit] [before_id]      List sessions (default: 20, use lastId for pagination)
  claude-session envs                          List available environments
  claude-session models                        List available models
  claude-session archive <session_id>          Archive a session
  claude-session rename <session_id> <name>    Rename a session
  claude-session resume <session_id> "prompt"  Resume session with new prompt
  claude-session interrupt <session_id>        Interrupt a running session
  claude-session status <session_id>           Get session status
  claude-session events <session_id>           Get session events

Environment Variables:
  CLAUDE_ENVIRONMENT_ID  Environment ID (auto-detected if not set)
  CLAUDE_GIT_URL         Git repository URL (auto-detected from git remote)
  CLAUDE_MODEL           Model (default: claude-opus-4-5-20251101)
  CLAUDE_ORG_UUID        Organization UUID (optional, auto-detected)
  CLAUDE_COOKIES         Browser cookies for claude.ai (enables fast title generation)
  OPENROUTER_API_KEY     OpenRouter API key (enables fast title generation via Gemini)

Title Generation Methods (in order of preference):
  1. claude.ai dust endpoint - fastest (~1s), requires CLAUDE_COOKIES
  2. OpenRouter API          - fast (~1-2s), requires OPENROUTER_API_KEY
  3. Temp Sonnet session     - reliable (~8-10s), uses OAuth credentials
  4. Local fallback          - instant, uses Title Case truncation

Output: JSONL (one JSON object per line)`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'list':
        await cmdList(
          args[1] ? parseInt(args[1], 10) : 20,
          args[2] || null
        );
        break;

      case 'envs':
      case 'environments':
        await cmdListEnvs();
        break;

      case 'models':
        await cmdModels();
        break;

      case 'generate-title':
      case 'title':
        if (!args[1]) throw new Error('Usage: generate-title "prompt"');
        await cmdGenerateTitle(args.slice(1).join(' '));
        break;

      case 'archive':
        if (!args[1]) throw new Error('Missing session_id');
        await cmdArchive(args[1]);
        break;

      case 'rename':
        if (!args[1] || !args[2]) throw new Error('Usage: rename <session_id> <new_name>');
        await cmdRename(args[1], args.slice(2).join(' '));
        break;

      case 'resume':
        if (!args[1] || !args[2]) throw new Error('Usage: resume <session_id> "prompt"');
        await cmdResume(args[1], args.slice(2).join(' '));
        break;

      case 'status':
        if (!args[1]) throw new Error('Missing session_id');
        await cmdStatus(args[1]);
        break;

      case 'events':
        if (!args[1]) throw new Error('Missing session_id');
        await cmdEvents(args[1]);
        break;

      case 'interrupt':
        if (!args[1]) throw new Error('Missing session_id');
        // Check for flags:
        // --http: use legacy HTTP method (may corrupt session)
        // --abort: use WebSocket abort (close connection without sending control_request)
        const useHttp = args.includes('--http');
        const abortOnly = args.includes('--abort');
        const interruptSessionId = args.find(a => a.startsWith('session_'));
        await cmdInterrupt(interruptSessionId || args[1], { useHttp, abortOnly });
        break;

      case 'help':
      case '--help':
      case '-h':
        printUsage();
        break;

      default:
        // Treat as prompt for new session
        await cmdCreate(args.join(' '));
    }
  } catch (error) {
    emit({ type: 'error', error: error.message });
    process.exit(1);
  }
}

main();
