# Preview URL Feature

## Overview

The Preview URL feature allows you to generate a URL to preview the current state of a repository and branch. This is useful for:

- Viewing deployed previews of web applications
- Accessing staging environments
- Quick navigation to repository-specific tools
- Custom preview integrations

## How It Works

The system uses a **two-tier approach** to determine the preview URL:

### 1. Custom Preview URL (via `.webedt` file)

If your repository has a `.webedt` file in the root directory with a `preview_url` field, that URL will be used.

**Example `.webedt` file:**
```json
{
  "preview_url": "https://my-app-staging.example.com/"
}
```

### 2. Default Preview URL

If no `.webedt` file exists (which is the **most common case**), the system generates a default URL:

```
https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

**Example:**
- Repository: `facebook/react`
- Branch: `main`
- Preview URL: `https://github.etdofresh.com/facebook/react/main/`

## Quick Start

### For Repository Owners

If you want to provide a custom preview URL for your repository:

1. Create a `.webedt` file in your repository root
2. Add the following content (replace with your URL):
   ```json
   {
     "preview_url": "https://your-custom-preview-url.com/"
   }
   ```
3. Commit and push the file to your repository

That's it! The system will now use your custom URL.

### For Developers

To use the preview URL helper in your code:

```typescript
import { getPreviewUrl } from './utils/previewUrlHelper';

const previewUrl = await getPreviewUrl(
  workspacePath,
  'owner',
  'repo',
  'branch'
);

console.log(previewUrl);
// Output: https://github.etdofresh.com/owner/repo/branch/
// OR: your custom URL if .webedt exists
```

## Files Added

This feature adds the following files to the codebase:

### Core Utilities
- `ai-coding-worker/src/utils/previewUrlHelper.ts` - Helper for AI worker
- `website/apps/server/src/utils/previewUrlHelper.ts` - Helper for website server

### Types
- Updated `website/packages/shared/src/types.ts` - Added `WebedtConfig` interface

### Documentation
- `PREVIEW_URL_README.md` - This file
- `PREVIEW_URL_DEMO.md` - Usage guide and examples
- `PREVIEW_URL_INTEGRATION_EXAMPLES.md` - Integration examples
- `.webedt.example` - Example configuration file

### Tests
- `ai-coding-worker/src/utils/previewUrlHelper.test.ts` - Test file (requires TypeScript setup)

## API Reference

### `getPreviewUrl(workspacePath, owner, repo, branch)`

Get the preview URL for a repository and branch.

**Parameters:**
- `workspacePath` (string): Path to the git workspace
- `owner` (string): Repository owner
- `repo` (string): Repository name
- `branch` (string): Branch name

**Returns:** `Promise<string>` - The preview URL

**Example:**
```typescript
const url = await getPreviewUrl('/workspace', 'vercel', 'next.js', 'canary');
// Returns: "https://github.etdofresh.com/vercel/next.js/canary/"
```

### `hasWebedtFile(workspacePath)`

Check if a `.webedt` file exists in the repository.

**Parameters:**
- `workspacePath` (string): Path to the git workspace

**Returns:** `Promise<boolean>` - True if file exists

**Example:**
```typescript
const exists = await hasWebedtFile('/workspace');
// Returns: true or false
```

### `readWebedtConfig(workspacePath)`

Read and parse the `.webedt` configuration file.

**Parameters:**
- `workspacePath` (string): Path to the git workspace

**Returns:** `Promise<WebedtConfig | null>` - Parsed config or null

**Example:**
```typescript
const config = await readWebedtConfig('/workspace');
// Returns: { preview_url: "...", ... } or null
```

### `getPreviewUrlFromSession(session, workspacePath?)` (Website server only)

Convenience method to get preview URL from a session object.

**Parameters:**
- `session` (object): Session with repository info
- `workspacePath` (string, optional): Workspace path

**Returns:** `Promise<string | null>` - Preview URL or null if no repo info

**Example:**
```typescript
const url = await getPreviewUrlFromSession(session);
// Returns: "https://github.etdofresh.com/..." or null
```

## `.webedt` File Format

The `.webedt` file should be a JSON file with the following structure:

```json
{
  "preview_url": "https://your-preview-url.com/",
  "other_field": "optional"
}
```

**Fields:**
- `preview_url` (string, optional): Custom preview URL
- Any other fields are allowed but ignored by the preview helper

**Location:** Repository root directory (same level as `.git/`)

**File name:** `.webedt` (starts with a dot)

## Examples

### Example 1: Most Common Case (No `.webedt` file)

```typescript
// Repository: microsoft/vscode
// Branch: main
// No .webedt file in repository

const url = await getPreviewUrl(
  '/workspace/vscode',
  'microsoft',
  'vscode',
  'main'
);

console.log(url);
// Output: "https://github.etdofresh.com/microsoft/vscode/main/"
```

### Example 2: With Custom Preview URL

```typescript
// Repository has .webedt file:
// { "preview_url": "https://staging.myapp.com/" }

const url = await getPreviewUrl(
  '/workspace/myapp',
  'mycompany',
  'myapp',
  'develop'
);

console.log(url);
// Output: "https://staging.myapp.com/"
```

### Example 3: Integration with Session

```typescript
// In your route handler
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

A test script is available to verify the functionality:

```bash
# Run the demo test
node /tmp/test-preview-url.js
```

Expected output:
```
Test 1: Default Preview URL (most common case)
  ℹ No .webedt file found
  ✓ Using default preview URL
Result: https://github.etdofresh.com/testowner/testrepo/main/
✓ Match: true

Test 2: Custom Preview URL (with .webedt file)
  ✓ Found .webedt file with preview_url
Result: https://my-custom-preview.example.com/app/
✓ Match: true

✓ All tests completed successfully!
```

## Error Handling

The preview URL helper is designed to be resilient:

- ✅ No `.webedt` file → Returns default URL
- ✅ Invalid `.webedt` JSON → Logs warning, returns default URL
- ✅ `.webedt` exists but no `preview_url` → Returns default URL
- ✅ Any error → Always returns a valid default URL

This ensures you always get a preview URL, even in edge cases.

## Integration Points

The preview URL can be integrated into:

1. **SSE Events** - Include in `branch_created`, `connected` events
2. **API Responses** - Add to session detail endpoints
3. **Frontend UI** - Display as a preview button/link
4. **Notifications** - Include in commit/PR notifications
5. **Webhooks** - Add to webhook payloads

See `PREVIEW_URL_INTEGRATION_EXAMPLES.md` for detailed integration examples.

## FAQ

### Q: What if I don't add a `.webedt` file?

**A:** No problem! The system will use the default URL format. This is the expected behavior for most repositories.

### Q: Can I use environment variables in the preview URL?

**A:** No, the `.webedt` file is static JSON. However, you could implement custom logic in your application to process the URL.

### Q: What happens if the `.webedt` file is malformed?

**A:** The system logs a warning and falls back to the default URL. Your application continues to work normally.

### Q: Can I have different preview URLs for different branches?

**A:** Not directly. The `.webedt` file provides one URL for the entire repository. If you need branch-specific URLs, you can use the default format which includes the branch name.

### Q: Is the `.webedt` file required?

**A:** No! It's completely optional. The system works perfectly without it.

### Q: What does "webedt" stand for?

**A:** It appears to be a custom configuration file format for this project. The name likely relates to web editing or web development tools.

## Support

For issues or questions:
- See the demo: `PREVIEW_URL_DEMO.md`
- Check examples: `PREVIEW_URL_INTEGRATION_EXAMPLES.md`
- Review the code: `ai-coding-worker/src/utils/previewUrlHelper.ts`

## License

Same as the main project.
