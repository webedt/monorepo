# Preview URL - Quick Start Guide

## TL;DR

Get a preview URL for any repository and branch:

```typescript
import { getPreviewUrl } from './utils/previewUrlHelper';

const url = await getPreviewUrl(workspacePath, owner, repo, branch);
```

**Result:**
- If `.webedt` file exists with `preview_url` → returns custom URL
- Otherwise → returns `https://github.etdofresh.com/{owner}/{repo}/{branch}/`

---

## 30-Second Setup

### AI Coding Worker

```typescript
import { getPreviewUrl } from '../utils/previewUrlHelper';

// Example: Get preview URL for current session
const previewUrl = await getPreviewUrl(
  this.workspacePath,
  metadata.repositoryOwner,
  metadata.repositoryName,
  metadata.branch
);

console.log(previewUrl);
// → https://github.etdofresh.com/facebook/react/main/
```

### Website Server

```typescript
import { getPreviewUrlFromSession } from '../utils/previewUrlHelper';

// Example: Add to API response
router.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.params.id);
  const previewUrl = await getPreviewUrlFromSession(session);

  res.json({ ...session, previewUrl });
});
```

---

## Creating a Custom Preview URL

**Step 1:** Create `.webedt` file in repository root

```bash
echo '{"preview_url":"https://your-url.com/"}' > .webedt
```

**Step 2:** Commit and push

```bash
git add .webedt
git commit -m "Add custom preview URL"
git push
```

**Step 3:** Done! The system will now use your custom URL.

---

## Common Use Cases

### 1. Add to SSE Event

```typescript
this.sendSSEEvent({
  type: 'branch_created',
  branchName,
  baseBranch,
  previewUrl: await getPreviewUrl(workspace, owner, repo, branch)
});
```

### 2. Add to API Response

```typescript
const sessions = await db.getSessions();
const withPreview = await Promise.all(
  sessions.map(async (s) => ({
    ...s,
    previewUrl: await getPreviewUrlFromSession(s)
  }))
);
```

### 3. Display in Frontend

```tsx
{session.previewUrl && (
  <a href={session.previewUrl} target="_blank">
    Preview →
  </a>
)}
```

---

## API Reference

| Function | Parameters | Returns | Use Case |
|----------|-----------|---------|----------|
| `getPreviewUrl()` | `workspacePath, owner, repo, branch` | `Promise<string>` | Get preview URL |
| `hasWebedtFile()` | `workspacePath` | `Promise<boolean>` | Check if .webedt exists |
| `readWebedtConfig()` | `workspacePath` | `Promise<WebedtConfig \| null>` | Read .webedt config |
| `getPreviewUrlFromSession()` | `session, workspacePath?` | `Promise<string \| null>` | Get URL from session (server only) |

---

## Files Location

```
ai-coding-worker/src/utils/previewUrlHelper.ts       ← AI worker
website/apps/server/src/utils/previewUrlHelper.ts    ← Website server
website/packages/shared/src/types.ts                 ← Types (WebedtConfig)
```

---

## Example .webedt File

```json
{
  "preview_url": "https://staging.myapp.com/"
}
```

Place in repository root (same level as `.git/`)

---

## Error Handling

The helper **always** returns a valid URL:

- ❌ No .webedt file → ✅ Returns default URL
- ❌ Invalid JSON → ✅ Returns default URL
- ❌ Missing field → ✅ Returns default URL
- ❌ Any error → ✅ Returns default URL

**You don't need to handle errors!** The function is designed to never fail.

---

## Testing

Run the demo test:

```bash
node /tmp/test-preview-url.js
```

Or create a quick test:

```typescript
const url = await getPreviewUrl('/tmp/test', 'owner', 'repo', 'main');
console.log(url); // https://github.etdofresh.com/owner/repo/main/
```

---

## Full Documentation

- 📖 **README**: `PREVIEW_URL_README.md` - Complete guide
- 🎯 **Demo**: `PREVIEW_URL_DEMO.md` - Usage examples
- 🔧 **Integration**: `PREVIEW_URL_INTEGRATION_EXAMPLES.md` - Code examples
- 📄 **Example**: `.webedt.example` - Sample config

---

## Questions?

**Q: Do I need to create a .webedt file?**
A: No! It's optional. Default URL works for most cases.

**Q: What if the .webedt file is invalid?**
A: No problem, it falls back to the default URL.

**Q: Can I use this in the frontend?**
A: The helper is for backend. Get the URL via API and use it in frontend.

---

**That's it!** You're ready to use preview URLs. 🎉
