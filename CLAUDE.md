# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebEDT is an AI-powered code editing platform. This monorepo contains a vanilla TypeScript frontend, Express backend, and shared utilities.

## Monorepo Structure

| Package | Path | Description |
|---------|------|-------------|
| **Shared** | `/shared` | Core business logic, auth, database, GitHub operations |
| **CLI** | `/cli` | Administration CLI (session, admin, github commands) |
| **Frontend** | `/website/frontend` | Vanilla TypeScript SPA (Vite) |
| **Backend** | `/website/backend` | Express API server |
| **Tools** | `/tools/*` | CLI utilities (autonomous-dev-cli, claude-web-cli) |

## Development Commands

```bash
# Start all services (shared watch + frontend dev + backend dev)
npm run dev

# Build everything
npm run build

# Clean all build artifacts
npm run clean
```

### Per-Package Commands

**Frontend** (`website/frontend`):
```bash
npm run dev      # Vite dev server with hot reload
npm run build    # Production build
npm run preview  # Preview production build
```

**Backend** (`website/backend`):
```bash
npm run dev      # tsx watch with auto-reload
npm run build    # TypeScript compilation
npm run db:push  # Push schema to database
npm run db:studio # Open Drizzle Studio
```

**CLI** (`cli`):
```bash
npm run cli              # From monorepo root
npm run dev -- session list    # List sessions
npm run dev -- admin users     # List users
npm run dev -- github repos    # List repos
```

**Shared** (`shared`):
```bash
npm run dev   # tsc --watch
npm run build # TypeScript compilation
npm run test  # Run tests
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  website/frontend (Vite + Vanilla TypeScript)                               │
│  - SPA with CSS theming                                                     │
│  - SSE streaming for real-time updates                                      │
│  - Component-based UI (vanilla TS, no framework)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                              HTTP/SSE API
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                         │
│  website/backend (Express API Server)                                        │
│  - REST API routes (auth, sessions, github, admin)                          │
│  - SSE streaming endpoints                                                  │
│  - Static file serving                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                              Imports from
                                    │
┌───────────────────────────────────┴───────────────────────────────────────┐
│                                                                            │
▼                                                                            ▼
┌─────────────────────────────────┐    ┌─────────────────────────────────────┐
│              CLI                 │    │              SHARED                  │
│  cli (Administration Commands)   │    │  shared (Core Business Logic)        │
│  - session list/get/delete      │───▶│  - Authentication (Lucia, OAuth)    │
│  - admin users/create-user      │    │  - Database (Drizzle + PostgreSQL)  │
│  - github branches/repos/pr     │    │  - GitHub/Git operations            │
└─────────────────────────────────┘    │  - Session management               │
                                       │  - Utilities (retry, circuit breaker)│
                                       └─────────────────────────────────────┘
                                                         │
                                                         ▼
                                                PostgreSQL Database
```

---

### Frontend (`website/frontend/src/`)

- **`components/`** - Vanilla TypeScript UI components (Button, Card, Input, Modal, etc.)
- **`pages/`** - Page components (Login, Register, Dashboard, Agents, Chat, Code, Settings, Trash)
- **`stores/`** - Simple state management (authStore, repoStore, workerStore)
- **`lib/`** - Utilities (api.ts, router.ts, events.ts for SSE, theme.ts)
- **`styles/`** - CSS with custom properties for theming

---

### Backend (`website/backend/src/`)

The backend is a thin API layer that imports core logic from the shared package.

- **`api/routes/`** - Express route handlers
  - `auth.ts` - Authentication (register, login, logout)
  - `sessions.ts` - Session CRUD operations
  - `executeRemote.ts` - Claude Remote execution (SSE)
  - `resume.ts` - Event replay streaming
  - `github.ts` - GitHub OAuth and repo operations
  - `workspace.ts` - Workspace file operations
  - `admin.ts` - Admin user management
  - `liveChat.ts` - Live chat endpoints
  - `transcribe.ts` - Audio transcription (OpenAI Whisper)
  - `imageGen.ts` - Image generation
  - `logs.ts` - Server log viewing
- **`api/middleware/`** - Auth middleware
- **`scripts/`** - Database utilities (db-check, db-backup, db-validate)

---

### CLI (`cli/src/`)

Standalone administration CLI for managing the platform without the web server.

- **`commands/`** - CLI command modules
  - `auth.ts` - Authentication utilities (check, refresh, ensure token validity)
  - `claude.ts` - Claude Web Sessions (list, execute, resume, archive, test scenarios)
  - `db.ts` - Database operations (sessions, users CRUD)
  - `github.ts` - GitHub operations (repos, branches, pull requests)

---

### Shared (`shared/src/`)

The shared package contains all core business logic, reusable across backend and CLI.

- **`auth/`** - Authentication providers
  - `lucia.ts` - Lucia auth setup
  - `claudeAuth.ts` - Claude OAuth helpers
  - `codexAuth.ts` - Codex auth helpers
  - `geminiAuth.ts` - Gemini auth helpers
- **`db/`** - Database layer
  - `schema.ts` - Drizzle ORM schema (users, sessions, messages, events)
  - `connection.ts` - PostgreSQL connection management
  - `migrations.ts` - Database migrations
- **`github/`** - Git/GitHub operations
  - `gitHelper.ts` - Low-level git operations (simple-git)
  - `githubClient.ts` - Octokit wrapper
  - `operations.ts` - High-level operations (clone, branch, push, PR)
- **`execution/providers/`** - Execution orchestration
  - `claudeRemoteProvider.ts` - Claude Remote Sessions provider
  - `types.ts` - Provider interfaces
- **`sessions/`** - Session management
  - `claudeSessionSync.ts` - Background sync service
  - `sessionEventBroadcaster.ts` - SSE event broadcasting
  - `sessionListBroadcaster.ts` - Session list updates
- **`claudeRemote/`** - Claude Remote Sessions API client
  - `claudeRemoteClient.ts` - API client
  - `titleGenerator.ts` - Session title generation
  - `types.ts` - Type definitions
- **Utilities**:
  - `circuitBreaker.ts` - Circuit breaker pattern
  - `healthMonitor.ts` - Health check system
  - `metrics.ts` - Performance metrics
  - `recovery.ts` - Session recovery
  - `retry.ts` - Retry logic with backoff
  - `logger.ts` / `logCapture.ts` - Structured logging
  - `emojiMapper.ts` - SSE emoji decoration
  - `previewUrlHelper.ts` - Preview URL generation
  - `sessionPathHelper.ts` - Session path utilities

## Database

- **PostgreSQL** with **Drizzle ORM**
- Tables: `users`, `sessions`, `chatSessions`, `messages`, `events`

## Key API Routes

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/execute-remote` | POST | Execute AI request (SSE) |
| `/api/resume/:sessionId` | GET | Replay stored events (SSE) |
| `/api/auth/*` | - | Authentication (register, login, logout, session) |
| `/api/sessions/*` | - | Session CRUD |
| `/api/github/*` | - | GitHub OAuth and repo operations |
| `/health`, `/ready`, `/live` | GET | Health/Kubernetes probes |

## Environment Variables

Required in `.env` (copy from `.env.example`):

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/webedt
SESSION_SECRET=your-secret-key
FRONTEND_PORT=3000
BACKEND_PORT=3001
```

Optional:
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` - GitHub OAuth
- `CLAUDE_ENVIRONMENT_ID` - Claude Remote Sessions
- `OPENAI_API_KEY` - Audio transcription
- `OPENROUTER_API_KEY` - Title generation

## Docker Build

Single multi-stage image containing frontend and backend:

```bash
docker build \
  --build-arg BUILD_COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --build-arg BUILD_VERSION=0.0.$(git rev-list --count HEAD) \
  -t webedt .
```

Exposes ports 3000 (frontend) and 3001 (backend API).

## Version Display

The frontend displays version as `v0.0.{commit_count}` with toggleable details showing `{sha} [{timestamp}]`. Version info is injected at build time via `vite-plugin-version-mark`.

## Coding Style

See [CODING_STYLE.md](CODING_STYLE.md) for detailed conventions. Key points:

### Imports

```typescript
// Value imports can be grouped
import { randomUUID } from 'crypto';
import { AClaudeWebClient } from './AClaudeWebClient.js';

// Type imports: one per line with `import type`
import type { ClaudeWebClientConfig } from './types.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
```

### Abstract Class Pattern

| File | JSDoc | Purpose |
|------|-------|---------|
| `AClassName.ts` | None | Abstract method signatures only, no documentation |
| `className.doc.ts` | Full | Interface with complete documentation |
| `className.ts` | None | Implementation, no documentation |

### Method Signatures (Abstract Classes)

```typescript
abstract methodName(
  param1: Type1,
  param2: Type2
): ReturnType;
```

## Git Commit Messages

- Use imperative mood, present tense
- Start with capital letter and verb
- No prefixes (`feat:`, `fix:`, etc.) or emojis
- Good verbs: Add, Update, Remove, Fix, Refactor, Enhance, Rename

## Debugging Strategy

When debugging issues in the website (frontend/backend), use the CLI first to isolate problems:

```
CLI (direct shared lib) → Backend (shared lib + routes) → Frontend (full stack)
```

**Why CLI-first debugging:**
- **Isolated testing** - No browser, no frontend state, no backend routes. Direct calls to the shared library.
- **Clear output** - See exactly what events come back with `--jsonl` or `--raw` vs formatted default view.
- **Faster iteration** - Run a command, see the result, tweak, repeat. No UI navigation needed.
- **Same code path** - CLI and backend both use `ClaudeWebClient` from shared, so CLI success = shared lib works.

**Debugging flow:**
1. If something fails in the website, try the equivalent CLI command first
2. If CLI works → problem is in backend routes or frontend
3. If CLI fails → problem is in the shared library itself

**CLI commands for debugging:**
```bash
# Execute and see all events
npm run dev -- claude web execute <gitUrl> "prompt"

# See raw WebSocket frames (pre-parsing)
npm run dev -- claude web execute <gitUrl> "prompt" --raw

# See parsed events as JSON Lines
npm run dev -- claude web execute <gitUrl> "prompt" --jsonl

# Get session details
npm run dev -- claude web get <sessionId>

# Get session events
npm run dev -- claude web events <sessionId>

# Resume a session
npm run dev -- claude web resume <sessionId> "follow-up message"
```

See [cli/EXAMPLE_RUNS.md](cli/EXAMPLE_RUNS.md) for detailed output examples.

## CLI Command Reference

All commands are run from the monorepo root with `npm run cli -- <command>`.

### Authentication (`auth`)

| Command | Description |
|---------|-------------|
| `auth check` | Check Claude authentication status |
| `auth check --json` | Output auth status as JSON |
| `auth refresh` | Refresh Claude access token |
| `auth ensure` | Ensure token is valid (refresh if needed) |

### Claude Web Sessions (`claude web`)

Global options: `--token`, `--environment`, `--org`

| Command | Description |
|---------|-------------|
| `claude web list` | List remote sessions |
| `claude web list --today` | List today's sessions only |
| `claude web get <sessionId>` | Get session details |
| `claude web events <sessionId>` | Get session events |
| `claude web execute <gitUrl> "prompt"` | Execute a task |
| `claude web execute ... --jsonl` | Stream events as JSON Lines |
| `claude web execute ... --raw` | Stream raw WebSocket frames |
| `claude web resume <sessionId> "message"` | Resume with follow-up |
| `claude web archive <sessionId>` | Archive a session |
| `claude web archive --today` | Archive all today's sessions |
| `claude web rename <sessionId> "title"` | Rename a session |
| `claude web interrupt <sessionId>` | Interrupt running session |
| `claude web can-resume <sessionId>` | Check if session can be resumed |
| `claude web send <sessionId> "message"` | Send message (fire-and-forget) |
| `claude web set-permission <sessionId>` | Set permission mode |
| `claude web discover-env` | Discover environment ID |

### Claude Test Scenarios (`claude web test`)

| Command | Description |
|---------|-------------|
| `claude web test scenario1` | Execute + wait + resume |
| `claude web test scenario2` | Execute + early terminate + interrupt |
| `claude web test scenario3` | Execute + terminate + queue resume |
| `claude web test scenario4` | Execute + terminate + interrupt + resume |
| `claude web test scenario5` | Double-queue test |
| `claude web test scenario6` | Execute + rename |
| `claude web test scenario7` | Execute + complete + archive |
| `claude web test scenario8` | WebSocket streaming |
| `claude web test all` | Run all scenarios |

### Database Sessions (`db sessions`)

| Command | Description |
|---------|-------------|
| `db sessions list` | List all sessions |
| `db sessions list -u <userId>` | Filter by user |
| `db sessions get <sessionId>` | Get session details |
| `db sessions delete <sessionId> -f` | Delete session |
| `db sessions cleanup` | Clean orphaned sessions |
| `db sessions cleanup --dry-run` | Preview cleanup |
| `db sessions events <sessionId>` | List session events |

### Database Users (`db users`)

| Command | Description |
|---------|-------------|
| `db users list` | List all users |
| `db users get <userId>` | Get user details |
| `db users create <email> <password>` | Create new user |
| `db users create ... --admin` | Create admin user |
| `db users set-admin <userId> true` | Set admin status |
| `db users delete <userId> -f` | Delete user |

### GitHub (`github`)

Global options: `--token`

| Command | Description |
|---------|-------------|
| `github repos list` | List accessible repos |
| `github branches list <owner> <repo>` | List branches |
| `github branches create <owner> <repo> <name>` | Create branch |
| `github branches delete <owner> <repo> <name> -f` | Delete branch |
| `github pr list <owner> <repo>` | List pull requests |
| `github pr create <owner> <repo> <head> <base>` | Create PR |

### Shell Completion (`completion`)

The CLI supports shell completion for bash, zsh, and fish. This enables tab-completion for all commands, subcommands, and options.

| Command | Description |
|---------|-------------|
| `completion bash` | Generate bash completion script |
| `completion zsh` | Generate zsh completion script |
| `completion fish` | Generate fish completion script |
| `completion install <shell>` | Display installation instructions |

**Quick Installation:**

```bash
# Bash
webedt completion bash > ~/.local/share/bash-completion/completions/webedt

# Zsh
mkdir -p ~/.zsh/completions
webedt completion zsh > ~/.zsh/completions/_webedt
# Add to ~/.zshrc: fpath=(~/.zsh/completions $fpath)

# Fish
webedt completion fish > ~/.config/fish/completions/webedt.fish
```

Run `webedt completion install <shell>` for detailed instructions.

## Pre-Commit Checklist

Before committing, run in modified package folders:

```bash
npm install
npm run build
```
