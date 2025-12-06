# Main Server

Consolidated main server for WebEDT - a single persistent service that handles API endpoints, database operations, storage management, and GitHub integration.

## Architecture

This server consolidates functionality that was previously split across multiple workers:

| Consolidated From | Functionality |
|-------------------|---------------|
| Website Server | API routes, authentication, sessions |
| Storage Worker | MinIO session management, file operations |
| GitHub Worker | Clone, branch, commit, push operations |

The Main Server orchestrates AI Coding Workers, which remain as separate ephemeral containers that only handle LLM execution.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Main Server                                 │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ API Routes  │  │  Database   │  │   Storage   │  │   GitHub    │   │
│  │ /execute    │  │ PostgreSQL  │  │   MinIO     │  │ Clone/Push  │   │
│  │ /resume     │  │ Drizzle ORM │  │   Tarball   │  │ Branch/PR   │   │
│  │ /sessions   │  │             │  │             │  │             │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          Spawn/Orchestrate
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │   AI Coding Worker        │
                    │   (Ephemeral Container)   │
                    │   - Claude Agent SDK      │
                    │   - LLM Execution Only    │
                    └───────────────────────────┘
```

## Project Structure

```
main-server/
├── src/
│   ├── index.ts                 # Express app entrypoint
│   ├── auth.ts                  # Lucia authentication setup
│   ├── config/
│   │   └── env.ts               # Environment configuration
│   ├── db/
│   │   ├── index.ts             # Drizzle database setup
│   │   └── schema.ts            # PostgreSQL schema
│   ├── routes/
│   │   ├── execute.ts           # POST /api/execute (SSE)
│   │   ├── resume.ts            # GET /api/resume/:sessionId (SSE)
│   │   ├── auth.ts              # Authentication endpoints
│   │   ├── user.ts              # User settings endpoints
│   │   ├── sessions.ts          # Session CRUD endpoints
│   │   ├── github.ts            # GitHub OAuth/repos endpoints
│   │   └── storage-worker.ts    # Storage operations proxy
│   ├── services/
│   │   ├── storage/
│   │   │   ├── storageService.ts  # MinIO operations
│   │   │   └── minioClient.ts     # MinIO client setup
│   │   └── github/
│   │       ├── gitHelper.ts       # Git operations (simple-git)
│   │       ├── githubClient.ts    # GitHub clone/pull
│   │       └── operations.ts      # Init session, commit, push
│   ├── middleware/
│   │   └── auth.ts              # Authentication middleware
│   ├── lib/
│   │   ├── claudeAuth.ts        # Claude OAuth token management
│   │   ├── codexAuth.ts         # Codex/OpenAI auth helpers
│   │   ├── llmHelper.ts         # LLM naming (branch, commit)
│   │   └── sessionEventBroadcaster.ts
│   └── utils/
│       ├── logger.ts            # Logging utility
│       ├── emojiMapper.ts       # SSE event emoji assignment
│       ├── sessionPathHelper.ts # Session path utilities
│       └── previewUrlHelper.ts  # Preview URL generation
├── package.json
├── tsconfig.json
└── Dockerfile
```

## API Endpoints

### Health Check

```
GET /health
```

Returns server status, container ID, and build info.

### Execute (Main Entry Point)

```
POST /api/execute
Content-Type: application/json

{
  "userRequest": "Add dark mode toggle",
  "websiteSessionId": "optional-existing-session-id",
  "github": {
    "repoUrl": "https://github.com/owner/repo",
    "branch": "main"
  },
  "autoCommit": true
}
```

Returns SSE stream with progress events.

### Resume Session

```
GET /api/resume/:sessionId
```

Reconnect to an existing session and replay events.

### Authentication

```
POST /api/auth/register     - Register new user
POST /api/auth/login        - Login with email/password
POST /api/auth/logout       - Logout
GET  /api/auth/session      - Get current session
```

### User Settings

```
POST /api/user/claude-auth        - Update Claude OAuth tokens
POST /api/user/preferred-provider - Set preferred AI provider
```

### Sessions

```
GET    /api/sessions        - List user's sessions
GET    /api/sessions/:id    - Get session details
DELETE /api/sessions/:id    - Delete session
```

### GitHub

```
GET /api/github/oauth       - Start GitHub OAuth flow
GET /api/github/repos       - List user's repositories
```

### Storage (Proxied)

```
GET    /api/storage-worker/sessions/:path/files     - List files
GET    /api/storage-worker/sessions/:path/files/*   - Read file
PUT    /api/storage-worker/sessions/:path/files/*   - Write file
DELETE /api/storage-worker/sessions/:path/files/*   - Delete file
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment (development/production) |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowed origins (comma-separated) |
| `SESSION_SECRET` | - | Session encryption secret |

### MinIO Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ENDPOINT` | `localhost` | MinIO server hostname |
| `MINIO_PORT` | `9000` | MinIO server port |
| `MINIO_USE_SSL` | `false` | Use SSL for MinIO |
| `MINIO_ROOT_USER` | - | MinIO access key |
| `MINIO_ROOT_PASSWORD` | - | MinIO secret key |
| `MINIO_BUCKET` | `sessions` | Bucket name for sessions |

### AI Worker Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_WORKER_URL` | `http://localhost:5001` | AI Coding Worker URL |
| `AI_WORKER_TIMEOUT_MS` | `600000` | Worker timeout (10 min) |

### GitHub Configuration

| Variable | Description |
|----------|-------------|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |

### Directory Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TMP_DIR` | `/tmp` | Temporary directory |
| `WORKSPACE_DIR` | `/workspace` | Session workspace root |

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL database
- MinIO server (for session storage)

### Setup

```bash
# Install dependencies
npm install

# Set environment variables
export DATABASE_URL=postgresql://user:pass@localhost:5432/webedt
export MINIO_ENDPOINT=localhost
export MINIO_ROOT_USER=minioadmin
export MINIO_ROOT_PASSWORD=minioadmin

# Run in development mode
npm run dev
```

### Build

```bash
# Build TypeScript
npm run build

# Run production build
npm start
```

### Docker

```bash
# Build image
docker build -t main-server .

# Run container
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e MINIO_ENDPOINT=minio \
  main-server
```

## Database

The server uses PostgreSQL with Drizzle ORM. Tables are auto-created on startup.

### Schema

- `users` - User accounts with OAuth tokens
- `sessions` - Lucia auth sessions
- `chat_sessions` - AI coding sessions
- `messages` - Chat messages per session
- `events` - Raw SSE events for replay

### Migrations

```bash
npm run db:generate   # Generate migrations
npm run db:migrate    # Run migrations
npm run db:push       # Push schema changes
npm run db:studio     # Open Drizzle Studio
```

## Notes

- SQLite support was removed to simplify builds. See `src/db/SQLITE_REMOVED.md` for reintroduction instructions.
- The server requires `DATABASE_URL` to be set - there is no fallback database.
