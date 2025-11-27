# Mobile Preview - Open in New Tab

## Overview

On mobile devices, clicking the Preview link in the navigation now opens the preview URL directly in a new tab instead of navigating to the Preview page with an iframe. This provides a better mobile experience by avoiding nested scrolling and giving users the full screen for the preview.

## Behavior

### Desktop
- Clicking Preview → Navigates to `/session/{id}/preview`
- Shows iframe with preview content
- Full navigation bars remain visible

### Mobile
- Clicking Preview → Opens preview URL in new tab (if preview URL is available)
- Otherwise → Falls back to normal navigation to Preview page

## Implementation Details

### Mobile Detection

Added a helper function to detect mobile devices:

```typescript
const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};
```

### Preview URL Fetching

The SessionLayout component now:
1. Fetches session data via existing query
2. Extracts `previewUrl` from session data
3. Stores it in component state

```typescript
const [previewUrl, setPreviewUrl] = useState<string | null>(null);

useEffect(() => {
  if (sessionData?.data) {
    const url = (sessionData.data as any)?.previewUrl || null;
    setPreviewUrl(url);
  }
}, [sessionData]);
```

### Click Handler

Created a click handler that:
1. Checks if device is mobile
2. Checks if preview URL is available
3. If both true, prevents default navigation and opens new tab
4. Otherwise, allows normal Link navigation

```typescript
const handlePreviewClick = (e: React.MouseEvent) => {
  if (isMobileDevice() && previewUrl) {
    e.preventDefault();
    window.open(previewUrl, '_blank');
  }
  // On desktop or when no preview URL, let the Link navigate normally
};
```

### Updated Components

#### `SessionLayout.tsx`
- Added mobile detection helper
- Added preview URL state
- Added effect to extract preview URL from session
- Added click handler
- Updated desktop Preview link to use onClick handler
- Updated mobile menu nav items to include onClick handler

#### `MobileMenu.tsx`
- Updated `NavItem` interface to support `onClick` property
- Updated Link rendering to call `onClick` if provided

## Files Modified

1. `website/apps/client/src/components/SessionLayout.tsx`
   - Added mobile detection
   - Added preview URL state management
   - Added click handler
   - Updated Preview links (desktop and mobile)

2. `website/apps/client/src/components/MobileMenu.tsx`
   - Added `onClick` support to NavItem interface
   - Updated Link onClick to call custom handler

## User Experience

### Mobile Users

**Before:**
1. Click Preview
2. Navigate to Preview page
3. See iframe (potentially small/awkward on mobile)
4. Nested scrolling issues
5. Navigation bars take up space

**After:**
1. Click Preview
2. New tab opens with preview URL
3. Full-screen preview experience
4. Native browser controls
5. Can easily switch back via browser tabs

### Desktop Users

**Unchanged:**
1. Click Preview
2. Navigate to Preview page
3. See iframe in main content area
4. Navigation bars remain visible for easy access

## Edge Cases Handled

1. **No preview URL available**: Falls back to normal navigation (shows "No Preview Available" page)
2. **Desktop with preview URL**: Still shows iframe in Preview page (better for larger screens)
3. **Session without repository**: No preview URL, normal navigation works
4. **Already on Preview page**: Link is disabled (grayed out)

## Testing

### Desktop
```
1. Open a session with repository
2. Click Preview in nav bar
3. Should navigate to /session/{id}/preview
4. Should see iframe with preview content
```

### Mobile (or simulated mobile)
```
1. Open a session with repository
2. Use browser dev tools to simulate mobile device
3. Click Preview in hamburger menu or nav bar
4. Should open new tab with preview URL
5. Preview URL format: https://github.etdofresh.com/{owner}/{repo}/{branch}/
```

## Technical Notes

- Uses standard `window.open(url, '_blank')` for new tab
- Browser may block popup if not triggered by user interaction
- Mobile detection is user-agent based (simple but effective)
- Preview URL is fetched from backend via existing session query
- No additional API calls required

## Benefits

✅ Better mobile UX - full-screen preview
✅ No nested scrolling issues
✅ Native browser back button works
✅ Can use native browser features (refresh, share, etc.)
✅ Desktop experience unchanged
✅ Minimal code changes
✅ Uses existing preview URL infrastructure

## Future Enhancements

Possible improvements:

1. **Responsive detection** - Use CSS media queries instead of user-agent
2. **User preference** - Let users choose behavior in settings
3. **Deep linking** - Support opening specific preview URLs via query params
4. **Preview history** - Track recently viewed previews

---

**Status**: ✅ Complete and ready to use
**Last Updated**: 2024-11-27
