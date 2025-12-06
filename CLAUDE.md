# Monorepo Guide for Claude Code

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a monorepo containing the following projects:

| Project | Path | Description |
|---------|------|-------------|
| **Main Server** | `/main-server` | Consolidated persistent server handling API, database, storage, and GitHub operations |
| **AI Coding Worker** | `/ai-coding-worker` | Provider-agnostic ephemeral worker for LLM execution with Docker Swarm orchestration |
| **Website** | `/website` | React web application with path-based routing and Dokploy deployment |

---

## Architecture Overview

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
  │  (Single persistent service - consolidates backend, storage, GitHub)  │
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
  │  - Receives workspace path from Main Server                           │
  │  - Executes Claude Agent SDK / Codex                                  │
  │  - Streams events back to Main Server                                 │
  │  - Exits after each job (Docker Swarm restarts)                       │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Main Server

The Main Server (`/main-server`) is the central backend service that consolidates:
- Website backend API routes
- Storage operations (MinIO)
- GitHub operations (clone, branch, commit, push)
- User authentication (Lucia)
- Session management (PostgreSQL)

### Directory Structure

```
main-server/
├── src/
│   ├── index.ts                    # Express app entrypoint
│   ├── auth.ts                     # Lucia authentication
│   ├── config/
│   │   └── env.ts                  # Environment configuration
│   ├── db/
│   │   ├── index.ts                # PostgreSQL connection
│   │   └── schema.ts               # Database schema
│   ├── routes/
│   │   ├── execute.ts              # Main /execute endpoint
│   │   ├── resume.ts               # Session replay endpoint
│   │   ├── sessions.ts             # Session management
│   │   ├── auth.ts                 # Authentication routes
│   │   ├── user.ts                 # User management
│   │   ├── github.ts               # GitHub OAuth
│   │   ├── storage-worker.ts       # Storage operations
│   │   ├── admin.ts                # Admin routes
│   │   └── transcribe.ts           # Audio transcription
│   ├── services/
│   │   ├── storage/
│   │   │   ├── minioClient.ts      # MinIO client
│   │   │   └── storageService.ts   # Storage operations
│   │   └── github/
│   │       ├── gitHelper.ts        # Git operations
│   │       ├── githubClient.ts     # Repository operations
│   │       └── operations.ts       # High-level GitHub ops
│   ├── middleware/
│   │   └── auth.ts                 # Auth middleware
│   ├── lib/
│   │   ├── claudeAuth.ts           # Claude OAuth helpers
│   │   ├── codexAuth.ts            # Codex auth helpers
│   │   ├── llmHelper.ts            # LLM naming helpers
│   │   └── sessionEventBroadcaster.ts
│   └── utils/
│       ├── logger.ts               # Structured logging
│       ├── sessionPathHelper.ts    # Session path utilities
│       ├── previewUrlHelper.ts     # Preview URL generation
│       └── emojiMapper.ts          # SSE emoji decoration
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml              # Dokploy deployment
└── swarm.yml                       # Docker Swarm deployment
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
| `/api/storage-worker/*` | - | Storage operations (files, sessions) |
| `/api/admin/*` | - | Admin user management |
| `/api/transcribe` | POST | Audio transcription (OpenAI Whisper) |

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
| `STORAGE_WORKER_URL` | - | Main Server URL for storage |
| `GITHUB_WORKER_URL` | - | Main Server URL for GitHub |

---

## Website

React web application with Vite and path-based routing.

### Structure

```
website/
└── apps/
    └── client/           # React frontend
        ├── src/
        │   ├── App.tsx
        │   ├── lib/api.ts
        │   └── ...
        └── index.html
```

### Deployment URLs

Path-based routing via Dokploy:

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Examples:**
- `https://github.etdofresh.com/webedt/monorepo/main/`
- `https://github.etdofresh.com/webedt/monorepo/feature-branch/`

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

## File Management

### Storage Operations

All file operations go through the Main Server storage routes:

```
GET    /api/storage-worker/sessions/:sessionPath/files           - List files
GET    /api/storage-worker/sessions/:sessionPath/files/*         - Read file
PUT    /api/storage-worker/sessions/:sessionPath/files/*         - Write file
DELETE /api/storage-worker/sessions/:sessionPath/files/*         - Delete file
HEAD   /api/storage-worker/sessions/:sessionPath/files/*         - Check exists
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

## Development Commands

### Node.js

```bash
npm install        # Install dependencies
npm run dev        # Development mode
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

## Links After Tasks

**CRITICAL:** After code changes, commits, or pushes, ALWAYS display:

```
**Links:**

GitHub Branch: [https://github.com/webedt/monorepo/tree/{branch}](https://github.com/webedt/monorepo/tree/{branch})
Live Site: [https://github.etdofresh.com/webedt/monorepo/{branch}/](https://github.etdofresh.com/webedt/monorepo/{branch}/)
```

---

## Repository Links

- GitHub: https://github.com/webedt/monorepo
- Issues: https://github.com/webedt/monorepo/issues

---

*Documentation last updated: 2025-12-05*
