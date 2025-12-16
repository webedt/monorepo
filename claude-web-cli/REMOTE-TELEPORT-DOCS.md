# Claude Web CLI - Remote and Teleport Documentation

This document captures everything known about the `claude --remote` and `claude --teleport` features based on code exploration and experimentation.

> **Status**: These features appear to be internal/experimental and are NOT documented in the public CLI help (`claude --help`). They may change or be removed at any time.

## Overview

The `--remote` and `--teleport` flags enable a cloud-based session execution model where:
1. **`--remote`**: Starts a Claude session that runs on Anthropic's servers
2. **`--teleport`**: Syncs/connects to an existing remote session from a local machine

This allows Claude to work on tasks in the background without requiring an open terminal.

## Command Syntax

```bash
# Start a new remote session
claude --remote "<prompt>"

# Connect to an existing remote session
claude --teleport <session_id>
```

### Session ID Format
Session IDs follow the pattern: `session_[alphanumeric]`
Example: `session_01S7DYYtwgMZ3gbAmjMmMpnA`

### TTY Requirement

The `--remote` flag requires a proper pseudo-TTY. When running from scripts or non-interactive terminals, use the `script` command:

```bash
# macOS/Linux - wrap with script to provide TTY
script -q /dev/null claude --remote "Your prompt here"
```

**Example Output:**
```
Created remote session: Create hello.txt with greeting message
View: https://claude.ai/code/session_01S7DYYtwgMZ3gbAmjMmMpnA?m=0
Resume with: claude --teleport session_01S7DYYtwgMZ3gbAmjMmMpnA
```

The output includes:
1. **Session title** - Auto-generated from your prompt
2. **Web URL** - View the session in claude.ai
3. **Resume command** - CLI command to reconnect

## How It Works

### Starting a Remote Session

When you run `claude --remote "your prompt"`:

1. Claude starts a session on Anthropic's cloud infrastructure
2. The command outputs the session ID in the format: `claude --teleport session_XXXX`
3. The session continues executing on the server even after the local command exits
4. Session state is synced to `~/.claude/projects/` as JSONL files

### Teleporting to a Session

When you run `claude --teleport session_XXXX`:

1. Claude connects to the running/completed remote session
2. Local JSONL files are updated with the session's messages
3. You enter an interactive mode to continue the conversation
4. Press Ctrl+C to exit without terminating the session

## File System Structure

### Session Files Location
```
~/.claude/projects/<escaped-path>/
```

The path is escaped by replacing `/` and `.` with `-`. For example:
- `/Users/etgarcia/code/myproject` becomes `-Users-etgarcia-code-myproject`

### JSONL File Format

Session files are stored as JSONL (JSON Lines) with one message per line:

```json
{"type": "user", "message": {"role": "user", "content": "Create a hello world script"}}
{"type": "assistant", "message": {"role": "assistant", "content": [...], "stop_reason": "end_turn"}}
{"type": "summary", "summary": "Session summary text"}
```

### Message Types

| Type | Description |
|------|-------------|
| `user` | User input messages |
| `assistant` | Claude's responses with `content` array |
| `summary` | Session summaries |
| `file-history-snapshot` | File state snapshots |

### Content Block Types (in assistant messages)

| Block Type | Description |
|------------|-------------|
| `thinking` | Extended thinking content |
| `text` | Text responses |
| `tool_use` | Tool invocations |

### Completion Detection

A session is complete when an assistant message has `stop_reason: "end_turn"`.

## API Endpoints

These HTTP endpoints exist for session management (verified working):

### Endpoint Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/sessions` | List sessions |
| `POST` | `/v1/sessions` | Create new session |
| `GET` | `/v1/sessions/{id}` | Get session metadata |
| `PATCH` | `/v1/sessions/{id}` | Rename session (update title) |
| `GET` | `/v1/sessions/{id}/events` | Get session events |
| `POST` | `/v1/sessions/{id}/events` | Send user message or control_request (interrupt) |
| `POST` | `/v1/sessions/{id}/archive` | Archive session |
| `WSS` | `/v1/sessions/ws/{id}/subscribe` | Real-time event stream (includes interrupt) |
| `GET` | `/v1/environment_providers/private/organizations/{org}/environments` | List environments |

**Base URLs:**
- `https://api.anthropic.com` - Primary API
- `https://claude.ai` - Web interface (same endpoints)

### Session Metadata
```
GET https://api.anthropic.com/v1/sessions/{session_id}
```

**Example Response:**
```json
{
  "created_at": "2025-12-15T13:36:45.258606Z",
  "environment_id": "env_011CUubbAJQDeejWqiLomwqf",
  "id": "session_01S7DYYtwgMZ3gbAmjMmMpnA",
  "session_context": {
    "allowed_tools": [],
    "cwd": "",
    "disallowed_tools": [],
    "model": "claude-opus-4-5-20251101",
    "outcomes": [
      {
        "git_info": {
          "branches": ["claude/create-hello-file-dp31K"],
          "repo": "ETdoFresh/claude-web-cli",
          "type": "github"
        },
        "type": "git_repository"
      }
    ],
    "sources": [
      {
        "type": "git_repository",
        "url": "https://github.com/ETdoFresh/claude-web-cli"
      }
    ]
  },
  "session_status": "idle",
  "title": "Create hello.txt with greeting message",
  "type": "internal_session",
  "updated_at": "2025-12-15T13:37:20.650666Z"
}
```

**Session Status Values:**
- `idle` - Session is not actively processing
- `running` - Session is currently executing
- `completed` - Session has finished

### Session Events
```
GET https://api.anthropic.com/v1/sessions/{session_id}/events
```

Returns paginated events for the session.

**Response Structure:**
```json
{
  "data": [ /* array of events */ ],
  "first_id": "uuid",
  "last_id": "uuid",
  "has_more": false
}
```

**Event Types (for POST /events):**

Valid types for sending events: `assistant`, `auth`, `control_request`, `control_response`, `env_manager_log`, `keep_alive`, `result`, `stream_event`, `system`, `tool_progress`, `user`

| Type | Description |
|------|-------------|
| `env_manager_log` | Environment initialization logs |
| `system` | System init with tools, agents, model info |
| `user` | User messages (including tool results) |
| `assistant` | Claude's responses with content blocks |
| `tool_progress` | Progress updates for long-running tools |
| `result` | Final result with cost/usage summary |
| `control_request` | Control commands like interrupt (action: "interrupt") |
| `control_response` | Response to control requests |

**Example `result` Event (Final):**
```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 27290,
  "duration_api_ms": 26663,
  "num_turns": 4,
  "total_cost_usd": 0.0823255,
  "result": "Done! I've created the hello.txt file...",
  "modelUsage": {
    "claude-opus-4-5-20251101": {
      "inputTokens": 34,
      "outputTokens": 579,
      "cacheCreationInputTokens": 4654,
      "cacheReadInputTokens": 67014,
      "costUSD": 0.0772395
    }
  }
}
```

### Required Headers
```
Authorization: Bearer <access_token>
anthropic-version: 2023-06-01
x-organization-uuid: <org_uuid>  (optional but recommended)
```

## Authentication

The Sessions API requires OAuth authentication. Standard API keys (`ANTHROPIC_API_KEY`) do not work for remote session management.

### How to Acquire Credentials

Claude Code stores OAuth credentials after you authenticate via:

```bash
claude login
```

This initiates an OAuth flow in your browser and stores the resulting tokens locally.

### Credential Storage Locations

Claude Code stores credentials in one of two locations depending on platform:

#### 1. File-based Storage (Primary)
```
~/.claude/.credentials.json
```

This is the primary storage location on all platforms.

**Full Structure:**
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1765781833271,
    "scopes": [
      "user:inference",
      "user:profile",
      "user:sessions:claude_code"
    ],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_20x"
  }
}
```

**Key Fields:**
| Field | Description |
|-------|-------------|
| `accessToken` | Bearer token for API calls (prefix: `sk-ant-oat01-`) |
| `refreshToken` | Token for refreshing expired access tokens (prefix: `sk-ant-ort01-`) |
| `expiresAt` | Unix timestamp (ms) when access token expires |
| `scopes` | OAuth scopes granted (note `user:sessions:claude_code`) |
| `subscriptionType` | User's subscription tier (e.g., `max`, `pro`) |
| `rateLimitTier` | Rate limiting tier for API calls |

#### 2. macOS Keychain (Secondary/Legacy)
On macOS, Claude Code may also store credentials in the system Keychain:

```bash
# Retrieve from Keychain (if stored there)
security find-generic-password -s "claude-code" -w
```

**Service Name:** `claude-code`

> **Note:** Current versions primarily use file-based storage. Keychain storage may be used as a fallback or for legacy installations.

### Token Types and Prefixes

| Prefix | Type | Description |
|--------|------|-------------|
| `sk-ant-oat01-` | OAuth Access Token | Short-lived token for API authentication |
| `sk-ant-ort01-` | OAuth Refresh Token | Long-lived token for obtaining new access tokens |

### Organization UUID Sources

The org UUID is required for some API calls and can be found from multiple sources (in order of precedence):

1. **Credentials file:** `~/.claude/.credentials.json` → `oauthAccount.organizationUuid`
2. **Statsig cache:** `~/.claude/statsig/statsig.cached.evaluations*` → `evaluated_keys.customIDs.organizationUUID`
3. **Profile API:** `GET https://api.anthropic.com/api/oauth/profile`

### Using the HTTP API Directly

Here's how to authenticate with the Sessions API:

```javascript
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Read credentials from file
function getCredentials() {
  const credPath = join(homedir(), '.claude', '.credentials.json');
  const creds = JSON.parse(readFileSync(credPath, 'utf-8'));

  if (!creds.claudeAiOauth?.accessToken) {
    throw new Error('No OAuth credentials found. Run "claude login" first.');
  }

  return {
    accessToken: creds.claudeAiOauth.accessToken,
    expiresAt: creds.claudeAiOauth.expiresAt,
  };
}

// Build headers for API requests
function buildHeaders(accessToken, orgUuid = null) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  };

  if (orgUuid) {
    headers['x-organization-uuid'] = orgUuid;
  }

  return headers;
}

// Example: Fetch session metadata
async function getSession(sessionId) {
  const { accessToken } = getCredentials();

  const response = await fetch(
    `https://api.anthropic.com/v1/sessions/${sessionId}`,
    { headers: buildHeaders(accessToken) }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
```

### Token Refresh

Access tokens expire (check `expiresAt`). To refresh:

```javascript
async function refreshAccessToken(refreshToken) {
  const response = await fetch('https://api.anthropic.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  return response.json();
}
```

> **Note:** The exact refresh endpoint and parameters may vary. The Claude CLI handles this automatically.

### Required OAuth Scopes

For session management, your OAuth token needs these scopes:
- `user:inference` - Make inference requests
- `user:profile` - Access profile information
- `user:sessions:claude_code` - Manage Claude Code sessions

### Security Considerations

1. **Never commit credentials** - Add `.credentials.json` to `.gitignore`
2. **Token expiration** - Access tokens expire; implement refresh logic for long-running processes
3. **Scope limitations** - OAuth tokens are scoped; they can't do everything an API key can
4. **Organization context** - Include `x-organization-uuid` header for org-specific operations

## Claude Agent SDK Integration

The SDK provides session management functions:

### Resuming Sessions
```javascript
import { unstable_v2_resumeSession, query } from '@anthropic-ai/claude-agent-sdk';

// Using unstable_v2_resumeSession
const session = unstable_v2_resumeSession(sessionId, {
  model: 'claude-opus-4-5-20251101',
});

for await (const message of session.receive()) {
  console.log(message.type);
}

// Using query with resume option
const result = query({
  prompt: '',
  options: {
    resume: sessionId,
    includePartialMessages: true,
  }
});
```

### SDK Options Related to Sessions

| Option | Description |
|--------|-------------|
| `resume` | Session ID to resume |
| `continue` | Continue the most recent conversation |
| `forkSession` | Create a new session ID when resuming |
| `persistSession` | Enable/disable session persistence to disk |
| `resumeSessionAt` | Resume from a specific message UUID |

### Session State in SDK

The SDK maintains internal state including:
- `sessionId` - Current session identifier
- `sessionIngressToken` - Token for session ingress (undefined in public SDK)

## Worktree Integration Pattern

For remote sessions, a common pattern is to use git worktrees to:
1. Isolate remote session work from the main checkout
2. Detect file changes made by the remote session
3. Avoid branch conflicts

### Creating a Worktree
```bash
# Create a detached HEAD worktree
git worktree add --detach ~/.claude-worktrees/remote-<name> HEAD
```

### Completion Detection via Worktree
Monitor `git status --porcelain` in the worktree to detect when files are created/modified.

## Implementation Patterns

### PTY Requirements

The `--remote` and `--teleport` commands require a proper pseudo-TTY. Use `node-pty` instead of regular spawn:

```javascript
import * as pty from 'node-pty';

const ptyProcess = pty.spawn('claude', ['--remote', prompt], {
  name: 'xterm-color',
  cols: 120,
  rows: 30,
  cwd: workingDirectory,
  env: process.env,
});
```

### Polling Pattern

```javascript
const pollSession = async (sessionId) => {
  // 1. Run teleport to sync session
  await runTeleport(sessionId, workingDir);

  // 2. Read new content from JSONL files
  checkSessionFiles(projectPath);

  // 3. Check for completion indicators
  // - stop_reason: "end_turn" in JSONL
  // - session_status: "completed" via API
  // - File changes stabilized in worktree

  // 4. Repeat after interval
  setTimeout(() => pollSession(sessionId), 10000);
};
```

## Creating Sessions via Pure HTTPS (Experimental)

Sessions CAN be created directly via HTTPS without the CLI!

> **Discovery Source**: These endpoints were captured from the claude.ai web interface using HAR (HTTP Archive) inspection.

### API Base URLs

The web interface uses `https://claude.ai` as the base URL, but `https://api.anthropic.com` also works for most endpoints:

| Endpoint | claude.ai | api.anthropic.com |
|----------|-----------|-------------------|
| Sessions | ✅ | ✅ |
| Events | ✅ | ✅ |
| WebSocket | ✅ | ❓ |
| Environments | ✅ | ✅ |

### Step 1: Create Session (Web UI Format)

The web interface uses a more complete payload that includes the initial message:

```
POST https://claude.ai/v1/sessions
```

**Full Payload (from claude.ai web interface):**
```json
{
  "title": "General coding session",
  "events": [{
    "type": "event",
    "data": {
      "uuid": "c2deaa97-c295-445f-84b7-7b26849784ca",
      "session_id": "",
      "type": "user",
      "parent_tool_use_id": null,
      "message": {
        "role": "user",
        "content": "Your prompt here"
      }
    }
  }],
  "environment_id": "env_011CUubbAJQDeejWqiLomwqf",
  "session_context": {
    "sources": [{
      "type": "git_repository",
      "url": "https://github.com/owner/repo"
    }],
    "outcomes": [{
      "type": "git_repository",
      "git_info": {
        "type": "github",
        "repo": "owner/repo",
        "branches": ["claude/general-session"]
      }
    }],
    "model": "claude-opus-4-5-20251101"
  }
}
```

**Key Differences from Simple Payload:**
- `title` - Session title (auto-generated from prompt if omitted)
- `events` - Initial user message embedded in session creation
- `outcomes` - Pre-defines expected git output (branch names, etc.)

**Required Headers:**
```
Authorization: Bearer <access_token>
anthropic-version: 2023-06-01
anthropic-beta: ccr-byoc-2025-07-29
anthropic-client-platform: web_claude_ai
x-organization-uuid: <org_uuid>
Content-Type: application/json
```

### Step 2: Send Additional Messages
```
POST https://claude.ai/v1/sessions/{session_id}/events
```

**Required Payload:**
```json
{
  "events": [{
    "type": "user",
    "uuid": "random-uuid-v4-here",
    "content": "Your follow-up prompt here"
  }]
}
```

### Step 3: Real-time Updates via WebSocket

Instead of polling, you can subscribe to real-time events:

```
wss://claude.ai/v1/sessions/ws/{session_id}/subscribe?organization_uuid={org_uuid}
```

This WebSocket endpoint provides:
- Real-time event streaming
- No polling delay
- Immediate notification of completion

**Connection Headers:**
```
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Version: 13
Origin: https://claude.ai
```

### Step 4: Rename Session

To rename/update a session title:
```
PATCH https://api.anthropic.com/v1/sessions/{session_id}
```

**Payload:**
```json
{
  "title": "New Session Title"
}
```

**Note:** Cannot rename archived sessions (returns 409 Conflict).

### Step 5: Archive Session

To archive a completed session:
```
POST https://api.anthropic.com/v1/sessions/{session_id}/archive
```

**Payload:**
```json
{}
```

### List Environments

Get available environments for your organization:
```
GET https://claude.ai/v1/environment_providers/private/organizations/{org_uuid}/environments
```

**Response:**
```json
{
  "environments": [
    {
      "kind": "anthropic_cloud",
      "environment_id": "env_011CUubbAJQDeejWqiLomwqf",
      "name": "Dokploy Deployer",
      "created_at": "2025-11-08T02:00:50.438919Z",
      "state": "active",
      "config": null
    },
    {
      "kind": "anthropic_cloud",
      "environment_id": "env_011CUkyPqs6xpoQtsfUpGGkx",
      "name": "Default Cloud Environment",
      "created_at": "2025-11-03T12:41:26.134534Z",
      "state": "active",
      "config": null
    }
  ],
  "has_more": false,
  "first_id": "env_011CUubbAJQDeejWqiLomwqf",
  "last_id": "env_011CUkyPqs6xpoQtsfUpGGkx"
}
```

### Beta Headers

The web interface uses these beta headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `anthropic-beta` | `ccr-byoc-2025-07-29` | Claude Code Remote - Bring Your Own Cloud |
| `anthropic-client-platform` | `web_claude_ai` | Identifies client type |
| `anthropic-device-id` | UUID | Device tracking |
| `anthropic-anonymous-id` | `claudeai.v1.{uuid}` | Anonymous user tracking |

### Limitation: Environment Creation
Creating NEW environments requires the beta header `anthropic-beta: environments-2025-11-01`, which is **not yet publicly available**. You must reuse an `environment_id` from a previous CLI-created session or use the web interface.

To get an environment_id:
1. Run `claude --remote "test"` once via CLI
2. Extract `environment_id` from the session metadata via `GET /v1/sessions/{id}`
3. Reuse it for future HTTPS-only sessions

**OR** use the environments list endpoint to see your existing environments.

### Example: Pure HTTPS Session Creation
See `claude-session.mjs` for a working implementation.

```bash
# Create session via HTTPS (requires existing environment_id)
CLAUDE_ENVIRONMENT_ID=env_XXX ./claude-session.mjs "Create hello.txt"
```

## Known Limitations

1. **Not in Public CLI Help**: These flags are not documented in `claude --help`
2. **Requires OAuth**: API key authentication does not work for remote sessions - must use OAuth tokens from `claude login`
3. **PTY Required for CLI**: Cannot use standard stdin/stdout with CLI - requires pseudo-terminal (use `node-pty` or `script -q /dev/null`)
4. **Session Persistence**: Sessions are stored in `~/.claude/projects/` by path
5. **No Direct Streaming**: Must poll for updates rather than receive a stream
6. **Branch Extraction**: Branch name must be extracted from `env_manager_log` events; not directly available in session metadata
7. **Token Refresh Endpoint**: The exact OAuth refresh endpoint is undocumented; the CLI handles refresh automatically
8. **Environment Creation**: Creating new environments via HTTPS requires beta access; must reuse existing environment_id from CLI

## Related Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_DEBUG_LOGS_DIR` | Override debug log location |
| `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` | Timeout for stream close (useful for long MCP calls) |

## Example: Complete Remote Workflow

### Using Claude CLI

```bash
# 1. Start a remote session
claude --remote "Create a Python web scraper for news headlines"
# Output: To continue this session, run: claude --teleport session_01PjXXX

# 2. Check on the session later
claude --teleport session_01PjXXX
# Enter interactive mode, see progress, Ctrl+C to exit
```

### Using Pure HTTPS (claude-session.mjs)

```bash
# 1. Start a remote session via HTTPS
./claude-session.mjs "Create a Python web scraper for news headlines"
# Outputs JSONL with session_id and events

# 2. Check session status
./claude-session.mjs status session_01PjXXX

# 3. Resume with follow-up prompt
./claude-session.mjs resume session_01PjXXX "Now add error handling"

# 4. Archive when done
./claude-session.mjs archive session_01PjXXX
```

## Files in This Repository

| File | Purpose |
|------|---------|
| `claude-session.mjs` | **Pure HTTPS CLI** - Unified session management without CLI dependency |

### claude-session.mjs Usage

A complete CLI for managing Claude remote sessions via pure HTTPS (no `claude` CLI required).

```bash
# Create new session and run prompt
./claude-session.mjs "Your prompt here"

# Archive a session
./claude-session.mjs archive <session_id>

# Rename a session
./claude-session.mjs rename <session_id> "New Title"

# Resume session with new prompt
./claude-session.mjs resume <session_id> "Follow-up prompt"

# Get session status
./claude-session.mjs status <session_id>

# Get session events
./claude-session.mjs events <session_id>
```

**Examples:**

```bash
# Create session and pipe to jq for pretty output
./claude-session.mjs "Create hello.txt" | jq .

# Get just completion info
./claude-session.mjs "Your prompt" | jq 'select(.type == "complete")'

# Extract title and branch
./claude-session.mjs "Your prompt" | jq 'select(.type == "session_info")'

# Check status of existing session
./claude-session.mjs status session_01VbtizDCCRdFPVrPMxKzGyq

# Archive a completed session
./claude-session.mjs archive session_01VbtizDCCRdFPVrPMxKzGyq
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `CLAUDE_ENVIRONMENT_ID` | Environment ID (required) |
| `CLAUDE_GIT_URL` | Git repository URL (required) |
| `CLAUDE_MODEL` | Model to use (default: claude-opus-4-5-20251101) |
| `CLAUDE_ORG_UUID` | Organization UUID (optional) |

**Output JSONL Event Types:**
| Type | Description |
|------|-------------|
| `status` | Script status updates (starting, polling, resuming) |
| `config` | Configuration details (env, repo, model) |
| `session_created` | Session ID and web URL |
| `session_status` | Session status from API (running, idle) |
| `session_info` | Title and branch name (emitted once both are available) |
| `event` | Raw event from session events API |
| `complete` | Final result with cost, duration, title, and branch |
| `archived` | Session archived confirmation |
| `renamed` | Session renamed confirmation |
| `message_sent` | Message sent for resume |
| `status_result` | Full session status info |
| `interrupt_sent` | Interrupt control_request sent to session |
| `interrupted` | Session successfully interrupted |
| `error` | Error messages |
| `timeout` | Polling timeout reached |

**Note:** Interrupt IS supported via HTTP API using `POST /v1/sessions/{id}/events` with a `control_request` event:
```json
{
  "events": [{
    "type": "control_request",
    "action": "interrupt",
    "uuid": "random-uuid-v4"
  }]
}
```

## References

- Claude Agent SDK: `@anthropic-ai/claude-agent-sdk`
- Claude Code CLI: `@anthropic-ai/claude-code`
- SDK Documentation: https://platform.claude.com/docs/en/agent-sdk/overview
- CLI Documentation: https://code.claude.com/docs/en/overview

## Branch Name Location in Events

The branch name is NOT available in the session metadata directly. It must be extracted from events:

1. **Primary source** - `env_manager_log` events contain the branch in `data.extra.args`:
   ```json
   {
     "type": "env_manager_log",
     "data": {
       "extra": {
         "args": ["...", "branch `claude/feature-name-abc12`", "..."]
       }
     }
   }
   ```

2. **Secondary source** - Tool results may contain branch names in git output:
   ```json
   {
     "tool_use_result": {
       "stdout": "Switched to branch 'claude/feature-name-abc12'"
     }
   }
   ```

Branch naming pattern: `claude/<description>-<hash>` (e.g., `claude/create-hello-file-dp31K`)

## Version Information

- SDK Version tested: `0.1.69`
- CLI Version tested: `2.0.69`
- Document last updated: December 2025
