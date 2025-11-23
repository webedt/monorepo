# AI Coding Worker

Scalable AI coding assistant API with Docker Swarm orchestration, multi-provider support, and GitHub integration.

## Features

- **Multi-Provider Support**: Claude Code, Codex, and more (extensible)
- **GitHub Integration**: Clone/pull repositories with auto-commit and push
- **Session Management**: Resume previous sessions with MinIO persistence
- **Auto-Commit & Push**: Automatic branch creation, commits, and push to remote
- **Ephemeral Workers**: Exit after each job, auto-restart via Docker Swarm
- **Load Balancing**: Multiple workers with automatic failover
- **SSE Streaming**: Real-time output via Server-Sent Events
- **MinIO Storage**: Session persistence with artifact storage

## Architecture

```
Client Request
     ↓
POST /execute (JSON payload)
     ↓
Orchestrator
     ├→ GitHub Pull (if specified)
     ├→ Provider Execution (claude-code, etc.)
     ├→ SSE Streaming
     └→ DB Persistence (if configured)
```

## API Specification

See [API.md](API.md) for complete API documentation.

### Quick Example

```bash
curl -X POST http://localhost:5001/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": "Create a hello world function",
    "codingAssistantProvider": "ClaudeAgentSDK",
    "codingAssistantAuthentication": "{\"claudeAiOauth\":{\"accessToken\":\"sk-ant-oat01-...\",\"refreshToken\":\"sk-ant-ort01-...\"}}"
  }'
```

### With GitHub Integration

```bash
curl -X POST http://localhost:5001/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": "Add error handling to the API",
    "codingAssistantProvider": "ClaudeAgentSDK",
    "codingAssistantAuthentication": "{\"claudeAiOauth\":{\"accessToken\":\"sk-ant-oat01-...\",\"refreshToken\":\"sk-ant-ort01-...\"}}",
    "github": {
      "repoUrl": "https://github.com/user/repo.git",
      "branch": "main"
    }
  }'
```

## Project Structure

```
ai-coding-worker/
├── src/
│   ├── server.ts                    # Main Express server
│   ├── orchestrator.ts              # Execution orchestration logic
│   ├── types.ts                     # TypeScript interfaces
│   ├── clients/
│   │   └── githubClient.ts          # GitHub repository operations
│   ├── providers/
│   │   ├── BaseProvider.ts          # Provider interface
│   │   ├── ClaudeCodeProvider.ts    # Claude implementation
│   │   └── ProviderFactory.ts       # Provider instantiation
│   ├── storage/
│   │   └── sessionStorage.ts        # MinIO session persistence
│   └── utils/
│       ├── gitHelper.ts             # Git operations (commit, push)
│       └── logger.ts                # Logging utility
├── Dockerfile
├── docker-compose.yml               # Local testing
├── swarm.yml                        # Production deployment (MinIO included)
├── deploy-swarm.sh                  # Deployment script
├── API.md                           # API documentation
├── CREDENTIALS.md                   # How to get OAuth credentials
└── package.json
```

## Local Development

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (Docker Swarm for production)
- Claude Code OAuth credentials (see [CREDENTIALS.md](CREDENTIALS.md))

### Setup

1. **Install dependencies**:
```bash
npm install
```

2. **Configure credentials**:
```bash
# Copy example file
cp .env.example .env

# Edit .env with your OAuth credentials
# See CREDENTIALS.md for how to obtain Claude OAuth tokens
```

3. **Run locally**:
```bash
npm run dev
```

### Build and Test

```bash
# Build TypeScript
npm run build

# Build Docker image
docker build -t ai-coding-worker:latest .

# Test with Docker Compose
docker-compose up
```

## Production Deployment (Docker Swarm)

### Prerequisites

- Docker Swarm initialized: `docker swarm init`
- Claude Code credentials in `.env` file (see [CREDENTIALS.md](CREDENTIALS.md))

### Deploy

```bash
chmod +x deploy-swarm.sh
./deploy-swarm.sh
```

This will:
1. Build the Docker image
2. Deploy MinIO for session storage
3. Deploy worker replicas (default: 5)
4. Set up overlay network for service communication

### Configuration

Edit `swarm.yml` to adjust:

- **Replicas**: Change `replicas: 5` to desired count
- **Resources**: Adjust CPU/memory limits (default: 2 CPU, 4GB RAM per worker)
- **MinIO**: Configure storage backend settings
- **Network**: Configure overlay network settings

### Monitor

```bash
# List services
docker service ls

# Check replica status
docker service ps unified-worker-stack_unified-worker

# View logs
docker service logs unified-worker-stack_unified-worker -f

# Scale workers
docker service scale unified-worker-stack_unified-worker=20
```

### Redeploy (Update Code)

When you update the code and need to redeploy:

```bash
# 1. Build TypeScript
npm run build

# 2. Build and push Docker image
docker build -t dockerregistry.etdofresh.com/ai-coding-worker:latest .
docker push dockerregistry.etdofresh.com/ai-coding-worker:latest

# 3. Update the service (rolling update)
docker service update --image dockerregistry.etdofresh.com/ai-coding-worker:latest webedt-app-ai-coding-workers-gy4wew_ai-coding-worker
```

Or use the automated script:

```bash
# For local registry (adjust registry URL as needed)
./redeploy.sh
```

The service will perform a rolling update (2 workers at a time by default) with zero downtime.

### Stop

```bash
docker stack rm unified-worker-stack
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 5000 | Server port |
| `WORKSPACE_DIR` | No | /workspace | Working directory for code |
| `MINIO_ENDPOINT` | No | minio:9000 | MinIO server endpoint |
| `MINIO_ACCESS_KEY` | No | minioadmin | MinIO access key |
| `MINIO_SECRET_KEY` | No | minioadmin | MinIO secret key |
| `MINIO_USE_SSL` | No | false | Use SSL for MinIO |
| `MINIO_BUCKET` | No | sessions | MinIO bucket name |
| `DB_BASE_URL` | No | - | Database API URL (optional) |

**Note**: Authentication credentials are passed per-request via `codingAssistantAuthentication` field in the API payload.

## Endpoints

### POST /execute

Main execution endpoint. Accepts JSON payload with:

**Required**:
- `userRequest`: The prompt/instruction
- `codingAssistantProvider`: Provider name (e.g., "ClaudeAgentSDK", "CodexSDK")
- `codingAssistantAuthentication`: Provider credentials (OAuth JSON or API key)

**Optional**:
- `websiteSessionId`: Resume existing session
- `github`: GitHub repo integration (repoUrl, branch, accessToken)
- `autoCommit`: Enable auto-commit after execution (creates branch, commits, pushes)
- `database`: DB persistence settings
- `providerOptions`: Provider-specific settings (model, permissions, etc.)

**Response**: SSE stream with events:
- `connected`: Initial connection with session ID
- `session_name`: Session metadata (name, branch)
- `message`: Progress updates
- `github_pull_progress`: Repo clone/pull status
- `branch_created`: New branch created
- `commit_progress`: Auto-commit stages (analyzing, committing, pushing)
- `assistant_message`: Provider output (forwarded as-is)
- `completed`: Job finished with duration
- `error`: Error occurred with code

See [API.md](API.md) for complete event schemas and examples.

### GET /health

Returns server health status.

### GET /status

Returns worker status: `idle` or `busy`. Returns `429` if busy.

### GET /sessions

List all sessions stored in MinIO.

### GET /sessions/:sessionId

Get metadata for a specific session.

### GET /sessions/:sessionId/stream

Retrieve stream events (SSE history) for a session.

## Adding New Providers

1. **Create provider class**:
```typescript
// src/providers/CursorProvider.ts
export class CursorProvider extends BaseProvider {
  async execute(userRequest, options, onEvent) {
    // Implementation
  }
}
```

2. **Register in factory**:
```typescript
// src/providers/ProviderFactory.ts
case 'cursor':
  return new CursorProvider(accessToken, workspace);
```

3. **Update supported providers list**.

## Worker Behavior

- **Ephemeral**: Each worker exits after completing a job
- **Auto-restart**: Swarm restarts workers immediately
- **Busy State**: Workers return 429 if already processing
- **Load Balancing**: Swarm distributes requests across idle workers

## Session Storage

Sessions are persisted to MinIO with the following structure:

```
sessions/
└── session-{uuid}/
    ├── .session-metadata.json    # Session info, provider ID, GitHub metadata
    ├── .stream-events.jsonl      # SSE event log (JSONL format)
    ├── .claude/                  # Claude state (if using ClaudeAgentSDK)
    └── {repo-name}/              # Cloned repository (if GitHub used)
```

Sessions can be resumed using the `websiteSessionId` parameter. If the local workspace is missing (e.g., worker restarted), the system will recover from MinIO and re-clone from GitHub if needed.

## Database Integration (Optional)

The `dbClient` is currently a stub for optional external persistence. To integrate:

1. Implement HTTP calls in `src/clients/dbClient.ts`
2. Set `DB_BASE_URL` environment variable
3. Pass `database` object in requests with session ID and access token

## Troubleshooting

### Worker stuck in "busy"

Workers automatically exit after each job. If stuck:
```bash
# Restart service
docker service update --force unified-worker-stack_unified-worker
```

### Session not found on resume

Sessions are stored in MinIO. If MinIO is reset or the bucket is cleared, sessions will be lost. Check MinIO status:
```bash
docker service ps unified-worker-stack_minio
docker service logs unified-worker-stack_minio
```

### GitHub clone fails

- Verify `repoUrl` is accessible
- For private repos, include `github.accessToken`
- Check worker has internet access

## License

MIT
