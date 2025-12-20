# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing the following projects:

| Project | Path | Description |
|---------|------|-------------|
| **Shared Library** | `/shared` | Core TypeScript library with all business logic, database, auth, GitHub ops |
| **Website Frontend** | `/website/frontend` | React client (Vite) |
| **Website Backend** | `/website/backend` | Express API server serving static files and all API endpoints |
| **Tools** | `/tools/*` | Utility tools (autonomous-dev-cli, claude-web-cli) |

---

## Architecture Overview

```
  ┌───────────────────────────────────────────────────────────────────────┐
  │                    Website Backend (Express)                          │
  │  - Serves React static files from /website/frontend/dist              │
  │  - All API endpoints directly mounted (no proxy)                      │
  │  - Authentication, sessions, GitHub, execution                        │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                         imports business logic
                                    │
                                    ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │                    Shared Library (@webedt/shared)                    │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
  │  │     Auth        │  │    Database     │  │     GitHub      │       │
  │  │  - Lucia        │  │  - PostgreSQL   │  │  - Octokit      │       │
  │  │  - Claude OAuth │  │  - Drizzle ORM  │  │  - simple-git   │       │
  │  │  - Codex/Gemini │  │  - Migrations   │  │  - Operations   │       │
  │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
  │  │   Execution     │  │    Sessions     │  │    Utilities    │       │
  │  │  - Claude Remote│  │  - Background   │  │  - Logger       │       │
  │  │  - Providers    │  │    sync         │  │  - Metrics      │       │
  │  │                 │  │  - Broadcasting │  │  - Health       │       │
  │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Shared Library

The Shared Library (`/shared`) contains all core business logic as a TypeScript library:

### Directory Structure

```
shared/
├── src/
│   ├── index.ts              # Main barrel exports
│   ├── logger.ts             # Structured logging
│   ├── logCapture.ts         # Log capture for /api/logs
│   ├── emojiMapper.ts        # SSE emoji decoration
│   ├── sessionPathHelper.ts  # Session path utilities
│   ├── previewUrlHelper.ts   # Preview URL generation
│   ├── circuitBreaker.ts     # Circuit breaker pattern
│   ├── healthMonitor.ts      # Health check system
│   ├── metrics.ts            # Performance metrics
│   ├── recovery.ts           # Session recovery
│   ├── retry.ts              # Retry logic
│   │
│   ├── auth/                 # Authentication
│   │   ├── lucia.ts          # Lucia auth setup
│   │   ├── claudeAuth.ts     # Claude OAuth helpers
│   │   ├── codexAuth.ts      # Codex auth helpers
│   │   └── geminiAuth.ts     # Gemini auth helpers
│   │
│   ├── config/               # Configuration
│   │   └── env.ts            # Environment variables
│   │
│   ├── db/                   # Database
│   │   ├── index.ts          # PostgreSQL connection
│   │   ├── connection.ts     # Connection management
│   │   ├── schema.ts         # Drizzle ORM schema
│   │   └── migrations.ts     # Database migrations
│   │
│   ├── execution/            # Execution providers
│   │   └── providers/
│   │       ├── claudeRemoteProvider.ts
│   │       └── types.ts
│   │
│   ├── github/               # GitHub operations
│   │   ├── gitHelper.ts      # Low-level git operations
│   │   ├── githubClient.ts   # Octokit wrapper
│   │   └── operations.ts     # High-level GitHub ops
│   │
│   ├── sessions/             # Session management
│   │   ├── claudeSessionSync.ts      # Background sync service
│   │   ├── sessionEventBroadcaster.ts # SSE event broadcasting
│   │   └── sessionListBroadcaster.ts  # Session list updates
│   │
│   └── claudeRemote/         # Claude Remote Sessions API
│       ├── claudeRemoteClient.ts
│       ├── titleGenerator.ts
│       └── types.ts
│
├── package.json
└── tsconfig.json
```

### Usage

```typescript
import {
  // Auth
  lucia, verifyPassword, hashPassword,
  shouldRefreshClaudeToken, refreshClaudeToken,

  // Database
  db, users, chatSessions, events, messages,

  // GitHub
  GitHelper, GitHubClient, githubOperations,

  // Utilities
  logger, healthMonitor, metrics,

  // Config
  PORT, NODE_ENV, ALLOWED_ORIGINS,
} from '@webedt/shared';
```

---

## Website

The Website (`/website`) contains both the React frontend and Express backend.

### Structure

```
website/
├── frontend/                  # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx
│   │   ├── lib/api.ts
│   │   └── ...
│   └── package.json
├── backend/                   # Express API server
│   ├── src/
│   │   ├── index.ts          # Express app + API routes
│   │   ├── api/
│   │   │   ├── routes/       # All API route handlers
│   │   │   └── middleware/   # Auth middleware
│   │   ├── cli/              # CLI commands
│   │   └── scripts/          # DB utilities
│   └── package.json
├── Dockerfile                 # Multi-stage build
└── docker-compose.yml
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with service status |
| `/api/execute-remote` | POST | Execute AI request (SSE) |
| `/api/resume/:sessionId` | GET | Replay stored events (SSE) |
| `/api/auth/*` | - | Authentication (register, login, logout, session) |
| `/api/user/*` | - | User management (claude-auth, preferred-provider) |
| `/api/sessions/*` | - | Session CRUD operations |
| `/api/github/*` | - | GitHub OAuth and repo operations |
| `/api/admin/*` | - | Admin user management |
| `/api/transcribe` | POST | Audio transcription (OpenAI Whisper) |
| `/api/logs` | GET/DELETE | Server logs |

### CLI Usage

```bash
# Run CLI (requires DATABASE_URL env)
cd website/backend
npm run cli -- <command>

# Session commands
npm run cli -- session list
npm run cli -- session get <id>
npm run cli -- session delete <id> -f

# GitHub commands
npm run cli -- github repos
npm run cli -- github branches <owner> <repo>

# Admin commands
npm run cli -- admin users
npm run cli -- admin create-user <email> <password>
```

### Deployment URLs

Path-based routing via Dokploy:

```
https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/
```

**IMPORTANT:** For branch names containing slashes (`/`), replace them with hyphens (`-`) in the URL.

---

## Tools

Tools are standalone utilities in the `/tools` directory:

| Tool | Path | Description |
|------|------|-------------|
| autonomous-dev-cli | `/tools/autonomous-dev-cli` | Long-running autonomous development daemon |
| claude-web-cli | `/tools/claude-web-cli` | CLI for Claude Remote Sessions API |

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

---

## Pre-Commit Checklist

**MANDATORY:** Before committing changes, run these commands:

```bash
npm install        # Ensure dependencies are up to date
npm run build      # Verify no build/compilation errors
```

---

## Local Development

### Starting the Development Server

From the monorepo root directory:

```bash
npm run dev
```

This starts all services concurrently:
- **Shared** (TypeScript watch)
- **Frontend** (Vite dev server): `http://localhost:5173`
- **Backend** (Express): `http://localhost:3000`

### Test Credentials

- **Email:** `testuser@example.com`
- **Password:** `password123`

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | Environment mode |
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Session encryption secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |
| `OPENAI_API_KEY` | OpenAI API key (for transcription) |

---

## Links After Tasks

**CRITICAL:** After code changes, commits, or pushes, ALWAYS display:

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch}](https://github.com/webedt/monorepo/tree/{branch})
Live Site: [https://webedt.etdofresh.com/github/webedt/monorepo/{branch-with-slashes-as-hyphens}/](https://webedt.etdofresh.com/github/webedt/monorepo/{branch-with-slashes-as-hyphens}/)
```

---

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

*Documentation last updated: 2025-12-20*
