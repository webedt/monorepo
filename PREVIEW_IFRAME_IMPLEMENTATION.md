# Preview Tab - iframe Implementation

## Overview

The Preview tab now displays the repository preview URL in a full-window iframe below the top navigation bars. The iframe takes up all available space in the content area.

## What Was Implemented

### 1. Backend Changes

#### Updated `website/apps/server/src/routes/sessions.ts`

- Added import for `getPreviewUrl` helper
- Modified the `GET /api/sessions/:id` endpoint to include preview URL in response
- Preview URL is generated dynamically based on session's repository info

**Code added:**
```typescript
// Add preview URL if repository info is available
let previewUrl: string | null = null;
if (session.repositoryOwner && session.repositoryName && session.branch) {
  previewUrl = await getPreviewUrl(
    undefined, // workspace path not available in server context
    session.repositoryOwner,
    session.repositoryName,
    session.branch
  );
}

res.json({
  success: true,
  data: {
    ...session,
    previewUrl
  }
});
```

### 2. Frontend Changes

#### Updated `website/apps/client/src/pages/Preview.tsx`

**Complete rewrite with the following features:**

1. **Fetches session data** to get the preview URL
2. **Loading state** - Shows spinner while fetching session data
3. **No preview state** - Shows placeholder when no repository is connected
4. **iframe display** - Shows full-window iframe when preview URL is available

**Key Features:**
- iframe takes up entire available space below top bars
- Sandbox attributes for security
- Allow permissions for interactive content
- Clean, minimal UI

**Code structure:**
```typescript
// Fetch session to get preview URL
const { data: sessionData, isLoading } = useQuery({
  queryKey: ['session-details', sessionId],
  queryFn: () => sessionsApi.get(sessionId),
  enabled: !!sessionId && sessionId !== 'new',
});

const previewUrl = sessionData?.data?.previewUrl || null;
```

## How It Works

### Flow:

1. **User navigates to Preview tab** (`/session/{id}/preview`)
2. **Frontend fetches session details** via `sessionsApi.get(sessionId)`
3. **Backend calculates preview URL**:
   - Checks if `.webedt` file exists (would need workspace access)
   - Falls back to default: `https://github.etdofresh.com/{owner}/{repo}/{branch}/`
4. **Frontend displays iframe** with the preview URL
5. **iframe loads the preview** in the full content area

### States:

1. **Loading**: Shows spinner while fetching
2. **No Preview**: Shows placeholder if no repository connected
3. **Preview Ready**: Shows iframe with the URL

## iframe Configuration

### Sandbox Attributes
```typescript
sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
```

- `allow-scripts` - Enables JavaScript (for interactive previews)
- `allow-same-origin` - Allows same-origin requests
- `allow-forms` - Allows form submissions
- `allow-popups` - Allows popups (for OAuth, etc.)
- `allow-modals` - Allows modal dialogs

### Allow Attributes
```typescript
allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
```

Enables various browser features for rich content.

## Layout Structure

```
┌─────────────────────────────────────┐
│   Top Navigation Bar (sticky)       │  ← SessionLayout header
├─────────────────────────────────────┤
│   Repository Status Bar (sticky)    │  ← Shows connection status
├─────────────────────────────────────┤
│                                     │
│                                     │
│          iframe (full size)         │  ← Preview content
│                                     │
│                                     │
└─────────────────────────────────────┘
```

The iframe expands to fill all available vertical space below the fixed headers.

## Example URLs

### Default Preview URL (most common)
```
Repository: facebook/react
Branch: main
Preview URL: https://github.etdofresh.com/facebook/react/main/
```

### Custom Preview URL (with .webedt file)
```
Repository: myorg/myapp
Branch: feature-xyz
.webedt contains: { "preview_url": "https://staging.myapp.com/" }
Preview URL: https://staging.myapp.com/
```

## CSS Classes Used

- `h-full` - Full height
- `bg-base-300` - Background color
- `flex flex-col` - Flexbox column layout
- `flex-1` - Flexible sizing
- `relative` - Relative positioning for iframe
- `border-0` - No border on iframe

## Security Considerations

1. **Sandbox attribute** limits iframe capabilities
2. **Same-origin policy** applies (can be relaxed with sandbox)
3. **CORS** - Preview site must allow embedding
4. **X-Frame-Options** - Preview site must not deny framing

## Testing

To test the implementation:

1. Create a session with a repository
2. Wait for branch to be created
3. Navigate to Preview tab
4. Should see iframe loading the preview URL

## Future Enhancements

Possible improvements:

1. **Reload button** - Refresh iframe content
2. **Open in new tab** - Button to open preview in new window
3. **Responsive controls** - Resize iframe or switch between desktop/mobile views
4. **Error handling** - Better error messages if iframe fails to load
5. **Loading indicator** - Show when iframe content is loading

## Files Modified

1. `website/apps/server/src/routes/sessions.ts` - Add preview URL to API response
2. `website/apps/client/src/pages/Preview.tsx` - Complete rewrite with iframe

## Dependencies

- Uses existing `getPreviewUrl` helper from preview URL feature
- React Query for data fetching
- React Router for navigation
- Tailwind CSS for styling

## Related Documentation

- `PREVIEW_URL_README.md` - Main preview URL feature documentation
- `PREVIEW_URL_DEMO.md` - Usage examples
- `PREVIEW_URL_INTEGRATION_EXAMPLES.md` - Integration guide

---

**Status**: ✅ Complete and ready to use
**Last Updated**: 2024-11-27
