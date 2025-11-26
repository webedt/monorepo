# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a unified coding assistant worker that provides a provider-agnostic API for executing coding assistant requests (Claude Code, Codex, etc.) with Docker Swarm orchestration. It uses an ephemeral worker model where each container exits after completing a job, and Docker Swarm automatically restarts it.

## Development Commands

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode (uses ts-node)
npm run dev

# Build TypeScript to dist/
npm run build

# Run production build
npm start
```

### Docker Development
```bash
# Build Docker image
docker build -t unified-worker:latest .

# Test with Docker Compose (single instance)
docker-compose up

# Test API request
curl -X POST http://localhost:5001/execute \
  -H "Content-Type: application/json" \
  -d @test-request.json \
  --no-buffer
```

### Docker Swarm Deployment
```bash
# Initialize swarm (first time only)
docker swarm init

# Deploy stack with 10 workers
chmod +x deploy-swarm.sh
./deploy-swarm.sh

# Monitor deployment
docker service ls
docker service ps unified-worker-stack_unified-worker
docker service logs unified-worker-stack_unified-worker -f

# Scale workers
docker service scale unified-worker-stack_unified-worker=20

# Update configuration
# Edit swarm.yml then:
docker stack deploy -c swarm.yml unified-worker-stack

# Remove stack
docker stack rm unified-worker-stack
```

## Architecture

### Core Components

1. **server.ts** - Express server with endpoints:
   - `POST /execute` - Main execution endpoint (SSE streaming)
   - `GET /health` - Health check
   - `GET /status` - Worker idle/busy status
   - `GET /sessions` - List all sessions
   - `GET /sessions/:id` - Get session details
   - `GET /sessions/:id/stream` - Retrieve past stream events

2. **orchestrator.ts** - Main execution orchestrator that:
   - Validates requests
   - Manages session workspaces
   - Handles GitHub repo cloning/pulling
   - Routes to appropriate provider
   - Streams SSE events to client
   - Persists events to session workspace and optional DB

3. **SessionManager** - Manages session persistence:
   - Creates isolated workspaces: `/workspace/session-{uuid}/`
   - Stores metadata in `.session-metadata.json`
   - Logs stream events to `.stream-events.jsonl`
   - Handles workspace recovery from GitHub if missing

4. **Provider System**:
   - `BaseProvider` - Abstract interface for all providers
   - `ProviderFactory` - Creates provider instances based on name
   - `ClaudeCodeProvider` - Uses `@anthropic-ai/claude-agent-sdk`
   - `CodexProvider` - Stub for Codex/Cursor integration

5. **Clients & Utilities**:
   - `GitHubClient` - Clones/pulls repositories using simple-git
   - `GitHelper` - Git operations (branch, commit, push)
   - `DBClient` - Stub for database persistence
   - `CredentialManager` - Writes provider credentials to filesystem
   - `LLMHelper` - Uses Claude Agent SDK to generate session names and commit messages

### Request Flow

```
Client → POST /execute
    ↓
server.ts: Check worker status (idle/busy)
    ↓
orchestrator.ts: Step 1 - Validate request
    ↓
orchestrator.ts: Step 1.5 - Write credentials early (for LLM naming)
    ↓
SessionManager: Step 2 - Download/create session workspace
    ↓
GitHubClient: Step 4 - Clone repository (if specified)
    ↓
LLMHelper: Step 4.5 - Generate session title & branch name (new sessions only)
    ↓
GitHelper: Create branch (claude/{name}-{sessionSuffix})
    ↓
ProviderFactory: Step 5 - Create provider instance
    ↓
Provider: Step 6 - Execute user request (streaming)
    ↓
SSE events → Client
    ↓
GitHelper: Step 7 - Auto-commit & push changes (if autoCommit enabled)
    ↓
SessionManager: Step 8 - Upload session to storage
    ↓
Worker exits (ephemeral model)
```

### Session Management

- Each session gets isolated workspace: `/workspace/session-{uuid}/`
- Metadata stored in `.session-metadata.json` includes:
  - Session ID, provider, timestamps
  - Provider's internal session ID for resume
  - GitHub repo info (repoUrl, branch, clonedPath)
- Stream events logged to `.stream-events.jsonl` (JSONL format)
- Sessions can be resumed using `websiteSessionId` in request
- If workspace is missing on resume, attempts recovery from GitHub metadata

### Ephemeral Worker Model

Workers exit after each job (`process.exit(0)` on success, `process.exit(1)` on error). Docker Swarm automatically restarts them. This provides:
- Clean state for each request
- Natural load balancing (idle workers accept new requests)
- Prevents memory leaks
- Workers return 429 status when busy

## Authentication

Authentication is passed **per request** via `codingAssistantAuthentication` field (not environment variables).

### ClaudeAgentSDK Format
```json
{
  "codingAssistantAuthentication": "{\"claudeAiOauth\":{\"accessToken\":\"sk-ant-oat01-...\",\"refreshToken\":\"sk-ant-ort01-...\",\"expiresAt\":1763242829010,\"scopes\":[\"user:inference\",\"user:profile\"],\"subscriptionType\":\"max\"}}"
}
```

The `CredentialManager.writeClaudeCredentials()` writes this to `~/.claude/.credentials.json` for the SDK.

### Getting OAuth Credentials
1. Visit https://claude.ai
2. Open browser DevTools → Network tab
3. Look for API requests with Authorization headers
4. Extract OAuth credentials from requests

See [CREDENTIALS.md](CREDENTIALS.md) for detailed instructions.

## Key Implementation Details

### Provider Session IDs
- Each provider has its own internal session ID separate from our session ID
- For Claude Code: Extracted from `type: 'system', subtype: 'init'` message
- Stored in metadata as `providerSessionId` for resume functionality
- Used when resuming: `queryOptions.resume = providerSessionId`

### Workspace Recovery
If a session workspace is missing on resume (e.g., volume pruned):
1. Check if GitHub metadata exists
2. Re-clone repository to session workspace
3. Continue execution normally
4. If no GitHub metadata, throw error (cannot recover)

See [orchestrator.ts:106-164](src/orchestrator.ts#L106-L164) for implementation.

### Adding New Providers

1. Create provider class extending `BaseProvider`:
```typescript
// src/providers/NewProvider.ts
export class NewProvider extends BaseProvider {
  async execute(userRequest, options, onEvent) {
    // Implementation
  }
  async validateToken(): Promise<boolean> { /* ... */ }
  getProviderName(): string { return 'new-provider'; }
}
```

2. Register in `ProviderFactory.createProvider()`:
```typescript
case 'new-provider':
  return new NewProvider(authentication, workspace);
```

3. Update `ProviderFactory.getSupportedProviders()` array

### SSE Event Types
- `connected` - Initial connection with session ID
- `message` - Progress messages
- `github_pull_progress` - Repo clone/pull status
- `branch_created` - Git branch created with session name
- `session_name` - Generated session title and branch name
- `debug` - Debug information (for troubleshooting)
- `assistant_message` - Provider output (forwarded as-is)
- `commit_progress` - Auto-commit progress stages
- `completed` - Job finished with duration
- `error` - Error occurred with code

### LLM-Based Session Naming

For new sessions, the worker generates a human-readable session title and git branch name using the Claude Agent SDK (Haiku model). This happens in Step 4.5 of the orchestrator flow.

**How it works:**
1. Credentials are written to `~/.claude/.credentials.json` (Step 1.5)
2. `LLMHelper` uses Claude Agent SDK `query()` with OAuth auth (same as main execution)
3. Haiku generates: `TITLE: [3-6 words]` and `BRANCH: [lowercase-hyphenated]`
4. Branch name format: `claude/{descriptive-part}-{last8CharsOfSessionId}`

**Why Claude Agent SDK (not direct API):**
- OAuth tokens (`sk-ant-oat...`) only work with Claude Agent SDK
- Direct Anthropic API calls require API keys (`sk-ant-api...`)
- Using SDK ensures same authentication mechanism as main execution

**SSE events emitted:**
```
message: "Generating session title and branch name..."
debug: "LLMHelper initialized with Claude Agent SDK"
debug: "Calling generateSessionTitleAndBranch with request: ..."
debug: "LLM returned: title=..., branchName=..."
message: "Creating branch: claude/explore-repository-abc12345"
branch_created: { branchName, baseBranch, sessionPath }
session_name: { sessionName, branchName }
```

**Fallback behavior:**
If LLM naming fails, falls back to:
- Title: "New Session"
- Branch: `claude/auto-request-{sessionIdSuffix}`

**Key files:**
- [llmHelper.ts](src/utils/llmHelper.ts) - Claude Agent SDK wrapper for LLM calls
- [orchestrator.ts:279-469](src/orchestrator.ts#L279-L469) - Session naming flow

## Configuration

### Environment Variables (swarm.yml)
- `PORT` (default: 5000) - Server port
- `WORKSPACE_DIR` (default: /workspace) - Session workspace root
- `DB_BASE_URL` - Optional database API URL

### Swarm Configuration (swarm.yml)
- `replicas: 10` - Number of worker instances
- Resources: 0.5-2.0 CPUs, 1-4GB RAM per worker
- Restart policy: `any` condition, no max attempts
- Update/rollback: 2 workers in parallel, 10s delay

### ClaudeCodeProvider Options
- `model` - Claude model (default: claude-sonnet-4-5-20250929)
- `skipPermissions` - Bypass permission prompts (default: true)
- `permissionMode` - 'bypassPermissions' or 'default'

Passed via `providerOptions` in request payload.

## Image Support

The AI Coding Worker now supports sending images to Claude Code along with text prompts. This enables visual analysis, screenshot debugging, and multimodal interactions.

### Request Format

The `userRequest` field can be either:

1. **Simple string** (text-only):
```json
{
  "userRequest": "Create a hello.txt file with greeting message",
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": "..."
}
```

2. **Structured content** (text + images):
```json
{
  "userRequest": [
    {
      "type": "text",
      "text": "What's in this screenshot? Please analyze and fix any issues."
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUg..."
      }
    }
  ],
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": "..."
}
```

### Supported Image Formats

- `image/jpeg` - JPEG images
- `image/png` - PNG images
- `image/gif` - GIF images
- `image/webp` - WebP images

All images must be base64-encoded.

### Example Use Cases

1. **Screenshot Analysis**: Send screenshots of UI bugs for debugging
2. **Design Implementation**: Send mockups for code generation
3. **Error Debugging**: Send error screenshots for analysis
4. **Documentation**: Send diagrams or charts for explanation

### Example Request

See `test-image-request.json.example` for a complete example.

```bash
# Test image request
curl -X POST http://localhost:5000/execute \
  -H "Content-Type: application/json" \
  -d @test-image-request.json \
  --no-buffer
```

## Testing

Test files demonstrate different scenarios:
- `test-request.json` - Basic execution
- `test-github.json` - GitHub integration
- `test-resume.json` - Session resume
- `test-new-session.json` - New session creation
- `test-recovery.json` - Workspace recovery
- `test-image-request.json.example` - Image support example (multimodal)
- `test-requests.sh` - Automated test script

Never commit `test-with-auth.json` (contains real credentials).

## Important Notes

- Workers use `USER worker` (UID 1001) for Claude Code permissions compatibility
- Git is installed in Docker image for repository cloning
- All SSE responses must include `--no-buffer` in curl for real-time streaming
- Session workspaces persist in shared Docker volume across worker restarts
- Database integration (DBClient) is currently a stub for future implementation
