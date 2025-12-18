# Plan: Decouple Sessions from Branches

## Overview

Replace the tightly-coupled "sessions" concept with two distinct systems:
1. **Remote Task Agents** - Autonomous agents that work on tasks (auto-generated branches)
2. **Live Workspace** - Branch-based editing for Code/Images/Sounds/Scenes/Live Chat

---

## Terminology Changes

| Old Term | New Term |
|----------|----------|
| Sessions | Agents (Remote Task Agents) |
| My Sessions | My Agents |
| Session ID | Agent ID |
| Chat Session | Agent Task |
| Live Chat | Live Chat (new - local execution) |

---

## URL Structure

### New Routes

```
# Remote Task Agents
/agents                              → List of all agents
/agents/:agentId                     → View specific agent details/conversation

# Live Workspace (branch-based)
/github/:owner/:repo/:branch/        → Preview (existing)
/github/:owner/:repo/:branch/code    → Code editor
/github/:owner/:repo/:branch/images  → Image editor
/github/:owner/:repo/:branch/sounds  → Sound editor
/github/:owner/:repo/:branch/scenes  → Scene editor
/github/:owner/:repo/:branch/chat    → Live Chat

# Branch Selection (entry point)
/workspace                           → Select repo + branch (or create new)
/workspace/new                       → Create new branch flow
```

### Removed Routes

```
/sessions                            → Replaced by /agents
/sessions/:sessionId                 → Replaced by /agents/:agentId
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REMOTE TASK AGENTS                          │
│  (/agents)                                                          │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │  Agent Task 1   │  │  Agent Task 2   │  │  Agent Task 3   │     │
│  │  ───────────    │  │  ───────────    │  │  ───────────    │     │
│  │  Auto-branch    │  │  Auto-branch    │  │  Auto-branch    │     │
│  │  Remote exec    │  │  Remote exec    │  │  Remote exec    │     │
│  │  (Anthropic)    │  │  (Anthropic)    │  │  (Anthropic)    │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
│  Storage: PostgreSQL (metadata) + GitHub API (direct clone/push)    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         LIVE WORKSPACE                              │
│  (/github/:owner/:repo/:branch/*)                                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Branch Context: webedt/monorepo @ feature-branch            │  │
│  │  [Select New Branch]                                          │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │  Code | Images | Sounds | Scenes | Live Chat | Preview        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Storage: GitHub API (files) + MinIO (Live Chat workspace state)   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Changes

### Rename: `chatSessions` → `agents`

```sql
-- Rename table
ALTER TABLE chat_sessions RENAME TO agents;

-- Rename columns for clarity
ALTER TABLE agents RENAME COLUMN user_request TO task_request;

-- Remove session_path (no longer needed - no MinIO for agents)
ALTER TABLE agents DROP COLUMN session_path;

-- Keep existing columns:
-- id, user_id, task_request, status, branch (auto-generated),
-- repository_*, created_at, etc.
```

### New Table: `live_chat_messages`

```sql
CREATE TABLE live_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  role TEXT NOT NULL,              -- 'user' | 'assistant'
  content TEXT NOT NULL,
  tool_calls JSONB,                -- For assistant tool use
  created_at TIMESTAMP DEFAULT NOW(),

  -- Composite index for efficient queries
  UNIQUE(owner, repo, branch, user_id, created_at)
);

CREATE INDEX idx_live_chat_branch ON live_chat_messages(owner, repo, branch);
```

---

## Implementation Phases

### Phase 1: Terminology & Routing (Low Risk)
1. Rename "Sessions" to "Agents" in UI
2. Add `/agents` routes (keep `/sessions` as redirect temporarily)
3. Update sidebar navigation
4. Update all user-facing text

### Phase 2: Branch Selection UI (Medium Risk)
1. Create `BranchSelector` component
2. Implement branch selection flow:
   - Select existing branch
   - Auto-generate new branch
   - Custom prefix + auto-suffix
3. Add "Select New Branch" to top bar
4. Store selected branch in URL (not state)

### Phase 3: Live Workspace Routes (Medium Risk)
1. Create `/github/:owner/:repo/:branch/code` route
2. Create `/github/:owner/:repo/:branch/images` route
3. Create `/github/:owner/:repo/:branch/sounds` route
4. Create `/github/:owner/:repo/:branch/scenes` route
5. Create `/github/:owner/:repo/:branch/chat` route
6. Update navigation to use branch-based URLs

### Phase 4: GitHub API Integration (Medium Risk)
1. Switch Code editor to use GitHub API for file operations
2. Switch Images/Sounds/Scenes to use GitHub API
3. Remove MinIO dependency from Remote Task Agents (use direct GitHub clone/push)
4. Keep MinIO only for Live Chat workspace state

### Phase 5: Live Chat Implementation (High Complexity)
1. Create `live_chat_messages` table
2. Create Live Chat API endpoints:
   - `GET /api/live-chat/:owner/:repo/:branch/messages`
   - `POST /api/live-chat/:owner/:repo/:branch/messages`
   - `DELETE /api/live-chat/:owner/:repo/:branch/messages`
3. Implement local LLM execution (same streaming as remote agents)
4. Connect Live Chat to branch workspace

### Phase 6: Database Migration (High Risk)
1. Rename `chat_sessions` table to `agents`
2. Update all references in code
3. Update API endpoints
4. Test thoroughly before deploying

### Phase 7: Cleanup
1. Remove old session-based code paths
2. Remove temporary redirects
3. Update documentation

---

## Component Changes

### New Components

```
website/client/src/components/
├── workspace/
│   ├── BranchSelector.tsx        # Select/create branch UI
│   ├── WorkspaceHeader.tsx       # Top bar with branch context
│   └── WorkspaceNav.tsx          # Code|Images|Sounds|Scenes|Chat tabs
├── agents/
│   ├── AgentList.tsx             # List of remote task agents
│   ├── AgentCard.tsx             # Individual agent card
│   └── AgentDetail.tsx           # Agent conversation view
└── live-chat/
    ├── LiveChat.tsx              # Live chat interface
    └── LiveChatInput.tsx         # Chat input with file context
```

### Modified Components

```
website/client/src/
├── App.tsx                       # Add new routes
├── components/
│   ├── Sidebar.tsx               # Replace Sessions with Agents
│   ├── SessionsSidebar.tsx       # Rename to AgentsSidebar.tsx
│   └── Header.tsx                # Add branch context display
└── pages/
    ├── Sessions.tsx              # Rename to Agents.tsx
    ├── Code.tsx                  # Switch to GitHub API, remove session dependency
    ├── Images.tsx                # Switch to GitHub API
    ├── Sounds.tsx                # Switch to GitHub API
    └── Scenes.tsx                # Switch to GitHub API
```

---

## API Changes

### Renamed Endpoints

| Old Endpoint | New Endpoint |
|--------------|--------------|
| `/api/sessions` | `/api/agents` |
| `/api/sessions/:id` | `/api/agents/:id` |
| `/api/sessions/:id/messages` | `/api/agents/:id/messages` |

### New Endpoints

```
# Live Chat
GET    /api/live-chat/:owner/:repo/:branch/messages
POST   /api/live-chat/:owner/:repo/:branch/messages
DELETE /api/live-chat/:owner/:repo/:branch/messages
POST   /api/live-chat/:owner/:repo/:branch/execute    # Local LLM execution

# Branch Management
POST   /api/github/branches                           # Create new branch
GET    /api/github/:owner/:repo/branches              # List branches
```

---

## Branch Creation Flow

```
User clicks "New Workspace" or "Select New Branch"
            │
            ▼
┌─────────────────────────────────────┐
│  1. Select Repository               │
│     [owner/repo dropdown]           │
└─────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────┐
│  2. Select or Create Branch         │
│                                     │
│  ○ Existing: [branch dropdown]     │
│  ○ Auto-generate new branch        │
│  ○ Custom: [prefix___] + uuid      │
└─────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────┐
│  3. If creating new branch:         │
│     POST /api/github/branches       │
│     {                               │
│       owner, repo,                  │
│       baseBranch: "main",           │
│       newBranch: "prefix-abc123"    │
│     }                               │
└─────────────────────────────────────┘
            │
            ▼
Navigate to /github/:owner/:repo/:branch/code
```

---

## Storage Strategy

### Remote Task Agents (simplified)
- **PostgreSQL**: Agent metadata, messages, status
- **GitHub API**: Direct clone/commit/push (no MinIO tarballs)
- **No MinIO**: Agents work directly with GitHub

### Live Workspace (new)
- **GitHub API**: All file operations (code, images, sounds, scenes)
- **PostgreSQL**: Live Chat messages
- **MinIO**: Live Chat workspace state (for local LLM execution context)

---

## Migration Strategy

### Existing Sessions → Agents
1. Rename table `chat_sessions` → `agents`
2. All existing sessions become agents
3. Existing agent branches remain intact
4. No data loss, just terminology change

### No Migration Needed For
- Live Workspace is a new feature
- Live Chat is a new feature
- Both start fresh with GitHub API

---

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1. Terminology | Low | Simple rename, keep redirects |
| 2. Branch Selection | Medium | New UI, isolated component |
| 3. Live Routes | Medium | New routes, don't break existing |
| 4. GitHub API | Medium | Test thoroughly, fallback to existing |
| 5. Live Chat | High | New feature, isolated from agents |
| 6. DB Migration | High | Backup first, test in staging |

---

## Success Criteria

1. ✅ Users can create agents (remote task execution)
2. ✅ Users can select/create branches for live workspace
3. ✅ Code/Images/Sounds/Scenes work with GitHub API
4. ✅ Live Chat works with local execution
5. ✅ Branch context persists across page navigation
6. ✅ "Select New Branch" allows switching contexts
7. ✅ No data loss from existing sessions

---

## Questions Remaining

1. **Local LLM execution for Live Chat** - What provider/model to use?
   - Same Claude API but running locally?
   - Different model?

2. **Live Chat history persistence** - How long to keep?
   - Per-branch? Per-user? Time-limited?

3. **Branch permissions** - Can any user work on any branch?
   - Or only branches they created?

---

## Next Steps

1. [ ] Review and approve this plan
2. [ ] Start with Phase 1 (terminology changes)
3. [ ] Iterate through phases with testing between each
