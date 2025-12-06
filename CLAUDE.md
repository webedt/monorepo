# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing multiple related projects:

| Project | Path | Description |
|---------|------|-------------|
| **Main Server** | `/main-server` | **[NEW]** Consolidated persistent server handling API, database, storage, and GitHub operations |
| **AI Coding Worker** | `/ai-coding-worker` | Provider-agnostic API for executing coding assistant requests with Docker Swarm orchestration |
| **Collaborative Session Worker** | `/collaborative-session-worker` | WebSocket-based real-time collaboration with CRDT synchronization and MinIO persistence |
| **GitHub Worker** | `/github-worker` | *(To be deprecated)* Ephemeral worker for GitHub/Git operations |
| **Storage Worker** | `/storage-worker` | *(To be deprecated)* Storage service for session management with MinIO |
| **Website** | `/website` | Web application with path-based routing and Dokploy deployment |

---

## Main Server (New Architecture)

The Main Server (`/main-server`) consolidates the Website backend, Storage Worker, and GitHub Worker into a single persistent service. This simplifies the architecture and improves performance by reducing inter-service communication.

### Architecture Overview

```
                              FRONTEND
  ┌───────────────────────────────────────────────────────────────────────┐
  │                         Website (React)                                │
  │  - Chat UI for AI interactions                                        │
  │  - File browser/editor                                                 │
  │  - GitHub OAuth integration                                            │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                              MAIN SERVER
  ┌───────────────────────────────────────────────────────────────────────┐
  │  (Single persistent service)                                          │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
  │  │   API Routes    │  │  Storage Layer  │  │  GitHub Layer   │       │
  │  │  - /execute     │  │  - MinIO client │  │  - Clone repos  │       │
  │  │  - /resume      │  │  - File CRUD    │  │  - Create branch│       │
  │  │  - /sessions    │  │  - Tarball ops  │  │  - Commit/push  │       │
  │  │  - /files       │  │                 │  │  - PR operations│       │
  │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐                            │
  │  │  Database Layer │  │ Worker Manager  │                            │
  │  │  - PostgreSQL   │  │  - Spawn workers│                            │
  │  │  - Drizzle ORM  │  │  - Stream SSE   │                            │
  │  │  - Sessions/msgs│  │                 │                            │
  │  └─────────────────┘  └─────────────────┘                            │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                    Spawn per-request (LLM execution only)
                                    │
                                    ▼
                       AI CODING WORKER (ephemeral)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  (Simplified - LLM execution only)                                    │
  │  - Receives workspace path from Main Server                           │
  │  - Executes Claude Agent SDK / Codex                                  │
  │  - Streams events back to Main Server                                 │
  │  - NO storage operations                                              │
  │  - NO GitHub operations                                               │
  └───────────────────────────────────────────────────────────────────────┘
```

### Main Server Directory Structure

```
main-server/
├── src/
│   ├── index.ts                    # Express app entrypoint
│   ├── auth.ts                     # Lucia authentication
│   ├── config/
│   │   └── env.ts                  # Environment configuration
│   ├── db/
│   │   ├── index.ts                # Database connection
│   │   ├── schema.ts               # PostgreSQL schema
│   │   └── schema-sqlite.ts        # SQLite schema
│   ├── routes/
│   │   ├── execute.ts              # Main /execute endpoint
│   │   └── resume.ts               # Session replay endpoint
│   ├── services/
│   │   ├── storage/
│   │   │   ├── minioClient.ts      # MinIO client
│   │   │   └── storageService.ts   # Storage operations
│   │   └── github/
│   │       ├── gitHelper.ts        # Git operations
│   │       ├── githubClient.ts     # Repository clone/pull
│   │       └── operations.ts       # High-level GitHub ops
│   ├── middleware/
│   │   └── auth.ts                 # Auth middleware
│   ├── lib/
│   │   ├── claudeAuth.ts           # Claude OAuth helpers
│   │   ├── codexAuth.ts            # Codex auth helpers
│   │   └── llmHelper.ts            # LLM naming helpers
│   └── utils/
│       ├── logger.ts               # Structured logging
│       ├── sessionPathHelper.ts    # Session path utilities
│       └── emojiMapper.ts          # SSE emoji decoration
├── package.json
├── tsconfig.json
└── Dockerfile
```

### Main Server API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with service status |
| `/api/execute` | POST | Execute AI coding request (SSE) |
| `/api/resume/:sessionId` | GET | Replay stored events (SSE) |
| `/api/sessions/:sessionId/events` | GET | Get all events (JSON) |

### Request Flow (New Architecture)

```
1. Frontend POST /api/execute
   │
2. Main Server: Authenticate, validate request
   │
3. Main Server: Create/update database session
   │
4. Main Server: Check MinIO for existing session
   │
5. If new session:
   │  a. Main Server: Clone repo via GitHub service
   │  b. Main Server: Generate session title/branch via LLM
   │  c. Main Server: Create branch, push
   │  d. Main Server: Store session in MinIO
   │
6. Main Server: Spawn AI Coding Worker
   │  - Pass: workspace path, credentials, user request
   │
7. Main Server: Proxy SSE from AI Worker to Frontend
   │  - Store events to database for replay
   │
8. When AI Worker completes:
   │  a. Main Server: Commit changes via GitHub service
   │  b. Main Server: Push to remote
   │  c. Main Server: Upload session to MinIO
   │
9. Main Server: Update database status, send completion
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `MINIO_ENDPOINT` | - | MinIO server hostname |
| `MINIO_PORT` | `9000` | MinIO server port |
| `MINIO_ROOT_USER` | - | MinIO access key |
| `MINIO_ROOT_PASSWORD` | - | MinIO secret key |
| `MINIO_BUCKET` | `sessions` | Session storage bucket |
| `AI_WORKER_URL` | `http://localhost:5001` | AI Worker endpoint |
| `WORKSPACE_DIR` | `/workspace` | Base workspace directory |

## Git Commit Message Rules

**MANDATORY REQUIREMENT:** All git commit messages across the entire monorepo MUST follow these rules.

### Format

```
Subject Line [Required]

- Detail Line 1 [Optional]
- Detail Line 2 [Optional]
```

**Important:** There MUST be a blank line between the subject and the detail lines.

### Rules

- Use imperative mood
- Present active tense
- Start with a capital letter
- Start with a verb (Add, Update, Remove, Fix, Refactor, etc)
- **NO prefixes** like `feat:`, `fix:`, `chore:`, `refactor:`, etc.
- **NO emojis**
- Rules apply to both subject line and detail lines
- Details are optional, but include them for larger changes

### Good Examples

```
Add commit-based versioning system
Update API endpoint to support dynamic paths
Fix navigation overlay height issue
```

```
Enhance ColyseusManager and GameRoom for improved room management

- Update ColyseusManager to utilize roomCode from Discord API
- Modify GameRoom to store and log roomCode in metadata
- Ensure fallback behavior when roomCode is not provided
```

### Good Subject Line Verbs

Add, Update, Remove, Fix, Refactor, Enhance, Rename, Move, Extract, Merge, Improve, Optimize, Document

---

## System Architecture

### High-Level Overview

```
                              FRONTEND
  ┌───────────────────────────────────────────────────────────────────────┐
  │                         Website (React)                                │
  │  - Chat UI for AI interactions                                        │
  │  - File browser/editor                                                 │
  │  - GitHub OAuth integration                                            │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                          Dokploy Reverse Proxy
                                    │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│  AI Coding      │       │  GitHub         │       │  Storage        │
│  Worker         │◄─────►│  Worker         │◄─────►│  Worker         │
│  (port 5001)    │       │  (port 5003)    │       │  (internal)     │
│                 │       │                 │       │                 │
│  10 replicas    │       │  5 replicas     │       │  2 replicas     │
└────────┬────────┘       └────────┬────────┘       └────────┬────────┘
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │     MinIO       │
                          │  (S3 Storage)   │
                          └─────────────────┘
```

### Worker Responsibilities

| Worker | Purpose | Key Operations |
|--------|---------|----------------|
| **AI Coding Worker** | Execute AI coding requests | - Receive user prompts<br>- Route to provider (Claude/Codex)<br>- Stream SSE responses<br>- Orchestrate GitHub operations |
| **GitHub Worker** | Handle Git operations | - Clone/pull repositories<br>- Create branches (LLM-named)<br>- Commit changes (LLM messages)<br>- Push to remote |
| **Storage Worker** | Manage session persistence | - Store/retrieve sessions<br>- File CRUD operations<br>- Session metadata<br>- Interface to MinIO |

### Request Flow: New Chat Session

```
1. User sends prompt → Website
2. Website → AI Coding Worker: POST /execute
3. AI Coding Worker → GitHub Worker: POST /init-session
   └── Combines clone + branch creation in one operation
   └── Uses LLM to generate session title and branch name
   └── GitHub Worker → Storage Worker: Upload session
4. AI Coding Worker → Claude Agent SDK: Execute user prompt
   └── Streams SSE events back to Website
5. AI Coding Worker → GitHub Worker: POST /commit-and-push
   └── Uses LLM to generate commit message from diff
6. AI Coding Worker → Storage Worker: Upload final session state
7. Worker exits (ephemeral model)
```

### Ephemeral Worker Model

AI Coding Worker, GitHub Worker, and Collaborative Session Worker use an ephemeral worker model:

- Workers exit after completing each job (`process.exit(0)` on success)
- Docker Swarm automatically restarts workers after exit
- Provides clean state for each request
- Natural load balancing (idle workers accept new requests)
- Prevents memory leaks over time
- Workers return 429 status when busy

---

## File Management Architecture

**CRITICAL REQUIREMENT:** All file read and write operations MUST go through the **Storage Worker** service.

### Storage Worker as Primary File Interface

The Storage Worker (`/storage-worker`) is the **single source of truth** for all file operations within sessions:

| Operation | Use Storage Worker | Use GitHub API |
|-----------|-------------------|----------------|
| Read file content | Yes | No |
| Write/update file | Yes | No |
| List files | Yes | No |
| Delete file | Yes | No |
| Create commits | No | Yes |
| Create PRs | No | Yes |
| Branch operations | No | Yes |
| AI coding execution | N/A | Via ai-coding-worker |

### Session Path Format

Storage worker uses session paths in the format: `{owner}__{repo}__{branch}` (double underscore separator)

**Important:** Session paths must NOT contain `/` characters. The storage-worker validates this and will reject requests with invalid session paths.

Example: `webedt__monorepo__feature-branch`

### Storage Worker API Endpoints

```
GET    /api/storage-worker/sessions/:sessionPath/files           - List all files
GET    /api/storage-worker/sessions/:sessionPath/files/*         - Read file content
PUT    /api/storage-worker/sessions/:sessionPath/files/*         - Write/update file
DELETE /api/storage-worker/sessions/:sessionPath/files/*         - Delete file
HEAD   /api/storage-worker/sessions/:sessionPath/files/*         - Check if file exists
```

### Frontend API Usage

```typescript
import { storageWorkerApi } from '@/lib/api';

const sessionPath = `${owner}__${repo}__${branch}`;

// Read file
const content = await storageWorkerApi.getFileText(sessionPath, `workspace/${filePath}`);

// Write file
await storageWorkerApi.writeFile(sessionPath, `workspace/${filePath}`, content);

// List files
const files = await storageWorkerApi.listFiles(sessionPath);
```

---

## API Reference

### AI Coding Worker (port 5001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with worker status |
| `/status` | GET | Worker idle/busy status |
| `/sessions` | GET | List all sessions |
| `/execute` | POST | Execute AI coding request (SSE) |
| `/abort` | POST | Abort current execution |

### GitHub Worker (port 5003)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with worker status |
| `/status` | GET | Worker idle/busy status |
| `/clone-repository` | POST | Clone repo into session (SSE) |
| `/init-session` | POST | Clone + create branch combined (SSE) |
| `/create-branch` | POST | Create branch with LLM naming (SSE) |
| `/commit-and-push` | POST | Commit and push changes (SSE) |
| `/create-pull-request` | POST | Create PR on GitHub (SSE) |
| `/merge-pull-request` | POST | Merge existing PR (SSE) |
| `/auto-pull-request` | POST | Full auto-merge workflow (SSE) |

### Storage Worker (internal)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/storage-worker/sessions` | GET | List all sessions |
| `/api/storage-worker/sessions/:path` | GET | Get session metadata |
| `/api/storage-worker/sessions/:path` | HEAD | Check session exists |
| `/api/storage-worker/sessions/:path/upload` | POST | Upload session archive |
| `/api/storage-worker/sessions/:path/download` | GET | Download session archive |
| `/api/storage-worker/sessions/:path/files` | GET | List files in session |
| `/api/storage-worker/sessions/:path/files/*` | GET/PUT/DELETE | File operations |

---

## AI Coding Worker

Provider-agnostic API for executing coding assistant requests with Docker Swarm orchestration.

### Core Components

1. **server.ts** - Express server with SSE streaming endpoints
2. **orchestrator.ts** - Main execution orchestrator
3. **SessionManager** - Manages session persistence
4. **Provider System** - `ClaudeCodeProvider`, `CodexProvider`
5. **emojiMapper** - Centralized emoji assignment for SSE messages

### Request Flow

```
Client → POST /execute
    ↓
server.ts: Check worker status (idle/busy)
    ↓
orchestrator.ts: Validate request, write credentials
    ↓
SessionManager: Download/create session workspace
    ↓
GitHub Worker: Call /init-session (clone + create branch)
    ↓
ProviderFactory: Create provider instance
    ↓
Provider: Execute user request (streaming)
    ↓
SSE events → Client (with emojis applied by emojiMapper)
    ↓
GitHub Worker: Call /commit-and-push (if autoCommit enabled)
    ↓
SessionManager: Upload session to storage
    ↓
Worker exits (ephemeral model)
```

### Authentication

Authentication is passed **per request** via `codingAssistantAuthentication` field:

```json
{
  "codingAssistantAuthentication": "{\"claudeAiOauth\":{\"accessToken\":\"sk-ant-oat01-...\",\"refreshToken\":\"sk-ant-ort01-...\",\"expiresAt\":1763242829010}}"
}
```

The `CredentialManager.writeClaudeCredentials()` writes this to `~/.claude/.credentials.json` for the SDK.

### SSE Event Types

| Event Type | Source | Description |
|------------|--------|-------------|
| `connected` | `ai-coding-worker` | Initial connection with session ID |
| `message` | `ai-coding-worker` | Progress messages |
| `branch_created` | `ai-coding-worker` | Git branch created with session name |
| `session_name` | `ai-coding-worker` | Generated session title and branch name |
| `assistant_message` | `claude-agent-sdk` | Provider output (forwarded from SDK) |
| `commit_progress` | `ai-coding-worker` | Auto-commit progress stages |
| `completed` | `ai-coding-worker` | Job finished with duration |
| `error` | `ai-coding-worker` | Error occurred with code |

### Emoji Mapper (Centralized Emoji Assignment)

The `emojiMapper` utility centralizes all emoji assignment for SSE messages. Sub-workers send semantic stages without emojis, and ai-coding-worker applies appropriate emojis before forwarding to the frontend.

**Stage Emoji Mapping:**

| Stage | Emoji | Description |
|-------|-------|-------------|
| `preparing` | 🔧 | Preparing credentials/initialization |
| `downloading_session` | 📥 | Downloading from storage |
| `checking_session` | 🔍 | Checking for existing session |
| `session_found` | 📂 | Existing session found |
| `new_session` | 🆕 | Creating new session |
| `cloning` | 📥 | Cloning repository |
| `cloned` | ✅ | Clone complete |
| `generating_name` | 🤖 | LLM generating names |
| `name_generated` | ✨ | Name generated |
| `creating_branch` | 🌿 | Creating git branch |
| `pushing` | 📤 | Pushing to remote |
| `uploading` | 📤 | Uploading to storage |
| `analyzing` | 🔍 | Analyzing changes |
| `committing` | 💾 | Creating commit |
| `error` | ❌ | Operation failed |

### Image Support

The AI Coding Worker supports sending images to Claude Code along with text prompts:

```json
{
  "userRequest": [
    { "type": "text", "text": "What's in this screenshot?" },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUg..."
      }
    }
  ]
}
```

Supported formats: `image/jpeg`, `image/png`, `image/gif`, `image/webp`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `WORKSPACE_DIR` | `/workspace` | Session workspace root |
| `DB_BASE_URL` | - | Optional database API URL |

---

## GitHub Worker

Ephemeral worker service for GitHub/Git operations with SSE streaming.

### POST /init-session

Combined operation: clone repository AND create branch with LLM-generated name in a single call. This avoids 429 busy responses that can occur when calling `/clone-repository` and `/create-branch` sequentially.

Request:
```json
{
  "sessionId": "abc123",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "userRequest": "Add dark mode toggle",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx"
}
```

Response (via SSE completed event):
```json
{
  "clonedPath": "repo",
  "branch": "main",
  "wasCloned": true,
  "branchName": "webedt/add-dark-mode-abc12345",
  "sessionTitle": "Add Dark Mode Toggle",
  "sessionPath": "owner__repo__webedt-add-dark-mode-abc12345"
}
```

### POST /commit-and-push

Commit changes with LLM-generated message and push:

```json
{
  "sessionId": "abc123",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx",
  "userId": "user123"
}
```

### POST /create-pull-request

Create a pull request on GitHub:

```json
{
  "owner": "webedt",
  "repo": "monorepo",
  "title": "Add dark mode feature",
  "head": "feature/dark-mode",
  "base": "main",
  "body": "This PR adds dark mode support",
  "githubAccessToken": "ghp_xxx"
}
```

### POST /auto-pull-request

Complete auto-merge workflow: create PR (or find existing), merge base into feature branch, wait for mergeable status, merge PR, and delete the feature branch.

### SSE Progress Stages

**Init Session:**
`preparing` → `checking_session` → `session_found`/`new_session` → `cloning` → `cloned` → `generating_name` → `name_generated` → `creating_branch` → `pushing` → `uploading`

**Commit and Push:**
`preparing` → `downloading_session` → `analyzing` → `changes_detected` → `generating_message` → `committing` → `pushing` → `uploading`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5002` | Server port |
| `TMP_DIR` | `/tmp` | Temporary directory for workspaces |
| `STORAGE_WORKER_URL` | (internal) | URL to storage worker service |

---

## Storage Worker

MinIO-based storage service for session management with file-level access.

### Architecture

Unlike other workers, the Storage Worker is **NOT ephemeral**:
- Runs continuously to handle storage requests
- Maintains persistent connections to MinIO
- Sessions stored as tarball archives (`session.tar.gz`)
- Supports both session-level and file-level operations

### Session Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/storage-worker/sessions` | List all sessions |
| `GET` | `/api/storage-worker/sessions/:sessionPath` | Get session metadata |
| `HEAD` | `/api/storage-worker/sessions/:sessionPath` | Check if session exists |
| `DELETE` | `/api/storage-worker/sessions/:sessionPath` | Delete a session |
| `POST` | `/api/storage-worker/sessions/:sessionPath/upload` | Upload session tarball |
| `GET` | `/api/storage-worker/sessions/:sessionPath/download` | Download session tarball |

### File Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/storage-worker/sessions/:sessionPath/files` | List files in session |
| `GET` | `/api/storage-worker/sessions/:sessionPath/files/*` | Read file content |
| `PUT` | `/api/storage-worker/sessions/:sessionPath/files/*` | Write/update file |
| `DELETE` | `/api/storage-worker/sessions/:sessionPath/files/*` | Delete file |
| `HEAD` | `/api/storage-worker/sessions/:sessionPath/files/*` | Check if file exists |

### Storage Format

Sessions are stored as gzipped tarballs in MinIO:

```
minio/sessions/{sessionPath}/session.tar.gz
├── workspace/              # User workspace files
├── .session-metadata.json  # Session metadata
└── .stream-events.jsonl    # SSE event log (optional)
```

### On-Demand Session Creation

Sessions are created automatically when you write a file to a non-existent session. No explicit "create session" call is needed.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MINIO_ENDPOINT` | - | MinIO server hostname |
| `MINIO_PORT` | `9000` | MinIO server port |
| `MINIO_ROOT_USER` | - | MinIO access key |
| `MINIO_ROOT_PASSWORD` | - | MinIO secret key |
| `MINIO_BUCKET` | `sessions` | Bucket name for sessions |

---

## Collaborative Session Worker

WebSocket-based collaborative session worker with CRDT synchronization and auto-commit functionality.

### Core Components

1. **WebSocket Server** - Handles client connections and message routing
2. **Session Storage** - MinIO integration for persistent session storage
3. **Collaboration Manager** - CRDT-based conflict-free synchronization using Yjs
4. **Auto-Commit** - Automatic git commits after cooldown period

### Session Lifecycle

1. **Client Connection**: Client connects via WebSocket and joins a session
2. **Session Download**: Worker downloads session from MinIO (if exists)
3. **Collaboration**: Multiple users can edit files simultaneously
4. **Auto-Commit**: After cooldown period with no activity, changes are committed
5. **Session Upload**: On disconnect or cleanup, session is uploaded to MinIO

### Message Types

**Client → Server:**
- `join` - Join a session
- `fileOperation` - Perform file operation (create, update, delete, rename)
- `yjsUpdate` - Yjs CRDT update
- `getFiles` - List files in workspace
- `getFile` - Get file content

**Server → Client:**
- `joined` - Successfully joined session
- `userJoined` / `userLeft` - User events
- `fileOperation` - File operation from another user
- `yjsUpdate` - CRDT update from another user
- `files` / `fileContent` - Response to queries
- `error` - Error message

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | WebSocket server port |
| `WORKSPACE_DIR` | `/workspace` | Base directory for workspaces |
| `COOLDOWN_MS` | `300000` | Auto-commit cooldown (5 minutes) |

---

## Website

Web application with path-based routing and Dokploy deployment.

### Deployment URLs

This project uses Dokploy for deployments with path-based routing:

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Examples:**
- `https://github.etdofresh.com/webedt/monorepo/main/`
- `https://github.etdofresh.com/webedt/monorepo/claude-rename-session-abc123/`

**Pattern:**
- Owner and repo are lowercased
- Branch name preserves original case (slashes replaced with dashes)
- Example: Branch `claude/test-feature` becomes `claude-test-feature`

### Path-Based Routing Requirements

**CRITICAL:** Three files MUST be updated to support path-based routing:

1. **`apps/client/index.html`** - Base tag detection
2. **`apps/client/src/App.tsx`** - React Router basename
3. **`apps/client/src/lib/api.ts`** - API base URL detection

Each file must detect the path-based pattern by checking for 3 path segments:

```javascript
if (pathSegments.length >= 3 && !appRoutes.includes(pathSegments[0])) {
  basePath = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
} else {
  basePath = '/';
}
```

### Version Management

Version numbers are **automatically calculated** by GitHub Actions:
- `MAJOR.MINOR.PATCH` where PATCH = commits since tag
- Example: Tag `v1.2.0` + 5 commits = `1.2.5`

### Displaying Links After Tasks

**CRITICAL REQUIREMENT:** After completing ANY task that involves code changes, commits, or pushes in the website project, you MUST ALWAYS display:

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch-name}](https://github.com/webedt/monorepo/tree/{branch-name})
Live Site: [https://github.etdofresh.com/webedt/monorepo/{branch}/](https://github.etdofresh.com/webedt/monorepo/{branch}/)
```

---

## Development Commands

### Common Node.js Patterns

```bash
# Install dependencies
npm install  # or pnpm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

### Docker Swarm Deployment

```bash
# Initialize swarm (first time only)
docker swarm init

# Deploy stack
docker stack deploy -c swarm.yml {stack-name}

# Monitor deployment
docker service ls
docker service ps {service-name}
docker service logs {service-name} -f

# Scale workers
docker service scale {service-name}=20

# Remove stack
docker stack rm {stack-name}
```

### Testing from Production Server

```bash
# Test via SSH to production server
ssh ehub2023 'curl -s http://127.0.0.1:5001/health | jq'
ssh ehub2023 'curl -s http://127.0.0.1:5003/health | jq'
```

---

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

*Documentation last updated: 2025-12-05*
