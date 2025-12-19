# Internal API Server

Internal API server for WebEDT - a single persistent service that handles API endpoints, database operations, and GitHub integration. This server is only accessible internally via the dokploy-network.

## Architecture

This server uses Claude Remote Sessions for AI execution - all LLM processing is handled by Anthropic's API, making the architecture fully ephemeral.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Internal API Server                              │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │ API Routes  │  │  Database   │  │   GitHub    │                     │
│  │ /execute-   │  │ PostgreSQL  │  │ Clone/Push  │                     │
│  │  remote     │  │ Drizzle ORM │  │ Branch/PR   │                     │
│  │ /resume     │  │             │  │             │                     │
│  │ /sessions   │  │             │  │             │                     │
│  └─────────────┘  └─────────────┘  └─────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                          Anthropic API (Claude Remote)
                                    │
                                    ▼
                    ┌───────────────────────────┐
                    │   Claude Remote Sessions  │
                    │   (Anthropic hosted)      │
                    │   - No local workers      │
                    │   - Fully ephemeral       │
                    └───────────────────────────┘
```

## Project Structure

```
internal-api-server/
├── src/
│   ├── index.ts                 # Express app entrypoint
│   ├── api/
│   │   ├── routes/
│   │   │   ├── executeRemote.ts # Claude Remote execution
│   │   │   ├── resume.ts        # Session replay (SSE)
│   │   │   ├── auth.ts          # Authentication endpoints
│   │   │   ├── user.ts          # User settings endpoints
│   │   │   ├── sessions.ts      # Session CRUD endpoints
│   │   │   ├── github.ts        # GitHub OAuth/repos endpoints
│   │   │   └── admin.ts         # Admin endpoints
│   │   └── middleware/
│   │       └── auth.ts          # Authentication middleware
│   ├── logic/
│   │   ├── auth/
│   │   │   ├── lucia.ts         # Lucia authentication
│   │   │   └── claudeAuth.ts    # Claude OAuth helpers
│   │   ├── config/
│   │   │   └── env.ts           # Environment configuration
│   │   ├── db/
│   │   │   ├── index.ts         # Drizzle database setup
│   │   │   └── schema.ts        # PostgreSQL schema
│   │   ├── github/
│   │   │   ├── gitHelper.ts     # Git operations (simple-git)
│   │   │   ├── githubClient.ts  # GitHub clone/pull
│   │   │   └── operations.ts    # Init session, commit, push
│   │   ├── sessions/
│   │   │   ├── claudeSessionSync.ts      # Background sync
│   │   │   └── sessionEventBroadcaster.ts # SSE events
│   │   └── utils/
│   │       ├── logger.ts        # Logging utility
│   │       └── sessionPathHelper.ts # Session path utilities
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

### Execute Remote (Claude Remote Sessions)

```
POST /api/execute-remote
Content-Type: application/json

{
  "userRequest": "Add dark mode toggle",
  "github": {
    "repoUrl": "https://github.com/owner/repo",
    "branch": "main"
  }
}
```

Returns SSE stream with progress events from Claude Remote.

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

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | Environment (development/production) |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowed origins (comma-separated) |
| `SESSION_SECRET` | - | Session encryption secret |

### Claude Remote Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_ENVIRONMENT_ID` | - | Claude Environment ID for remote sessions |
| `CLAUDE_API_BASE_URL` | `https://api.anthropic.com` | Anthropic API base URL |
| `CLAUDE_DEFAULT_MODEL` | `claude-opus-4-5-20251101` | Default Claude model |

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

### Setup

```bash
# Install dependencies
npm install

# Set environment variables
export DATABASE_URL=postgresql://user:pass@localhost:5432/webedt
export CLAUDE_ENVIRONMENT_ID=your-environment-id

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

### Docker Compose

Uses external PostgreSQL services on the dokploy-network:

```bash
# Create .env file with required variables
cat > .env << EOF
DATABASE_URL=postgresql://user:pass@host:5432/db
SESSION_SECRET=your-secret-key
ALLOWED_ORIGINS=https://your-domain.com
CLAUDE_ENVIRONMENT_ID=your-environment-id
EOF

# Start internal-api-server
docker compose up -d

# View logs
docker compose logs -f internal-api-server
```

### Docker (Manual)

```bash
# Build image
docker build -t internal-api-server .

# Run container
docker run -p 3001:3001 \
  -e DATABASE_URL=postgresql://... \
  -e CLAUDE_ENVIRONMENT_ID=... \
  internal-api-server
```

### Docker Swarm / Dokploy

For production deployment with Docker Swarm:

```bash
# Deploy the stack
docker stack deploy -c swarm.yml internal-api-server

# View service status
docker service ls
docker service logs internal-api-server_internal-api-server -f
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

- This server uses Claude Remote Sessions - no local AI workers are required
- The server requires `DATABASE_URL` to be set - there is no fallback database
- This server is not publicly accessible - public API access goes through the website facade
