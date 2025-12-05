# Storage Worker

MinIO-based storage service for session management with file-level access.

## Overview

The Storage Worker provides persistent storage for coding sessions using MinIO (S3-compatible object storage). It serves as the **single source of truth** for all file operations within sessions.

## Architecture

Unlike other workers, the Storage Worker is **NOT ephemeral**:
- Runs continuously to handle storage requests
- Maintains persistent connections to MinIO
- Sessions stored as tarball archives (`session.tar.gz`)
- Supports both session-level and file-level operations

## API Endpoints

### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check with build info |

### Session Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/storage-worker/sessions` | List all sessions |
| `GET` | `/api/storage-worker/sessions/:sessionPath` | Get session metadata |
| `HEAD` | `/api/storage-worker/sessions/:sessionPath` | Check if session exists |
| `DELETE` | `/api/storage-worker/sessions/:sessionPath` | Delete a session |
| `POST` | `/api/storage-worker/sessions/bulk-delete` | Delete multiple sessions |
| `POST` | `/api/storage-worker/sessions/:sessionPath/upload` | Upload session tarball |
| `GET` | `/api/storage-worker/sessions/:sessionPath/download` | Download session tarball |

### File Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/storage-worker/sessions/:sessionPath/files` | List files in session |
| `GET` | `/api/storage-worker/sessions/:sessionPath/files/*` | Read file content |
| `PUT` | `/api/storage-worker/sessions/:sessionPath/files/*` | Write/update file |
| `DELETE` | `/api/storage-worker/sessions/:sessionPath/files/*` | Delete file |
| `HEAD` | `/api/storage-worker/sessions/:sessionPath/files/*` | Check if file exists |

### Session Path Format

Session paths use double underscore separator: `{owner}__{repo}__{branch}`

**Important:** Session paths must NOT contain `/` characters. The storage worker validates this and returns 400 errors for invalid paths.

Example: `webedt__monorepo__feature-branch`

## Request/Response Examples

### List Files

```bash
curl http://localhost:3000/api/storage-worker/sessions/webedt__monorepo__main/files
```

Response:
```json
{
  "sessionPath": "webedt__monorepo__main",
  "count": 5,
  "files": [
    {"path": "workspace/src/index.ts", "size": 1234},
    {"path": "workspace/package.json", "size": 567}
  ],
  "containerId": "abc123"
}
```

### Read File

```bash
curl http://localhost:3000/api/storage-worker/sessions/webedt__monorepo__main/files/workspace/src/index.ts
```

Returns raw file content with appropriate `Content-Type` header.

### Write File

```bash
curl -X PUT http://localhost:3000/api/storage-worker/sessions/webedt__monorepo__main/files/workspace/src/index.ts \
  -H "Content-Type: text/plain" \
  -d 'console.log("Hello World");'
```

Response:
```json
{
  "success": true,
  "sessionPath": "webedt__monorepo__main",
  "filePath": "workspace/src/index.ts",
  "size": 28,
  "containerId": "abc123"
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MINIO_ENDPOINT` | - | MinIO server hostname |
| `MINIO_PORT` | `9000` | MinIO server port |
| `MINIO_USE_SSL` | `false` | Use SSL for MinIO connection |
| `MINIO_ROOT_USER` | - | MinIO access key |
| `MINIO_ROOT_PASSWORD` | - | MinIO secret key |
| `MINIO_BUCKET` | `sessions` | Bucket name for sessions |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start

# Run tests
npm run test:api
```

## Docker

```bash
# Build image
docker build -t storage-worker:latest .

# Run container
docker run -p 3000:3000 \
  -e MINIO_ENDPOINT=minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  storage-worker:latest
```

## Directory Structure

```
storage-worker/
├── package.json
├── tsconfig.json
├── Dockerfile
├── swarm.yml
├── CLAUDE.md
├── .env.example
├── src/
│   ├── server.ts           # Express server with REST endpoints
│   ├── storageService.ts   # MinIO client wrapper
│   ├── client.ts           # Client for other services to use
│   └── index.ts            # Main entry point
└── tests/
    ├── api.test.ts         # API integration tests
    └── .env.example        # Test environment example
```

## Storage Architecture

### Session Storage Format

Sessions are stored as gzipped tarballs in MinIO:

```
minio/
└── sessions/                    # Bucket
    └── {sessionPath}/
        └── session.tar.gz       # Session tarball
```

### Tarball Contents

```
session.tar.gz/
├── workspace/                   # User workspace files
│   ├── src/
│   ├── package.json
│   └── ...
├── .session-metadata.json       # Session metadata
└── .stream-events.jsonl         # SSE event log (optional)
```

### File-Level Operations

The storage worker extracts/updates individual files within the tarball without downloading the entire archive for read operations, and re-packs the tarball for write operations.

## Integration with Other Services

### AI Coding Worker

Calls Storage Worker for:
- Downloading session workspace before execution
- Uploading session workspace after execution
- Auto-commit file changes

### GitHub Worker

Calls Storage Worker for:
- Downloading session for branch creation
- Downloading session for commit operations
- Uploading session after git operations

### Collaborative Session Worker

Calls Storage Worker for:
- Session persistence (upload/download)
- File synchronization

### Website Frontend

Uses Storage Worker API (via reverse proxy) for:
- Displaying file contents in editor
- Saving file changes
- Listing session files

## Response Headers

All responses include:
- `X-Container-ID` - Container identifier for debugging load balancer issues

## Error Responses

All error responses follow this format:

```json
{
  "error": "error_code",
  "message": "Human-readable description",
  "containerId": "abc123"
}
```

Common error codes:
- `invalid_session_path` - Session path contains `/` or is empty
- `session_not_found` - Session doesn't exist in storage
- `file_not_found` - File doesn't exist in session
- `upload_failed` - Failed to upload session/file
- `download_failed` - Failed to download session/file

## On-Demand Session Creation

Sessions are created automatically when you write a file to a non-existent session. No explicit "create session" call is needed.

## Security Considerations

1. **No authentication** - Authentication should be handled at gateway/proxy level
2. **Session isolation** - Each session is stored in its own path
3. **Path validation** - Session paths are validated to prevent directory traversal
4. **Network isolation** - Uses Docker overlay network in Swarm deployment
