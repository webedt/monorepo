# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing the following projects:

| Project | Path | Description |
|---------|------|-------------|
| **Website** | `/website` | React frontend + Express API facade (proxies public API routes) |
| **Internal API Server** | `/internal-api-server` | Internal backend handling API, database, storage, and GitHub operations |
| **AI Coding Worker** | `/ai-coding-worker` | Provider-agnostic ephemeral worker for LLM execution with Docker Swarm orchestration |

---

## Architecture Overview

```
                              FRONTEND
  ┌───────────────────────────────────────────────────────────────────────┐
  │                    Website (React + Express Facade)                    │
  │  - React client (Vite)                                                │
  │  - Express server serving static files + proxying /api/* routes       │
  │  - Route whitelisting for public API access                           │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                         Proxy allowed /api/* routes
                                    │
                                    ▼
                         INTERNAL API SERVER
  ┌───────────────────────────────────────────────────────────────────────┐
  │  (Private service - only accessible via dokploy-network)              │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
  │  │   API Routes    │  │  Storage Layer  │  │  GitHub Layer   │       │
  │  │  - /execute     │  │  - MinIO client │  │  - Clone repos  │       │
  │  │  - /resume      │  │  - File CRUD    │  │  - Create branch│       │
  │  │  - /sessions    │  │  - Tarball ops  │  │  - Commit/push  │       │
  │  │  - /admin       │  │                 │  │  - PR operations│       │
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
  │  - Receives workspace path from Internal API Server                   │
  │  - Executes Claude Agent SDK / Codex                                  │
  │  - Streams events back to Internal API Server                         │
  │  - Exits after each job (Docker Swarm restarts)                       │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Website

The Website (`/website`) contains both the React frontend and an Express API facade server.

### Structure

```
website/
├── client/                    # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── lib/api.ts
│   │   └── ...
│   └── package.json
├── server/                    # Express API facade
│   ├── src/
│   │   └── index.ts          # Proxy middleware + static serving
│   └── package.json
├── Dockerfile                 # Multi-stage build
└── docker-compose.yml
```

### API Facade

The Express server acts as a facade that:
1. Serves the React static files
2. Proxies allowed `/api/*` routes to the Internal API Server
3. Blocks internal-only routes from public access

**Allowed Routes (public):**
- `/api/auth` - Authentication
- `/api/user` - User settings
- `/api/sessions` - Session management
- `/api/github` - GitHub OAuth & repos
- `/api/execute` - AI execution
- `/api/resume` - Session replay
- `/api/transcribe` - Audio transcription
- `/api/admin` - Admin (requires admin auth)
- `/api/logs` - Debug logs (for debugging)

**Blocked Routes (internal only):**
- `/api/storage/sessions/*/upload` - Only ai-worker should upload
- `/api/storage/sessions/*/download` - Only ai-worker should download tarballs
- `/api/storage/sessions/bulk-delete` - Internal batch operations
- `/api/sessions/*/worker-status` - Only ai-worker reports status

### Deployment URLs

Path-based routing via Dokploy:

```
https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/
```

**IMPORTANT:** For branch names containing slashes (`/`), replace them with hyphens (`-`) in the URL.

**Examples:**
- `https://webedt.etdofresh.com/github/webedt/monorepo/main/`
- `https://webedt.etdofresh.com/github/webedt/monorepo/feature-branch/`
- Branch `claude/fix-bug-123` → `https://webedt.etdofresh.com/github/webedt/monorepo/claude-fix-bug-123/`

---

## Internal API Server

The Internal API Server (`/internal-api-server`) is the central backend service that consolidates:
- All API routes (auth, sessions, execute, etc.)
- Storage operations (MinIO)
- GitHub operations (clone, branch, commit, push)
- User authentication (Lucia)
- Session management (PostgreSQL)

**Note:** This server is only accessible internally via the dokploy-network. Public access goes through the Website facade.

### Directory Structure

The Internal API Server follows a **separation of interfaces from logic** pattern:
- `api/` - HTTP interface (Express routes and middleware)
- `cli/` - CLI interface (commander commands)
- `logic/` - Business logic (all core functionality)

```
internal-api-server/
├── src/
│   ├── index.ts                    # Express app entrypoint
│   │
│   ├── api/                        # HTTP interface (Express)
│   │   ├── routes/
│   │   │   ├── execute.ts          # Main /execute endpoint
│   │   │   ├── executeRemote.ts    # Claude Remote execution
│   │   │   ├── resume.ts           # Session replay endpoint
│   │   │   ├── sessions.ts         # Session management
│   │   │   ├── auth.ts             # Authentication routes
│   │   │   ├── user.ts             # User management
│   │   │   ├── github.ts           # GitHub OAuth
│   │   │   ├── storage.ts          # Storage operations
│   │   │   ├── admin.ts            # Admin routes
│   │   │   ├── completions.ts      # Code completions
│   │   │   ├── transcribe.ts       # Audio transcription
│   │   │   ├── imageGen.ts         # Image generation
│   │   │   ├── internalSessions.ts # Claude Remote session mgmt
│   │   │   └── logs.ts             # Debug log viewing
│   │   └── middleware/
│   │       └── auth.ts             # Auth middleware
│   │
│   ├── cli/                        # CLI interface (commander)
│   │   ├── index.ts                # CLI entry point
│   │   └── commands/
│   │       ├── session.ts          # session list/get/delete/cleanup
│   │       ├── github.ts           # github branches/repos/create-branch/create-pr
│   │       ├── storage.ts          # storage list/files/read/delete-session
│   │       └── admin.ts            # admin users/create-user/set-admin
│   │
│   └── logic/                      # Business logic (all core functionality)
│       ├── auth/
│       │   ├── lucia.ts            # Lucia authentication
│       │   ├── claudeAuth.ts       # Claude OAuth helpers
│       │   ├── codexAuth.ts        # Codex auth helpers
│       │   └── geminiAuth.ts       # Gemini auth helpers
│       ├── config/
│       │   └── env.ts              # Environment configuration
│       ├── db/
│       │   ├── index.ts            # PostgreSQL connection
│       │   ├── connection.ts       # Database connection management
│       │   ├── schema.ts           # Drizzle ORM schema
│       │   └── migrations.ts       # Database migrations
│       ├── execution/
│       │   ├── workerCoordinator.ts # Worker pool management
│       │   ├── localWorkerPool.ts  # Local worker pool
│       │   └── providers/          # Execution providers
│       │       ├── claudeRemoteProvider.ts
│       │       └── types.ts
│       ├── github/
│       │   ├── gitHelper.ts        # Low-level git operations
│       │   ├── githubClient.ts     # Octokit wrapper
│       │   └── operations.ts       # High-level GitHub ops
│       ├── sessions/
│       │   ├── claudeSessionSync.ts      # Background sync service
│       │   ├── sessionEventBroadcaster.ts # SSE event broadcasting
│       │   └── sessionListBroadcaster.ts  # Session list updates
│       ├── storage/
│       │   ├── minioClient.ts      # MinIO client
│       │   └── storageService.ts   # Storage operations
│       ├── aiWorker/
│       │   └── aiWorkerClient.ts   # Client for AI worker
│       ├── utils/
│       │   ├── logger.ts           # Structured logging
│       │   ├── metrics.ts          # Performance metrics
│       │   ├── healthMonitor.ts    # Health check system
│       │   ├── circuitBreaker.ts   # Circuit breaker pattern
│       │   ├── recovery.ts         # Session recovery
│       │   ├── retry.ts            # Retry logic
│       │   ├── emojiMapper.ts      # SSE emoji decoration
│       │   ├── previewUrlHelper.ts # Preview URL generation
│       │   └── sessionPathHelper.ts # Session path utilities
│       └── scripts/
│           ├── db-check.ts         # Database health check
│           ├── db-backup.ts        # Database backup utility
│           └── db-validate.ts      # Schema validation
│
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml              # Dokploy deployment
└── swarm.yml                       # Docker Swarm deployment
```

### CLI Usage

The Internal API Server includes a CLI for debugging and administration:

```bash
# Run CLI (requires DATABASE_URL env)
npm run cli -- <command>

# Session commands
npm run cli -- session list              # List recent sessions
npm run cli -- session get <id>          # Get session details
npm run cli -- session delete <id> -f    # Delete a session
npm run cli -- session cleanup           # Clean orphaned sessions

# GitHub commands (requires GITHUB_TOKEN)
npm run cli -- github repos              # List repositories
npm run cli -- github branches <owner> <repo>
npm run cli -- github create-branch <owner> <repo> <name>
npm run cli -- github create-pr <owner> <repo> <head> <base>

# Storage commands (requires MinIO connection)
npm run cli -- storage list              # List sessions in storage
npm run cli -- storage files <path>      # List files in a session
npm run cli -- storage exists <path>     # Check if session exists

# Admin commands
npm run cli -- admin users               # List all users
npm run cli -- admin user <id>           # Get user details
npm run cli -- admin create-user <email> <password>
npm run cli -- admin set-admin <id> true
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with service status |
| `/api/execute` | POST | Execute AI coding request (SSE) |
| `/api/resume/:sessionId` | GET | Replay stored events (SSE) |
| `/api/auth/*` | - | Authentication (register, login, logout, session) |
| `/api/user/*` | - | User management (claude-auth, preferred-provider) |
| `/api/sessions/*` | - | Session CRUD operations |
| `/api/github/*` | - | GitHub OAuth and repo operations |
| `/api/storage/*` | - | Storage operations (files, sessions) |
| `/api/admin/*` | - | Admin user management |
| `/api/transcribe` | POST | Audio transcription (OpenAI Whisper) |
| `/api/logs` | GET | View captured server logs |
| `/api/logs` | DELETE | Clear captured logs |
| `/api/logs/status` | GET | Log capture status |

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
| `AI_WORKER_URL` | `http://ai-coding-worker:5000` | AI Worker endpoint |
| `SESSION_SECRET` | - | Session encryption secret |
| `ALLOWED_ORIGINS` | - | CORS allowed origins |
| `GITHUB_CLIENT_ID` | - | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | - | GitHub OAuth client secret |
| `OPENAI_API_KEY` | - | OpenAI API key (for transcription) |

---

## AI Coding Worker

Provider-agnostic ephemeral worker for executing LLM coding requests.

### Key Characteristics

- **Ephemeral**: Exits after each job (`process.exit(0)`)
- **Docker Swarm**: Automatically restarted after exit
- **Single Request**: Returns 429 if busy
- **LLM Execution Only**: No storage or GitHub operations

### Core Components

1. **server.ts** - Express server with SSE streaming
2. **orchestrator.ts** - Request orchestration
3. **providers/** - Claude Agent SDK, Codex providers
4. **emojiMapper** - SSE message decoration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `WORKSPACE_DIR` | `/workspace` | Session workspace root |
| `INTERNAL_API_URL` | `http://webedt-app-webedt-internal-api-server-juit1b:3000` | Internal API Server URL |

---

## Git Commit Message Rules

**MANDATORY:** All commit messages MUST follow these rules.

### Format

```
Subject Line [Required]

- Detail Line 1 [Optional]
- Detail Line 2 [Optional]
```

### Rules

- Use imperative mood, present tense
- Start with capital letter and verb
- **NO prefixes** (`feat:`, `fix:`, etc.)
- **NO emojis**

### Good Examples

```
Add commit-based versioning system
Update API endpoint to support dynamic paths
Fix navigation overlay height issue
```

### Good Verbs

Add, Update, Remove, Fix, Refactor, Enhance, Rename, Move, Extract, Merge, Improve, Optimize, Document

---

## Pre-Commit Checklist

**MANDATORY:** Before committing changes, run these commands in the project folder(s) you modified:

```bash
npm install        # Ensure dependencies are up to date
npm run build      # Verify no build/compilation errors
```

This ensures there are no errors in the application before pushing to the repository.

---

## File Management

### Storage Operations

All file operations go through the Internal API Server storage routes (accessed via website facade or directly for internal services):

```
GET    /api/storage/sessions/:sessionPath/files           - List files
GET    /api/storage/sessions/:sessionPath/files/*         - Read file
PUT    /api/storage/sessions/:sessionPath/files/*         - Write file
DELETE /api/storage/sessions/:sessionPath/files/*         - Delete file
HEAD   /api/storage/sessions/:sessionPath/files/*         - Check exists
```

### Session Path Format

`{owner}__{repo}__{branch}` (double underscore separator)

Example: `webedt__monorepo__feature-branch`

**Important:** Session paths must NOT contain `/` characters.

### Frontend API Usage

```typescript
import { storageWorkerApi } from '@/lib/api';

const sessionPath = `${owner}__${repo}__${branch}`;

// Read file
const content = await storageWorkerApi.getFileText(sessionPath, `workspace/${filePath}`);

// Write file
await storageWorkerApi.writeFile(sessionPath, `workspace/${filePath}`, content);
```

---

## SSE Event Types

| Event Type | Source | Description |
|------------|--------|-------------|
| `connected` | `ai-coding-worker` | Initial connection |
| `message` | `ai-coding-worker` | Progress messages |
| `session_name` | `ai-coding-worker` | Generated session title |
| `assistant_message` | `claude-agent-sdk` | LLM output |
| `completed` | `ai-coding-worker` | Job finished |
| `error` | `ai-coding-worker` | Error occurred |

### Stage Emoji Mapping

| Stage | Emoji | Description |
|-------|-------|-------------|
| `preparing` | 🔧 | Initialization |
| `downloading_session` | 📥 | Downloading from storage |
| `cloning` | 📥 | Cloning repository |
| `generating_name` | 🤖 | LLM generating names |
| `creating_branch` | 🌿 | Creating git branch |
| `pushing` | 📤 | Pushing to remote |
| `committing` | 💾 | Creating commit |
| `error` | ❌ | Operation failed |

---

## Local Development

### Starting the Development Server

From the monorepo root directory, run:

```bash
npm run dev
```

This starts all services concurrently:
- **Vite dev server** (React client): `http://localhost:5173` or `http://localhost:5174` (hot reload)
- **Website server** (Express facade): `http://localhost:3000` (serves built client + proxies API)
- **Internal API server**: `http://localhost:3001`

**Recommended for development:** Use the Vite dev server port (5173/5174) for hot reload support.

### Restarting the Development Server

**IMPORTANT:** Do NOT kill all node processes. Only kill the specific processes on the dev ports.

To find and kill specific processes on Windows:

```powershell
# Find processes on specific ports
netstat -ano | findstr :3000
netstat -ano | findstr :3001
netstat -ano | findstr :5173
netstat -ano | findstr :5174

# Kill specific PID (replace <PID> with the actual process ID)
taskkill /PID <PID> /F
```

Or use PowerShell to kill by port:

```powershell
# Kill process on port 3000
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Kill process on port 5173
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Then restart with `npm run dev`.

### Browser Testing with Chrome DevTools MCP

When testing in the browser, use the Chrome DevTools MCP tools for automation:

1. **Navigate to pages:**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate_page with url: "http://localhost:5174"
   ```

2. **Take snapshots to see page state:**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__take_snapshot
   ```

3. **Click elements by uid (from snapshot):**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__click with uid: "<element-uid>"
   ```

4. **Fill form inputs:**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__fill with uid: "<input-uid>", value: "text"
   ```

5. **Check console for errors:**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_console_messages
   ```

6. **Check network requests:**
   ```
   mcp__plugin_chrome-devtools-mcp_chrome-devtools__list_network_requests
   ```

**Workflow for testing:**
1. Start dev server with `npm run dev`
2. Navigate to the app URL
3. Take a snapshot to see the page structure
4. Interact with elements using their uids from the snapshot
5. Check console/network for errors after actions

---

## Development Commands

### Node.js

```bash
npm install        # Install dependencies
npm run dev        # Development mode (all services)
npm run build      # Build TypeScript
npm start          # Production
```

### Docker Swarm

```bash
docker swarm init
docker stack deploy -c swarm.yml {stack-name}
docker service ls
docker service logs {service-name} -f
docker service scale {service-name}=20
docker stack rm {stack-name}
```

---

## SSH Access for Docker Status

To check Docker container status on the production server:

```bash
ssh ehub2023
```

**If `ehub2023` is not accessible**, ask the user for the SSH server hostname/alias.

### Common Docker Commands (via SSH)

```bash
# List running containers
docker ps

# Check specific service status
docker service ls

# View container logs
docker logs <container-id> -f

# Check service logs
docker service logs <service-name> -f
```

---

## Viewing Server Logs via API

The `/api/logs` endpoint exposes captured server logs for debugging.

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/logs` | GET | Get captured logs with optional filtering |
| `/api/logs` | DELETE | Clear all captured logs |
| `/api/logs/status` | GET | Get log capture status |

### Query Parameters (GET /api/logs)

| Parameter | Description |
|-----------|-------------|
| `level` | Filter by log level: `debug`, `info`, `warn`, `error` |
| `component` | Filter by component name |
| `sessionId` | Filter by session ID |
| `since` | Filter logs after this ISO timestamp |
| `limit` | Max logs to return (default: 100, max: 1000) |

### Example Usage

```bash
# Get all logs (default limit 100)
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs"

# Get error logs only
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs?level=error"

# Get logs for a specific session
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs?sessionId=abc123"

# Get logs since a specific time
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs?since=2025-01-15T10:00:00Z"

# Get last 50 logs
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs?limit=50"

# Combine filters
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs?level=error&limit=20"

# Clear all logs
curl -X DELETE "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs"

# Check log capture status
curl "https://webedt.etdofresh.com/github/webedt/monorepo/main/api/logs/status"
```

### Response Format

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "timestamp": "2025-01-15T10:30:00.000Z",
        "level": "info",
        "component": "execute",
        "message": "Starting execution",
        "sessionId": "abc123"
      }
    ],
    "total": 150,
    "filtered": 25,
    "status": {
      "enabled": true,
      "count": 150,
      "maxLogs": 1000
    }
  }
}
```

---

## Links After Tasks

**CRITICAL:** After code changes, commits, or pushes, ALWAYS display:

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch}](https://github.com/webedt/monorepo/tree/{branch})
Live Site: [https://webedt.etdofresh.com/github/webedt/monorepo/{branch-with-slashes-as-hyphens}/](https://webedt.etdofresh.com/github/webedt/monorepo/{branch-with-slashes-as-hyphens}/)
```

**NOTE:** For the Live Site URL, replace any slashes (`/`) in the branch name with hyphens (`-`).
Example: Branch `claude/fix-bug` → Live Site URL uses `claude-fix-bug`

---

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

## Autonomous Development Workflow

This repo supports long-running autonomous development via the autonomous CLI.

### Key Files

- **SPEC.md** - North star roadmap describing the complete platform vision. This is the aspirational end-state of what WebEDT should become.
- **STATUS.md** - Implementation status, priorities (P0-P3), and progress tracking. This tracks what's been built vs. what remains.

### Workflow for Implementing Features

1. Read `STATUS.md` to understand current state and priorities
2. Pick the highest priority (P0 first) incomplete feature
3. Read the relevant `SPEC.md` sections for detailed requirements
4. Implement the feature following existing patterns in the codebase
5. Run `npm install && npm run build` in modified project folders
6. Update `STATUS.md` with:
   - New status (✅ Complete, 🟡 Partial)
   - Key files added/modified
   - Add entry to Changelog section
7. Commit changes and repeat

### Priority Tiers

- **P0 (Core MVP):** Essential features for a functional platform
- **P1 (Important):** Build after core MVP is stable
- **P2 (Nice to Have):** Enhance the platform experience
- **P3 (Future):** Long-term vision features

---

*Documentation last updated: 2025-12-18*
