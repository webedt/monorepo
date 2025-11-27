# Preview URL Helper - Usage Guide

## Overview

The preview URL helper provides a way to get a preview URL for a repository and branch. It follows this priority:

1. **Custom URL from `.webedt` file**: If a `.webedt` file exists in the repository root with a `preview_url` field, use that URL
2. **Default URL**: Otherwise, use `https://github.etdofresh.com/{owner}/{repo}/{branch}/`

Since most repositories will NOT have a `.webedt` file, the default option will be used most of the time.

## Installation

The helper utilities are available in two locations:

- **AI Coding Worker**: `/ai-coding-worker/src/utils/previewUrlHelper.ts`
- **Website Server**: `/website/apps/server/src/utils/previewUrlHelper.ts`

## Usage

### Basic Usage

```typescript
import { getPreviewUrl } from './utils/previewUrlHelper';

// Get preview URL (will use default for most repos)
const previewUrl = await getPreviewUrl(
  '/path/to/workspace',
  'facebook',
  'react',
  'main'
);
// Returns: https://github.etdofresh.com/facebook/react/main/
```

### With `.webedt` File

If a repository has a `.webedt` file in its root:

```json
{
  "preview_url": "https://custom-preview.example.com/my-app/"
}
```

Then the custom URL will be used:

```typescript
const previewUrl = await getPreviewUrl(
  '/path/to/workspace',
  'myorg',
  'myrepo',
  'feature-branch'
);
// Returns: https://custom-preview.example.com/my-app/
```

### Other Helper Functions

```typescript
import {
  hasWebedtFile,
  readWebedtConfig,
  getPreviewUrlFromSession // Website server only
} from './utils/previewUrlHelper';

// Check if .webedt file exists
const hasConfig = await hasWebedtFile('/path/to/workspace');
// Returns: boolean

// Read the entire .webedt configuration
const config = await readWebedtConfig('/path/to/workspace');
// Returns: { preview_url?: string, [key: string]: any } | null

// Get preview URL from a ChatSession object (website server only)
const url = await getPreviewUrlFromSession(session, '/optional/workspace/path');
// Returns: string | null
```

## `.webedt` File Format

The `.webedt` file should be a JSON file in the repository root with the following structure:

```json
{
  "preview_url": "https://your-custom-preview-url.com/",
  "other_config_field": "optional_value"
}
```

**Required fields:**
- None (the file itself is optional)

**Optional fields:**
- `preview_url`: Custom preview URL for the repository

## Examples

### Example 1: Default Preview URL (Most Common)

```typescript
// Repository: https://github.com/vercel/next.js
// Branch: canary
// No .webedt file

const url = await getPreviewUrl(
  '/workspace/next.js',
  'vercel',
  'next.js',
  'canary'
);

console.log(url);
// Output: https://github.etdofresh.com/vercel/next.js/canary/
```

### Example 2: Custom Preview URL

```typescript
// Repository with .webedt file containing:
// { "preview_url": "https://staging.myapp.com/" }

const url = await getPreviewUrl(
  '/workspace/myapp',
  'myorg',
  'myapp',
  'develop'
);

console.log(url);
// Output: https://staging.myapp.com/
```

### Example 3: Using with Session Metadata (AI Worker)

```typescript
import { getPreviewUrl } from './utils/previewUrlHelper';
import { SessionMetadata } from './types';

async function getSessionPreviewUrl(
  metadata: SessionMetadata,
  workspacePath: string
): Promise<string | null> {
  if (!metadata.repositoryOwner || !metadata.repositoryName || !metadata.branch) {
    return null;
  }

  return await getPreviewUrl(
    workspacePath,
    metadata.repositoryOwner,
    metadata.repositoryName,
    metadata.branch
  );
}
```

### Example 4: Using with ChatSession (Website Server)

```typescript
import { getPreviewUrlFromSession } from './utils/previewUrlHelper';
import { ChatSession } from '@shared/types';

async function handleSessionPreview(session: ChatSession) {
  const previewUrl = await getPreviewUrlFromSession(session);

  if (previewUrl) {
    console.log(`Preview: ${previewUrl}`);
  } else {
    console.log('No repository information available');
  }
}
```

## Integration Points

### Potential Use Cases

1. **Session Details API**: Return preview URL when fetching session details
2. **SSE Events**: Include preview URL in session metadata events
3. **UI Display**: Show preview button/link in the web interface
4. **Webhooks**: Include preview URL in webhook payloads
5. **Notifications**: Add preview link to commit notifications

### Example API Response

```typescript
// In website/apps/server/src/routes/sessions.ts

app.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  const previewUrl = await getPreviewUrlFromSession(session);

  res.json({
    ...session,
    previewUrl
  });
});
```

## Testing

Create a test repository with the following structure:

```
/tmp/test-repo/
├── .webedt         (optional)
└── ... other files
```

### Test Case 1: No .webedt file
```bash
mkdir -p /tmp/test-repo
# Don't create .webedt file
```

```typescript
const url = await getPreviewUrl('/tmp/test-repo', 'test', 'repo', 'main');
// Expected: https://github.etdofresh.com/test/repo/main/
```

### Test Case 2: With .webedt file
```bash
mkdir -p /tmp/test-repo
echo '{"preview_url":"https://custom.example.com/"}' > /tmp/test-repo/.webedt
```

```typescript
const url = await getPreviewUrl('/tmp/test-repo', 'test', 'repo', 'main');
// Expected: https://custom.example.com/
```

### Test Case 3: Invalid .webedt file
```bash
mkdir -p /tmp/test-repo
echo 'invalid json' > /tmp/test-repo/.webedt
```

```typescript
const url = await getPreviewUrl('/tmp/test-repo', 'test', 'repo', 'main');
// Expected: https://github.etdofresh.com/test/repo/main/ (falls back to default)
```

## Error Handling

The helper functions are designed to be resilient:

- If `.webedt` file doesn't exist → use default URL
- If `.webedt` file is invalid JSON → log warning, use default URL
- If `.webedt` exists but no `preview_url` field → use default URL
- If any error occurs → always return default URL

This ensures the preview URL is always available, even in edge cases.

## Notes

- The default domain `github.etdofresh.com` is used for all repositories without custom configuration
- The helper functions use async/await since they may need to read files
- Logging is done via the logger utility in ai-coding-worker and console.log in website server
- The `.webedt` file should be committed to the repository if you want custom preview URLs
