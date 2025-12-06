# Split View Implementation Plan

## Overview
Implement URL-based split view routing (e.g., `/session/:id/code+preview`) to show two editor pages side-by-side.

## Route Pattern
```
/session/:sessionId/:leftPage+:rightPage
```
Examples:
- `/session/abc123/code+preview` - Code editor on left, Preview on right
- `/session/abc123/images+preview` - Images editor on left, Preview on right
- `/session/abc123/code+images` - Code on left, Images on right

Valid page names: `chat`, `code`, `images`, `sound`, `scene-editor`, `preview`

---

## Implementation Steps

### Phase 1: Extract Content Components

Some pages already have separate content components, others need refactoring:

| Page | Current State | Action Needed |
|------|--------------|---------------|
| `Images.tsx` | Has `ImagesContent` | Export it |
| `Sound.tsx` | Has `SoundContent` | Export it |
| `Preview.tsx` | Has `PreviewContent` | Export it, make session-aware |
| `Code.tsx` | Monolithic | Extract `CodeContent` |
| `Chat.tsx` | Monolithic | Extract `ChatContent` |
| `SceneEditor.tsx` | Monolithic | Extract `SceneEditorContent` |

**For each page, create/export a content component that:**
- Receives `sessionId` as a prop (or uses useParams internally)
- Renders only the main content area (no SessionLayout wrapper)
- Handles its own data fetching with the session context

### Phase 2: Create SplitLayout Component

Create `/components/SplitLayout.tsx`:

```tsx
interface SplitLayoutProps {
  leftPage: string;
  rightPage: string;
  sessionId: string;
  splitRatio?: number; // 0.5 = 50/50, 0.3 = 30/70, etc.
  orientation?: 'horizontal' | 'vertical';
}

export default function SplitLayout({
  leftPage,
  rightPage,
  sessionId,
  splitRatio = 0.5,
  orientation = 'horizontal'
}: SplitLayoutProps) {
  // Map page names to content components
  // Render SessionLayout once with both panes as children
  // Include draggable divider for resizing
}
```

**Features:**
- Draggable divider to resize panes
- Persist split ratio in localStorage per session
- Support both horizontal (side-by-side) and vertical (top-bottom) splits
- Visual indicator of which pane is "active" (for keyboard shortcuts)

### Phase 3: Update Routing

In `App.tsx`, add new route pattern:

```tsx
{/* Split view routes */}
<Route
  path="/session/:sessionId/:pages"
  element={
    <ProtectedRoute>
      <SplitViewRouter />
    </ProtectedRoute>
  }
/>
```

Create `SplitViewRouter.tsx` to parse the URL and render appropriately:

```tsx
export default function SplitViewRouter() {
  const { sessionId, pages } = useParams();

  // Check if pages contains '+' (split view)
  if (pages?.includes('+')) {
    const [leftPage, rightPage] = pages.split('+');
    return <SplitLayout leftPage={leftPage} rightPage={rightPage} sessionId={sessionId!} />;
  }

  // Otherwise, render single page (existing behavior)
  return <SinglePageRouter page={pages} sessionId={sessionId} />;
}
```

### Phase 4: Add UI Controls

**A. Navigation bar split button:**
Add a "Split View" dropdown/button next to each navigation item:
- Clicking "Code" navigates to `/session/:id/code` (existing)
- Clicking split icon next to "Code" shows dropdown: "Split with Preview", "Split with Images", etc.

**B. Keyboard shortcut:**
- `Ctrl+\` or `Cmd+\` - Toggle split view with Preview
- `Ctrl+Shift+\` - Cycle through split configurations

**C. SessionLayout updates:**
- When in split view, the navigation shows which pages are active
- Add "Close Split" button to return to single view

### Phase 5: State Management

Add to `store.ts`:

```tsx
interface SplitViewPreferences {
  // Per-session split preferences
  sessions: Record<string, {
    splitRatio: number;
    orientation: 'horizontal' | 'vertical';
    lastSplitConfig?: string; // e.g., 'code+preview'
  }>;

  setSplitRatio: (sessionId: string, ratio: number) => void;
  setOrientation: (sessionId: string, orientation: 'horizontal' | 'vertical') => void;
  setLastSplitConfig: (sessionId: string, config: string) => void;
}

export const useSplitViewStore = create<SplitViewPreferences>()(
  persist(
    (set, get) => ({
      sessions: {},
      // ... actions
    }),
    { name: 'split-view-preferences' }
  )
);
```

---

## File Changes Summary

### New Files
1. `components/SplitLayout.tsx` - Main split view container
2. `components/SplitViewRouter.tsx` - Route parser for split URLs
3. `components/SplitDivider.tsx` - Draggable resize handle

### Modified Files
1. `pages/Code.tsx` - Export `CodeContent`
2. `pages/Chat.tsx` - Export `ChatContent`
3. `pages/Images.tsx` - Export `ImagesContent`
4. `pages/Sound.tsx` - Export `SoundContent`
5. `pages/Preview.tsx` - Export `PreviewContent`, make session-aware
6. `pages/SceneEditor.tsx` - Export `SceneEditorContent`
7. `App.tsx` - Add split view route
8. `lib/store.ts` - Add `useSplitViewStore`
9. `components/SessionLayout.tsx` - Add split view UI controls

---

## Component Hierarchy (Split View)

```
<SplitViewRouter>
  <SessionLayout>           {/* Single wrapper for both panes */}
    <SplitLayout>
      <div className="left-pane">
        <CodeContent sessionId={...} />
      </div>
      <SplitDivider onDrag={...} />
      <div className="right-pane">
        <PreviewContent sessionId={...} />
      </div>
    </SplitLayout>
  </SessionLayout>
</SplitViewRouter>
```

---

## Edge Cases to Handle

1. **Invalid page combinations** - e.g., `chat+chat` should redirect to single view
2. **Mobile responsiveness** - On small screens, show tabs instead of split
3. **Session without repo** - Some pages need repo connection; handle gracefully
4. **Deep linking** - Split URLs should be shareable/bookmarkable
5. **Navigation within split** - Clicking a file in Code shouldn't affect Preview pane

---

## Implementation Order

1. **Phase 1** (Content extraction) - Can be done incrementally
2. **Phase 3** (Routing) - Core functionality
3. **Phase 2** (SplitLayout) - Core functionality
4. **Phase 5** (State) - Persistence
5. **Phase 4** (UI Controls) - Polish

Estimated effort: 2-3 days for core functionality, +1 day for polish
