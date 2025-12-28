# WebEDT Architecture

This document describes the architectural design of WebEDT, focusing on horizontal scalability patterns.

## Overview

WebEDT is designed for horizontal scalability from the ground up. The architecture follows stateless service patterns with all persistent state stored in PostgreSQL, enabling seamless scaling across multiple instances.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER                                      │
│                    (Dokploy / Kubernetes Ingress)                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
     ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
     │  Instance 1 │         │  Instance 2 │         │  Instance N │
     │  Backend    │         │  Backend    │         │  Backend    │
     │  Port 3001  │         │  Port 3001  │         │  Port 3001  │
     └─────────────┘         └─────────────┘         └─────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                                    ▼
                      ┌─────────────────────────┐
                      │       PostgreSQL        │
                      │   (Connection Pooling)  │
                      │                         │
                      │  - users                │
                      │  - sessions (auth)      │
                      │  - chatSessions         │
                      │  - events               │
                      └─────────────────────────┘
```

## Scale Expectations

| Metric | Current | Short-term Target |
|--------|---------|-------------------|
| Concurrent Users | Up to 10 | 50+ |
| Storage per User | Few GB | Few GB |
| Architecture | Single instance | Horizontally scalable |

## Horizontal Scalability Design

### 1. Stateless Backend Services

The backend is designed as a **stateless service**, meaning any request can be handled by any instance:

- **No in-memory session storage**: Authentication sessions are stored in PostgreSQL via Lucia auth
- **No sticky sessions required**: Each request is validated against the database
- **Shared-nothing architecture**: Instances don't communicate with each other directly

```typescript
// Session storage uses PostgreSQL adapter
const adapter = new NodePostgresAdapter(pool, {
  user: 'users',
  session: 'sessions',
});
```

### 2. Database-Backed Session Storage

All user sessions are stored in PostgreSQL, enabling:

- Session validation from any backend instance
- Graceful instance restarts without session loss
- Centralized session management and invalidation

**Tables:**
- `users` - User accounts and credentials
- `sessions` - Authentication sessions (Lucia)
- `chatSessions` - AI chat/execution sessions
- `events` - Session event history (event sourcing)

### 3. Connection Pooling

The database connection layer is designed for multi-instance deployments:

```typescript
// Connection pool configuration
{
  maxConnections: 20,        // Per instance
  minConnections: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statementTimeoutMs: 30000,
}
```

**Features:**
- Per-instance connection pools
- Automatic health checks with reconnection
- Exponential backoff retry logic
- Real-time connection statistics

### 4. Health Check Endpoints

Load balancers and container orchestrators can use these endpoints:

| Endpoint | Purpose | Response |
|----------|---------|----------|
| `GET /health` | Fast health check | Service status, container ID |
| `GET /health/status` | Detailed health | DB health, metrics, scale info |
| `GET /ready` | Kubernetes readiness | Database connectivity |
| `GET /live` | Kubernetes liveness | Always 200 if running |
| `GET /metrics` | Auto-scaling metrics | Connection stats, uptime |

**Example `/health/status` response:**
```json
{
  "status": "healthy",
  "container": "instance-abc123",
  "scale": {
    "currentCapacity": "up to 10 concurrent users",
    "shortTermTarget": "50+ users",
    "architecture": "horizontally scalable"
  },
  "database": {
    "healthy": true,
    "connections": {
      "total": 5,
      "idle": 3,
      "waiting": 0
    }
  }
}
```

### 5. Orphan Session Cleanup

Handles edge cases in distributed deployments:

- Sessions stuck in 'running' state after instance crashes
- Worker callbacks lost due to network issues
- Server restarts during job execution

**Configuration:**
```bash
ORPHAN_SESSION_TIMEOUT_MINUTES=30   # Mark stuck sessions complete after 30 min
ORPHAN_CLEANUP_INTERVAL_MINUTES=5   # Run cleanup every 5 minutes
```

### 6. Container Identification

Each instance has a unique identifier for tracing and debugging:

```typescript
const CONTAINER_ID = process.env.HOSTNAME || 'local';
```

This enables:
- Request tracing across instances
- Per-instance metrics
- Debug logging with instance context

## Deployment Configuration

### Docker Build

Single multi-stage image containing frontend and backend:

```bash
docker build \
  --build-arg BUILD_COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --build-arg BUILD_VERSION=0.0.$(git rev-list --count HEAD) \
  -t webedt .
```

### Scaling Replicas

To scale horizontally, increase the replica count in your orchestrator:

**Dokploy:**
```json
{
  "replicas": 3
}
```

**Kubernetes:**
```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
```

**Docker Compose:**
```yaml
services:
  backend:
    deploy:
      replicas: 3
```

### Environment Variables

Required for all instances:

```bash
# Shared across all instances
DATABASE_URL=postgresql://user:password@db:5432/webedt
SESSION_SECRET=<shared-secret-for-all-instances>
NODE_ENV=production

# Instance-specific (auto-detected in containers)
CONTAINER_ID=${HOSTNAME}
```

## Scaling Considerations

### Current Single-Instance Patterns

Some patterns work in single-instance mode but need adaptation for multi-instance:

| Pattern | Current State | Multi-Instance Solution |
|---------|---------------|-------------------------|
| Active stream tracking | In-memory Map | Redis or database-backed |
| Session interrupts | Local AbortController | Distributed pub/sub |
| Background sync | Per-instance | Distributed lock or leader election |

### Recommended Additions for 50+ Users

1. **Redis** - For distributed caching and session interrupt coordination
2. **Load balancer** - Nginx, HAProxy, or cloud LB with health checks
3. **Metrics aggregation** - Prometheus + Grafana for multi-instance monitoring
4. **Distributed tracing** - OpenTelemetry for request tracking

## API Design for Scalability

All API endpoints are designed to be stateless:

- **Authentication**: Validated on every request via database lookup
- **SSE Streaming**: Client reconnects handled gracefully with event replay
- **File operations**: Workspace files stored externally (not in-memory)
- **Background jobs**: State persisted to database, not in worker memory

## SSE Event Replay

For long-running AI operations, clients can resume from any instance:

```
POST /api/execute-remote  →  Instance A (starts job, streams events)
     ↓
(connection lost)
     ↓
GET /api/resume/:id       →  Instance B (replays events from database)
```

Events are stored in the `events` table, enabling replay from any instance.

## Summary

WebEDT's architecture is **designed for horizontal scalability**:

- ✅ Stateless backend services
- ✅ PostgreSQL-backed session storage
- ✅ Connection pooling with health checks
- ✅ Kubernetes-compatible health probes
- ✅ Metrics endpoint for auto-scaling
- ✅ Orphan session cleanup for resilience
- ✅ Event sourcing for SSE replay
- ✅ Container-ready Docker build

The platform can scale from single-instance development to multi-instance production by simply increasing replica count and ensuring shared database access.
