# Storage Worker

MinIO-based storage service for session management across multiple workers.

## Features

- Session storage using MinIO
- Upload/download session tarballs
- Session metadata management
- Session listing and deletion
- RESTful API under `/api/storage-worker`

## Environment Variables

```bash
PORT=3000
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_BUCKET=sessions
```

## API Endpoints

### Session Management

- `POST /api/storage-worker/sessions/:sessionId/upload` - Upload session tarball
- `GET /api/storage-worker/sessions/:sessionId/download` - Download session tarball
- `GET /api/storage-worker/sessions` - List all sessions
- `DELETE /api/storage-worker/sessions/:sessionId` - Delete session
- `HEAD /api/storage-worker/sessions/:sessionId` - Check if session exists

### Health

- `GET /health` - Health check

## Client Library

The client library is exported for use in other workers:

```typescript
import { StorageClient } from 'storage-worker/client';

const client = new StorageClient('http://storage-worker:3000');

// Upload session
await client.uploadSession(sessionId, tarballPath);

// Download session
await client.downloadSession(sessionId, destinationPath);

// List sessions
const sessions = await client.listSessions();

// Delete session
await client.deleteSession(sessionId);

// Check if session exists
const exists = await client.sessionExists(sessionId);
```

## Docker Deployment

### Using Docker Registry

The image is automatically built and pushed to `dockerregistry.etdofresh.com/storage-worker:latest` via GitHub Actions.

```bash
docker pull dockerregistry.etdofresh.com/storage-worker:latest
docker run -p 3000:3000 \
  -e MINIO_ENDPOINT=minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  dockerregistry.etdofresh.com/storage-worker:latest
```

### Docker Swarm

```bash
./deploy-swarm.sh
```

This will:
1. Pull the latest image from the registry
2. Create the workers-network overlay network
3. Deploy storage-worker and MinIO services
