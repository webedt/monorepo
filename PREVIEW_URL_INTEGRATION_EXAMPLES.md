# Preview URL Integration Examples

This document shows practical examples of how to integrate the preview URL helper into your application.

## Table of Contents

1. [AI Coding Worker Integration](#ai-coding-worker-integration)
2. [Website Server Integration](#website-server-integration)
3. [SSE Events Integration](#sse-events-integration)
4. [Frontend Integration](#frontend-integration)

---

## AI Coding Worker Integration

### Example 1: Add Preview URL to Session Metadata

```typescript
// In: ai-coding-worker/src/clients/sessionManager.ts

import { getPreviewUrl } from '../utils/previewUrlHelper';
import { SessionMetadata } from '../types';

export class SessionManager {
  async updateSessionMetadata(
    volumeName: string,
    metadata: Partial<SessionMetadata>
  ): Promise<void> {
    // ... existing code ...

    // Add preview URL when branch information is available
    if (metadata.repositoryOwner && metadata.repositoryName && metadata.branch) {
      const workspacePath = `/volumes/${volumeName}/workspace`;
      const previewUrl = await getPreviewUrl(
        workspacePath,
        metadata.repositoryOwner,
        metadata.repositoryName,
        metadata.branch
      );

      // You could add previewUrl to metadata or use it elsewhere
      console.log(`Preview URL: ${previewUrl}`);
    }
  }
}
```

### Example 2: Include Preview URL in SSE Events

```typescript
// In: ai-coding-worker/src/providers/BaseProvider.ts or ClaudeCodeProvider.ts

import { getPreviewUrl } from '../utils/previewUrlHelper';

export class ClaudeCodeProvider extends BaseProvider {
  protected async sendBranchCreatedEvent(branchName: string, baseBranch: string) {
    const { sessionId, repositoryOwner, repositoryName } = this.context;

    // Get preview URL
    let previewUrl: string | undefined;
    if (repositoryOwner && repositoryName) {
      previewUrl = await getPreviewUrl(
        this.workspacePath,
        repositoryOwner,
        repositoryName,
        branchName
      );
    }

    // Send SSE event with preview URL
    this.sendSSEEvent({
      type: 'branch_created',
      branchName,
      baseBranch,
      sessionPath: this.sessionPath,
      previewUrl, // Add this field
      message: `Created branch: ${branchName}`
    });
  }
}
```

### Example 3: Add to Session Connection Event

```typescript
// In: ai-coding-worker/src/orchestrator.ts

import { getPreviewUrl } from './utils/previewUrlHelper';

async function handleExecuteRequest(req: ExecuteRequest, res: Response) {
  // ... existing setup code ...

  // When sending the 'connected' event
  let previewUrl: string | undefined;
  if (metadata.repositoryOwner && metadata.repositoryName && metadata.branch) {
    previewUrl = await getPreviewUrl(
      workspacePath,
      metadata.repositoryOwner,
      metadata.repositoryName,
      metadata.branch
    );
  }

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    type: 'connected',
    sessionId: metadata.sessionId,
    resuming: !!request.websiteSessionId,
    provider: request.codingAssistantProvider,
    previewUrl // Include preview URL in connected event
  })}\n\n`);
}
```

---

## Website Server Integration

### Example 1: Add Preview URL to Session API Response

```typescript
// In: website/apps/server/src/routes/sessions.ts

import { getPreviewUrlFromSession } from '../utils/previewUrlHelper';

// GET /api/sessions/:id - Get session details
router.get('/:id', async (req, res) => {
  try {
    const session = await db.getSession(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get preview URL
    const previewUrl = await getPreviewUrlFromSession(session);

    res.json({
      ...session,
      previewUrl // Add preview URL to response
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Example 2: List Sessions with Preview URLs

```typescript
// In: website/apps/server/src/routes/sessions.ts

import { getPreviewUrlFromSession } from '../utils/previewUrlHelper';

// GET /api/sessions - List all sessions
router.get('/', async (req, res) => {
  try {
    const sessions = await db.getUserSessions(req.user.id);

    // Add preview URLs to all sessions
    const sessionsWithPreview = await Promise.all(
      sessions.map(async (session) => ({
        ...session,
        previewUrl: await getPreviewUrlFromSession(session)
      }))
    );

    res.json({
      sessions: sessionsWithPreview,
      total: sessions.length
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### Example 3: Dedicated Preview URL Endpoint

```typescript
// In: website/apps/server/src/routes/sessions.ts

import { getPreviewUrl } from '../utils/previewUrlHelper';

// GET /api/sessions/:id/preview - Get preview URL for a session
router.get('/:id/preview', async (req, res) => {
  try {
    const session = await db.getSession(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.repositoryOwner || !session.repositoryName || !session.branch) {
      return res.status(400).json({
        error: 'Session does not have repository information'
      });
    }

    // Optionally, you could try to find the workspace path
    // For now, we'll use undefined (will use default URL)
    const previewUrl = await getPreviewUrl(
      undefined, // or provide actual workspace path if available
      session.repositoryOwner,
      session.repositoryName,
      session.branch
    );

    res.json({
      previewUrl,
      repositoryOwner: session.repositoryOwner,
      repositoryName: session.repositoryName,
      branch: session.branch
    });
  } catch (error) {
    console.error('Error getting preview URL:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

## SSE Events Integration

### Example: Update SSE Event Types

```typescript
// In: ai-coding-worker/src/types.ts

export interface BranchCreatedEvent extends SSEEvent {
  type: 'branch_created';
  branchName: string;
  baseBranch: string;
  sessionPath: string;
  message: string;
  previewUrl?: string; // Add this field
}

export interface ConnectedEvent extends SSEEvent {
  type: 'connected';
  sessionId: string;
  resuming: boolean;
  resumedFrom?: string;
  provider: string;
  previewUrl?: string; // Add this field
}

export interface SessionNameEvent extends SSEEvent {
  type: 'session_name';
  sessionName: string;
  branchName?: string;
  previewUrl?: string; // Add this field
}
```

---

## Frontend Integration

### Example 1: Display Preview Button in Session Header

```typescript
// In: website/apps/client/src/components/SessionHeader.tsx

interface SessionHeaderProps {
  session: {
    id: string;
    repositoryOwner: string | null;
    repositoryName: string | null;
    branch: string | null;
    previewUrl?: string | null;
  };
}

export function SessionHeader({ session }: SessionHeaderProps) {
  return (
    <div className="session-header">
      <h1>Session: {session.id}</h1>

      {session.previewUrl && (
        <a
          href={session.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="preview-button"
        >
          🔍 Preview Repository
        </a>
      )}

      {session.repositoryOwner && session.repositoryName && session.branch && (
        <div className="repo-info">
          {session.repositoryOwner}/{session.repositoryName} @ {session.branch}
        </div>
      )}
    </div>
  );
}
```

### Example 2: Handle Preview URL from SSE Events

```typescript
// In: website/apps/client/src/hooks/useEventSource.ts

import { useState, useEffect } from 'react';

export function useEventSource(sessionId: string) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(`/api/execute?sessionId=${sessionId}`);

    eventSource.addEventListener('connected', (event) => {
      const data = JSON.parse(event.data);
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }
    });

    eventSource.addEventListener('branch_created', (event) => {
      const data = JSON.parse(event.data);
      if (data.previewUrl) {
        setPreviewUrl(data.previewUrl);
      }
    });

    return () => eventSource.close();
  }, [sessionId]);

  return { previewUrl };
}
```

### Example 3: Show Preview Link in Session List

```typescript
// In: website/apps/client/src/components/SessionList.tsx

interface Session {
  id: string;
  repositoryOwner: string | null;
  repositoryName: string | null;
  branch: string | null;
  previewUrl?: string | null;
  status: string;
}

export function SessionList({ sessions }: { sessions: Session[] }) {
  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div key={session.id} className="session-item">
          <h3>{session.id}</h3>
          <p>Status: {session.status}</p>

          {session.repositoryOwner && session.repositoryName && (
            <p>
              Repository: {session.repositoryOwner}/{session.repositoryName}
              {session.branch && ` @ ${session.branch}`}
            </p>
          )}

          <div className="session-actions">
            <button onClick={() => openSession(session.id)}>
              Open Session
            </button>

            {session.previewUrl && (
              <a
                href={session.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="preview-link"
              >
                Preview →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Complete Example: Full Integration Flow

Here's how the preview URL flows through the entire system:

```
1. User starts a new session with a GitHub repository
   ↓
2. AI Worker clones repository and creates a branch
   ↓
3. AI Worker calls getPreviewUrl() with workspace path
   ↓
4. Helper checks for .webedt file:
   - If exists with preview_url → use custom URL
   - Otherwise → use default URL
   ↓
5. AI Worker sends SSE event with preview URL:
   {
     type: 'branch_created',
     branchName: 'session-abc-123',
     previewUrl: 'https://github.etdofresh.com/owner/repo/branch/'
   }
   ↓
6. Backend stores preview URL in database (optional)
   ↓
7. Frontend receives SSE event and displays preview button
   ↓
8. User clicks preview button → opens preview URL in new tab
```

---

## Testing Integration

```typescript
// Simple test to verify integration

async function testIntegration() {
  // 1. Create a test workspace
  const workspace = '/tmp/test-integration';
  await fs.mkdir(workspace, { recursive: true });

  // 2. Test default URL
  const defaultUrl = await getPreviewUrl(workspace, 'test', 'repo', 'main');
  console.log('Default:', defaultUrl);
  // Expected: https://github.etdofresh.com/test/repo/main/

  // 3. Add .webedt file
  await fs.writeFile(
    path.join(workspace, '.webedt'),
    JSON.stringify({ preview_url: 'https://custom.com/' })
  );

  // 4. Test custom URL
  const customUrl = await getPreviewUrl(workspace, 'test', 'repo', 'main');
  console.log('Custom:', customUrl);
  // Expected: https://custom.com/

  // 5. Cleanup
  await fs.rm(workspace, { recursive: true });
}
```

---

## Best Practices

1. **Always handle null/undefined gracefully**: The preview URL may not be available if repository info is missing
2. **Use async/await**: The helper functions are async due to file system operations
3. **Cache when appropriate**: If fetching preview URLs for many sessions, consider caching
4. **Provide fallbacks**: Show default UI if preview URL is not available
5. **Log for debugging**: Use the logger to track when custom vs default URLs are used
6. **Test both cases**: Test with and without .webedt files

---

## Configuration File Examples

### Minimal .webedt file
```json
{
  "preview_url": "https://preview.example.com/"
}
```

### Extended .webedt file
```json
{
  "preview_url": "https://preview.example.com/",
  "documentation_url": "https://docs.example.com/",
  "ci_url": "https://ci.example.com/",
  "other_metadata": "custom_value"
}
```

The helper will only use the `preview_url` field, but you can add other fields for your own purposes.
