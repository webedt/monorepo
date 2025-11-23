# Unified Worker API Documentation

This document describes the API endpoints for the Unified Worker backend service.

## Base URL

```
http://localhost:5000  # Local development (default port)
https://your-domain.com  # Production
```

## Authentication

Authentication is handled **per-request** via the `codingAssistantAuthentication` field in the request body. The backend does not require API keys for the worker endpoints themselves.

---

## Endpoints

### 1. Health Check

**GET** `/health`

Check if the service is running.

**Response:**
```json
{
  "status": "ok",
  "tmpDir": "/tmp",
  "workerStatus": "idle",
  "containerId": "abc123def456",
  "timestamp": "2025-11-15T22:33:40.244Z"
}
```

---

### 2. Worker Status

**GET** `/status`

Check if a worker is available to accept jobs.

**Response:**
```json
{
  "status": "idle",
  "containerId": "abc123def456",
  "timestamp": "2025-11-15T22:33:40.244Z"
}
```

or

```json
{
  "status": "busy",
  "containerId": "abc123def456",
  "timestamp": "2025-11-15T22:33:40.244Z"
}
```

**Status Codes:**
- `200` - Worker is idle and ready
- `429` - Worker is busy (try another worker or retry later)

---

### 3. Execute Coding Request

**POST** `/execute`

Execute a coding assistant request with real-time streaming output.

**Headers:**
```
Content-Type: application/json
```

**Request Body:**

```typescript
interface ExecuteRequest {
  // Required: The user's coding request (string or structured content with images)
  userRequest: string | Array<{
    type: 'text';
    text: string;
  } | {
    type: 'image';
    source: {
      type: 'base64';
      media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      data: string; // base64-encoded image data
    };
  }>;

  // Required: Provider to use
  codingAssistantProvider: "claude-code" | "codex" | "cursor";

  // Required: Authentication credentials (provider-specific format)
  codingAssistantAuthentication: string | object;

  // Optional: Resume from existing session
  resumeSessionId?: string;

  // Optional: GitHub integration
  github?: {
    repoUrl: string;           // e.g., "https://github.com/user/repo.git"
    branch?: string;           // Default: "main"
    directory?: string;        // Optional subdirectory to work in
    accessToken?: string;      // GitHub personal access token
    refreshToken?: string;     // GitHub refresh token (if applicable)
  };

  // Optional: Provider-specific options
  providerOptions?: {
    model?: string;           // e.g., "claude-sonnet-4-5-20250929"
    skipPermissions?: boolean;
    permissionMode?: "bypassPermissions" | "default";
  };

  // Optional: Database integration (for session tracking)
  database?: {
    sessionId: string;
    accessToken: string;
  };

  // Optional: Workspace configuration
  workspace?: {
    path?: string;            // Custom workspace path
    environment?: string;     // Environment name
  };
}
```

**Example Request (New Session):**

```json
{
  "userRequest": "Create a hello.txt file with a greeting",
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": {
    "claudeAiOauth": {
      "accessToken": "sk-ant-oat01-...",
      "refreshToken": "sk-ant-ort01-...",
      "expiresAt": 1763273556157,
      "scopes": ["user:inference", "user:profile", "user:sessions:claude_code"],
      "subscriptionType": "max",
      "rateLimitTier": "default_claude_max_5x"
    }
  }
}
```

**Example Request (GitHub + Auto-commit):**

```json
{
  "userRequest": "Add a new feature to handle user authentication",
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": {
    "claudeAiOauth": { "..." }
  },
  "github": {
    "repoUrl": "https://github.com/myorg/myrepo.git",
    "branch": "main",
    "accessToken": "gho_..."
  }
}
```

**Note:** Auto-commit is handled automatically based on GitHub metadata requirements. See the auto-commit documentation for details.

**Example Request (Resume Session):**

```json
{
  "userRequest": "Now add unit tests for the authentication feature",
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": {
    "claudeAiOauth": { "..." }
  },
  "resumeSessionId": "9de73868-722a-4f1e-9c17-080ae9683442"
}
```

**Response:**

Server-Sent Events (SSE) stream with `Content-Type: text/event-stream`.

Each event is in the format:
```
data: <JSON object>\n\n
```

**Event Types:**

```typescript
// Connection established
{
  type: "connected";
  sessionId: string;
  resuming: boolean;
  resumedFrom?: string;
  provider: string;
  timestamp: string;
}

// Progress messages
{
  type: "message";
  message: string;
  timestamp: string;
}

// GitHub clone/pull progress
{
  type: "github_pull_progress";
  data: {
    type: "message" | "completed";
    message?: string;
    targetPath?: string;
  };
  timestamp: string;
}

// Commit progress (when GitHub metadata is present)
{
  type: "commit_progress";
  stage: "analyzing" | "creating_branch" | "generating_message" | "committing" | "committed" | "pushing" | "pushed" | "push_failed" | "completed";
  message: string;
  branch?: string;
  commitMessage?: string;
  commitHash?: string;
  error?: string;
  timestamp: string;
}

// Provider output (forwarded as-is from Claude Code/Codex)
{
  type: "assistant_message";
  // ... provider-specific fields (varies by provider)
}

// Job completed
{
  type: "completed";
  sessionId: string;
  duration_ms: number;
  timestamp: string;
}

// Error occurred
{
  type: "error";
  error: string;
  code?: "VALIDATION_ERROR" | "GITHUB_ERROR" | "PROVIDER_ERROR" | "EXECUTION_ERROR" | "UNKNOWN_ERROR";
  timestamp: string;
}
```

**Status Codes:**
- `200` - Success, streaming started
- `400` - Invalid request
- `429` - Worker is busy
- `500` - Internal server error

**JavaScript Example (Fetch API):**

```javascript
const response = await fetch('http://localhost:5000/execute', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    userRequest: 'Create a hello.txt file',
    codingAssistantProvider: 'claude-code',
    codingAssistantAuthentication: {
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-...',
        refreshToken: 'sk-ant-ort01-...',
        expiresAt: 1763273556157,
        scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_5x'
      }
    }
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      const event = JSON.parse(data);

      // Handle event based on type
      if (event.type === 'connected') {
        console.log('Session ID:', event.sessionId);
      } else if (event.type === 'message') {
        console.log('Message:', event.message);
      } else if (event.type === 'completed') {
        console.log('Completed in', event.duration_ms, 'ms');
      } else if (event.type === 'error') {
        console.error('Error:', event.error);
      }
    }
  }
}
```

---

### 4. List Sessions

**GET** `/sessions`

Get a list of all sessions stored in MinIO.

**Response:**
```json
{
  "count": 1,
  "sessions": [
    {
      "sessionId": "9de73868-722a-4f1e-9c17-080ae9683442",
      "storage": "minio"
    }
  ],
  "containerId": "abc123def456"
}
```

---

### 5. Delete Session

**DELETE** `/sessions/:sessionId`

Delete a session and all its data from MinIO storage.

**Response:**
```json
{
  "sessionId": "9de73868-722a-4f1e-9c17-080ae9683442",
  "deleted": true,
  "containerId": "abc123def456"
}
```

**Status Codes:**
- `200` - Successfully deleted
- `500` - Internal error (failed to delete session)

---

## Error Handling

All errors follow this format:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

**Error Codes:**
- `VALIDATION_ERROR` - Invalid request parameters
- `GITHUB_ERROR` - GitHub operation failed
- `PROVIDER_ERROR` - Coding assistant provider error
- `EXECUTION_ERROR` - Execution failed
- `UNKNOWN_ERROR` - Unexpected error

---

## Authentication Formats

### Claude Code

For the `claude-code` provider, use Claude OAuth credentials:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1763273556157,
    "scopes": ["user:inference", "user:profile", "user:sessions:claude_code"],
    "subscriptionType": "max",
    "rateLimitTier": "default_claude_max_5x"
  }
}
```

To obtain Claude OAuth credentials:
1. Visit https://claude.ai
2. Open browser DevTools → Network tab
3. Look for API requests with Authorization headers
4. Extract OAuth credentials

See [CREDENTIALS.md](CREDENTIALS.md) for detailed instructions.

### Codex / Cursor

For `codex` or `cursor` providers:

```json
{
  "apiKey": "your-api-key"
}
```

Note: Codex and Cursor providers are currently stubs and not fully implemented.

---

## Rate Limiting

The backend uses Docker Swarm with multiple worker replicas. Each worker can handle one job at a time. If all workers are busy, requests will receive a `429` status.

**Recommended Client Behavior:**
1. Check `/status` before sending requests
2. Implement retry logic with exponential backoff
3. Handle `429` responses by retrying after a delay

---

## Session Persistence

Sessions are stored in MinIO object storage with the following structure:

```
sessions/
└── session-{uuid}/
    ├── .session-metadata.json    # Session metadata
    ├── .stream-events.jsonl      # SSE event log (JSONL format)
    ├── .claude/                  # Claude state (if using claude-code provider)
    └── {repo-name}/              # Cloned repository (if GitHub integration used)
```

Sessions persist across worker restarts and can be resumed using `resumeSessionId`.

---

## Image Support

The worker supports multimodal requests with images for the `claude-code` provider. You can send images alongside text in your requests.

**Supported Image Formats:**
- `image/jpeg` - JPEG images
- `image/png` - PNG images
- `image/gif` - GIF images
- `image/webp` - WebP images

All images must be base64-encoded.

**Example with Image:**

```json
{
  "userRequest": [
    {
      "type": "text",
      "text": "What's in this screenshot? Please analyze and fix any issues."
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgoAAAANSUhEUg..."
      }
    }
  ],
  "codingAssistantProvider": "claude-code",
  "codingAssistantAuthentication": {
    "claudeAiOauth": { "..." }
  }
}
```

**Use Cases:**
- Screenshot analysis and debugging
- Design implementation from mockups
- Error debugging with visual context
- Documentation with diagrams or charts

---

## Examples

See the `test-*.json` files in the repository for more examples:
- `test-request.json` - Basic execution
- `test-github.json` - GitHub integration
- `test-resume.json` - Resume existing session
- `test-image-request.json.example` - Image support example

---

## CORS

CORS is enabled for all origins in development. Configure CORS settings via environment variables for production deployments.

---

## Production Deployment

For production, ensure:
1. Use HTTPS for all endpoints
2. Configure proper CORS origins
3. Set up authentication/authorization if needed
4. Use secure MinIO credentials
5. Monitor worker health and scale replicas as needed

See [CLAUDE.md](CLAUDE.md) for deployment instructions.
