# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing multiple related projects:

| Project | Path | Description |
|---------|------|-------------|
| **AI Coding Worker** | `/ai-coding-worker` | Provider-agnostic API for executing coding assistant requests with Docker Swarm orchestration |
| **Collaborative Session Worker** | `/collaborative-session-worker` | WebSocket-based real-time collaboration with CRDT synchronization and MinIO persistence |
| **GitHub Worker** | `/github-worker` | Ephemeral worker for GitHub/Git operations (clone, branch, commit, push) with SSE streaming |
| **Storage Worker** | `/storage-worker` | Storage service for session management |
| **Website** | `/website` | Web application with path-based routing and Dokploy deployment |

Each project has its own `CLAUDE.md` file with project-specific details. **Always read the project-specific CLAUDE.md when working within a project directory.**

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

✅ **Simple:**
```
Add commit-based versioning system
```

```
Update API endpoint to support dynamic paths
```

```
Fix navigation overlay height issue
```

✅ **With Details:**
```
Enhance ColyseusManager and GameRoom for improved room management

- Update ColyseusManager to utilize roomCode from Discord API
- Modify GameRoom to store and log roomCode in metadata
- Ensure fallback behavior when roomCode is not provided
```

### Anti-Patterns (Don't Do This)

❌ **Using conventional commit prefixes:**
```
feat: add new feature
fix: resolve bug
```

❌ **Using emojis:**
```
✨ Add new feature
🐛 Fix bug
```

❌ **Past tense:**
```
Added new feature
Fixed bug
```

❌ **Not starting with a verb:**
```
New feature implementation
```

### Good Subject Line Verbs

- **Add** - Create a new feature, file, or capability
- **Update** - Modify existing functionality or content
- **Remove** - Delete code, files, or features
- **Fix** - Resolve a bug or issue
- **Refactor** - Restructure code without changing functionality
- **Enhance** - Improve existing functionality
- **Rename** - Change names for clarity
- **Move** - Relocate files or code
- **Extract** - Pull out code into separate components
- **Merge** - Combine branches or features
- **Improve** - Make something better
- **Optimize** - Improve performance
- **Document** - Add or update documentation

## File Management Architecture

**CRITICAL REQUIREMENT:** All file read and write operations MUST go through the **Storage Worker** service.

### Storage Worker as Primary File Interface

The Storage Worker (`/storage-worker`) is the **single source of truth** for all file operations within sessions:

| Operation | Use Storage Worker | Use GitHub API |
|-----------|-------------------|----------------|
| Read file content | ✅ Yes | ❌ No |
| Write/update file | ✅ Yes | ❌ No |
| List files | ✅ Yes | ❌ No |
| Delete file | ✅ Yes | ❌ No |
| Create commits | ❌ No | ✅ Yes |
| Create PRs | ❌ No | ✅ Yes |
| Branch operations | ❌ No | ✅ Yes |
| AI coding execution | N/A | Via ai-coding-worker |

### Session Path Format

Storage worker uses session paths in the format: `{owner}__{repo}__{branch}` (double underscore separator)

**Important:** Session paths must NOT contain `/` characters. The storage-worker validates this and will reject requests with invalid session paths.

Example: `webedt__monorepo__feature-branch`

**Generation:** Session paths are generated using the `generateSessionPath()` helper:
```typescript
// ai-coding-worker/src/utils/sessionPathHelper.ts
import { generateSessionPath } from './sessionPathHelper';

const sessionPath = generateSessionPath(owner, repo, branch);
// Result: "webedt__monorepo__feature-branch"
```

**Frontend Usage:**
```typescript
// Construct session path directly
const sessionPath = `${owner}__${repo}__${branch}`;
```

### Storage Worker API Endpoints

```
GET    /api/storage-worker/sessions/:sessionPath/files           - List all files
GET    /api/storage-worker/sessions/:sessionPath/files/*         - Read file content
PUT    /api/storage-worker/sessions/:sessionPath/files/*         - Write/update file
DELETE /api/storage-worker/sessions/:sessionPath/files/*         - Delete file
HEAD   /api/storage-worker/sessions/:sessionPath/files/*         - Check if file exists
```

### On-Demand Session Creation

Sessions are created automatically when you write a file to a non-existent session. No explicit "create session" call is needed.

### Frontend API Usage (Website)

```typescript
import { storageWorkerApi } from '@/lib/api';

// Construct session path (double underscore separator, no slashes)
const sessionPath = `${owner}__${repo}__${branch}`;

// Read file
const content = await storageWorkerApi.getFileText(sessionPath, `workspace/${filePath}`);
const blob = await storageWorkerApi.getFileBlob(sessionPath, `workspace/${filePath}`);

// Write file
await storageWorkerApi.writeFile(sessionPath, `workspace/${filePath}`, content);

// List files
const files = await storageWorkerApi.listFiles(sessionPath);

// Delete file
await storageWorkerApi.deleteFile(sessionPath, `workspace/${filePath}`);
```

### GitHub API Usage (Limited to Git Operations)

GitHub API should ONLY be used for:
- Creating/deleting branches
- Creating commits (from storage worker content)
- Creating/managing pull requests
- Repository metadata

```typescript
import { githubApi } from '@/lib/api';

// Git operations only
await githubApi.createBranch(...);
await githubApi.updateFile(...);  // For committing changes
await githubApi.createPR(...);
```

### Why Storage Worker First?

1. **Performance** - Local/cached file access is faster than GitHub API
2. **Consistency** - Single source of truth for session state
3. **Offline capability** - Changes persist locally before syncing
4. **Rate limiting** - Avoids GitHub API rate limits
5. **Binary files** - Better handling of images and large files

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Website (React)                                │  │
│  │  - Chat UI for AI interactions                                        │  │
│  │  - File browser/editor                                                 │  │
│  │  - GitHub OAuth integration                                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│                          Dokploy Reverse Proxy                               │
└────────────────────────────────────┬────────────────────────────────────────┘
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
         │                         │                         │
         └─────────────────────────┼─────────────────────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │     MinIO       │
                          │  (S3 Storage)   │
                          │                 │
                          │  Sessions data  │
                          └─────────────────┘
```

### Worker Responsibilities

| Worker | Purpose | Key Operations |
|--------|---------|----------------|
| **AI Coding Worker** | Execute AI coding requests | - Receive user prompts<br>- Route to provider (Claude/Codex)<br>- Stream SSE responses<br>- Orchestrate GitHub operations |
| **GitHub Worker** | Handle Git operations | - Clone/pull repositories<br>- Create branches (LLM-named)<br>- Commit changes (LLM messages)<br>- Push to remote |
| **Storage Worker** | Manage session persistence | - Store/retrieve sessions<br>- File CRUD operations<br>- Session metadata<br>- Interface to MinIO |

### Request Flow Example: New Chat Session

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

**Note:** The `/init-session` endpoint combines `/clone-repository` and `/create-branch` into a single call, avoiding the 429 busy response that could occur when calling two endpoints sequentially.

### SSE Event Flow with Source Indicators

All workers emit SSE events with a `source` field to identify origin:

```
┌──────────────────┐
│   Website Chat   │◄─────────────────────────────────────────┐
└──────────────────┘                                          │
                                                              │
Events from different sources:                                │
                                                              │
[ai-coding-worker] Initializing session...                    │
[github-worker] Cloning repository...                         │
[github-worker] Repository cloned successfully                │
[github-worker] Creating branch: webedt/add-dark-mode-abc123  │
[claude] I'll help you add dark mode...                       │
[claude] 📝 Editing src/App.tsx                               │
[claude] ✓ Changes complete                                   │
[github-worker] Committing changes...                         │
[github-worker] Pushed to remote successfully                 │
[ai-coding-worker] Session completed                          ▼
```

**Event Source Types:**
- `ai-coding-worker` - Orchestration events
- `github-worker` - Git/GitHub operations
- `storage-worker` - Storage operations
- `claude-agent-sdk` / `claude` - Claude AI responses
- `codex-sdk` / `codex` - Codex AI responses

### Docker Swarm Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Swarm Cluster                        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  webedt-app-ai-coding-workers-gy4wew_ai-coding-worker     │ │
│  │  ├── replica 1  (idle)                                    │ │
│  │  ├── replica 2  (busy → processing request)               │ │
│  │  ├── replica 3  (idle)                                    │ │
│  │  ├── ...                                                  │ │
│  │  └── replica 10 (idle)                                    │ │
│  │  Port: *:5001→5000                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  webedt-app-github-workers-x4o1nh_github-worker           │ │
│  │  ├── replica 1-5 (ephemeral)                              │ │
│  │  Port: *:5003→5002                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  webedt-app-storage-worker-t1avua_storage-worker          │ │
│  │  ├── replica 1-2 (persistent)                             │ │
│  │  Internal network only                                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  webedt-app-storage-worker-t1avua_minio                   │ │
│  │  MinIO S3-compatible storage                               │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Common Architectural Patterns

### Ephemeral Worker Model

AI Coding Worker, GitHub Worker, and Collaborative Session Worker all use an ephemeral worker model:

- Workers exit after completing each job (`process.exit(0)` on success)
- Docker Swarm automatically restarts workers after exit
- Provides clean state for each request
- Natural load balancing (idle workers accept new requests)
- Prevents memory leaks over time
- Workers return 429 status when busy

### Session Management

Projects use isolated workspace patterns:

- Each session gets isolated workspace: `/workspace/session-{uuid}/`
- Metadata stored in `.session-metadata.json` or `metadata.json`
- Session state persists across worker restarts
- Workspaces can be backed by volumes or object storage (MinIO)

### Docker Swarm Deployment

Common deployment pattern across worker services:

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

**Common Swarm Configuration:**
- Multiple worker replicas (5-10) for load balancing
- Restart policy: `any` condition
- Rolling updates with automatic rollback
- Resource limits (CPU: 0.5-2 cores, Memory: 1-4GB per worker)

### Environment Variables

Common environment variable patterns:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | varies | Server port (5000, 8080, etc.) |
| `WORKSPACE_DIR` | `/workspace` | Base directory for session workspaces |
| `NODE_ENV` | `production` | Node environment |

## Development Commands

### Common Node.js Patterns

```bash
# Install dependencies
npm install
# or
pnpm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start

# Run tests (if available)
npm test
```

### Docker Development Patterns

```bash
# Build Docker image
docker build -t {project-name}:latest .

# Test with Docker Compose
docker-compose up

# View logs
docker-compose logs -f
```

## API Reference

### AI Coding Worker (port 5001)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with worker status |
| `/status` | GET | Worker idle/busy status |
| `/sessions` | GET | List all sessions |
| `/execute` | POST | Execute AI coding request (SSE) |
| `/abort` | POST | Abort current execution |
| `/init-repository` | POST | Initialize repository in session |

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
| `/api/storage-worker/sessions/:path/files/*` | GET | Read file content |
| `/api/storage-worker/sessions/:path/files/*` | PUT | Write file content |
| `/api/storage-worker/sessions/:path/files/*` | DELETE | Delete file |

## Testing

### Running API Tests

Each worker has API tests that can be run against local or production endpoints:

```bash
# AI Coding Worker tests
cd ai-coding-worker
AI_CODING_WORKER_URL=http://localhost:5001 npm run test:api

# Storage Worker tests
cd storage-worker
STORAGE_WORKER_URL=http://localhost:3000 npm run test:api
```

### Testing from Production Server

```bash
# Test via SSH to production server
ssh ehub2023 'curl -s http://127.0.0.1:5001/health | jq'
ssh ehub2023 'curl -s http://127.0.0.1:5003/health | jq'

# Test storage worker via Docker network
ssh ehub2023 'docker exec $(docker ps --filter "name=ai-coding-worker" -q | head -1) \
  node -e "fetch(\"http://storage-worker:3000/health\").then(r=>r.text()).then(console.log)"'
```

### Environment Variables for Testing

Create `.env` files from `.env.example` in each worker directory. Key variables:

```bash
# For test files
AI_CODING_WORKER_URL=http://localhost:5001
STORAGE_WORKER_URL=http://localhost:3000
CODING_ASSISTANT_PROVIDER=ClaudeAgentSDK
CODING_ASSISTANT_AUTHENTICATION={"claudeAiOauth":{...}}
```

## Project-Specific Details

For detailed information about each project, see the respective CLAUDE.md files:

- **AI Coding Worker**: [ai-coding-worker/CLAUDE.md](ai-coding-worker/CLAUDE.md)
  - Provider system (Claude Code, Codex)
  - SSE streaming endpoints
  - GitHub integration
  - Authentication handling
  - Image support for multimodal requests

- **Collaborative Session Worker**: [collaborative-session-worker/CLAUDE.md](collaborative-session-worker/CLAUDE.md)
  - WebSocket protocols and message types
  - CRDT synchronization with Yjs
  - MinIO integration
  - Auto-commit functionality
  - Collaboration manager

- **GitHub Worker**: [github-worker/CLAUDE.md](github-worker/CLAUDE.md)
  - Repository cloning and pulling
  - Branch creation with LLM-generated names
  - Commit and push with LLM-generated messages
  - SSE streaming for real-time progress
  - Ephemeral worker model

- **Website**: [website/CLAUDE.md](website/CLAUDE.md)
  - Path-based routing requirements
  - Vite and React Router configuration
  - Dokploy deployment patterns
  - Version management
  - Deployment URLs and links

## Website Deployment Link Requirements

**CRITICAL REQUIREMENT (Website Project):** When working on the `/website` project and completing ANY task that involves code changes, commits, or pushes, you MUST ALWAYS display clickable links to:

1. The GitHub repository (linked to the specific branch)
2. The deployment site (using path-based routing)

**Required Format:**

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch-name}](https://github.com/webedt/monorepo/tree/{branch-name})
Live Site: [https://github.etdofresh.com/webedt/monorepo/{branch}/](https://github.etdofresh.com/webedt/monorepo/{branch}/)
```

**Deployment URL Construction:**

The deployment URL uses path-based routing:

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

- Owner and repo are converted to lowercase
- Branch name preserves original case
- Slashes in branch names are replaced with dashes
- Example: `claude/test-feature` → `https://github.etdofresh.com/webedt/monorepo/claude-test-feature/`

**Example:**

```
Branch: claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD

**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD](https://github.com/webedt/monorepo/tree/claude/rename-session-013mmcCbpCN5AGE8fbU3GKSD)
Live Site: [https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/](https://github.etdofresh.com/webedt/monorepo/claude-rename-session-013mmcCbpCN5AGE8fbU3GKSD/)
```

See [website/CLAUDE.md](website/CLAUDE.md) for complete details on path-based routing and deployment URLs.

## Working with Multiple Projects

When working across multiple projects:

1. **Always check the project-specific CLAUDE.md** for special requirements
2. **Use consistent git commit messages** across all projects
3. **Test changes locally** before pushing
4. **Build and verify compilation** - Run `npm run build` (or `pnpm run build`) before committing and pushing to ensure there are no TypeScript or build errors
5. **Consider dependencies** between projects if changes affect multiple services

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

*Documentation last updated: 2025-12-05*
