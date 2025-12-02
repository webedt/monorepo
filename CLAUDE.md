# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing multiple related projects:

| Project | Path | Description |
|---------|------|-------------|
| **AI Coding Worker** | `/ai-coding-worker` | Provider-agnostic API for executing coding assistant requests with Docker Swarm orchestration |
| **Collaborative Session Worker** | `/collaborative-session-worker` | WebSocket-based real-time collaboration with CRDT synchronization and MinIO persistence |
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
| List files | ✅ Yes | ❌ No (fallback only) |
| Delete file | ✅ Yes | ❌ No |
| Create commits | ❌ No | ✅ Yes |
| Create PRs | ❌ No | ✅ Yes |
| Branch operations | ❌ No | ✅ Yes |
| AI coding execution | N/A | Via ai-coding-worker |

### Session Path Format

Storage worker uses session paths in the format: `{owner}/{repo}/{branch}`

Example: `webedt/monorepo/webedt/feature-branch`

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

## Common Architectural Patterns

### Ephemeral Worker Model

Both the AI Coding Worker and Collaborative Session Worker use an ephemeral worker model:

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

*Documentation last updated: 2025-11-23*
