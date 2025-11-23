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

## Working with Multiple Projects

When working across multiple projects:

1. **Always check the project-specific CLAUDE.md** for special requirements
2. **Use consistent git commit messages** across all projects
3. **Test changes locally** before pushing
4. **Consider dependencies** between projects if changes affect multiple services

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

*Documentation last updated: 2025-11-23*
