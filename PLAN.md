# GitHub Worker Refactoring Plan

## Overview

Create a new **GitHub Worker** service that consolidates all GitHub/Git operations from the AI Coding Worker and Collaborative Session Worker. The GitHub Worker will be ephemeral (exits after each job) and communicate via SSE for real-time status updates.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction Model | SSE streaming | Real-time status updates for long-running git operations |
| LLM Features | Include in GitHub Worker | Centralize session naming and commit message generation |
| Lifecycle | Ephemeral | Security isolation - prevents cross-user data exposure |

## Current State

### AI Coding Worker GitHub Logic (to be moved)
- `src/clients/githubClient.ts` - Repository cloning/pulling with auth
- `src/utils/gitHelper.ts` - Git operations (branch, commit, push, status, diff)
- `src/utils/llmHelper.ts` - LLM-based session title/branch name and commit message generation
- `src/utils/credentialManager.ts` - Claude credential management for LLM calls
- `src/orchestrator.ts` - GitHub workflow orchestration (Steps 4, 4.5, 6.5)

### Collaborative Session Worker GitHub Logic (to be moved)
- `src/autoCommit.ts` - Scheduled auto-commit functionality

## New GitHub Worker Architecture

```
github-worker/
├── package.json
├── tsconfig.json
├── Dockerfile
├── swarm.yml
├── CLAUDE.md
└── src/
    ├── server.ts              # Express server with SSE endpoints
    ├── types.ts               # Request/response types
    ├── operations/
    │   ├── cloneRepository.ts   # Clone/pull repository
    │   ├── createBranch.ts      # Create and push branch
    │   ├── commitAndPush.ts     # Commit changes and push
    │   └── generateNames.ts     # LLM-based naming (session title, branch, commit message)
    ├── clients/
    │   └── githubClient.ts      # Git operations (from ai-coding-worker)
    ├── utils/
    │   ├── gitHelper.ts         # Git helper (from ai-coding-worker)
    │   ├── llmHelper.ts         # LLM helper (from ai-coding-worker)
    │   ├── credentialManager.ts # Credential management (from ai-coding-worker)
    │   └── logger.ts            # Logging utility
    └── storage/
        └── storageClient.ts     # Storage worker client (download/upload sessions)
```

## API Endpoints

### 1. POST /clone-repository
Clone a GitHub repository into a session.

**Request:**
```json
{
  "sessionId": "abc123",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "accessToken": "ghp_xxx"
}
```

**SSE Events:**
```
data: {"type": "progress", "stage": "downloading_session", "message": "Downloading existing session..."}
data: {"type": "progress", "stage": "cloning", "message": "Cloning repository..."}
data: {"type": "progress", "stage": "uploading", "message": "Uploading session to storage..."}
data: {"type": "completed", "clonedPath": "monorepo", "branch": "main", "wasCloned": true}
```

### 2. POST /create-branch
Create a new branch with LLM-generated name.

**Request:**
```json
{
  "sessionId": "abc123",
  "userRequest": "Add dark mode toggle to settings",
  "baseBranch": "main",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx"
}
```

**SSE Events:**
```
data: {"type": "progress", "stage": "generating_name", "message": "Generating session title and branch name..."}
data: {"type": "progress", "stage": "creating_branch", "message": "Creating branch: webedt/add-dark-mode-abc12345"}
data: {"type": "progress", "stage": "pushing", "message": "Pushing branch to trigger build..."}
data: {"type": "completed", "branchName": "webedt/add-dark-mode-abc12345", "sessionTitle": "Add Dark Mode Toggle", "sessionPath": "owner__repo__webedt-add-dark-mode-abc12345"}
```

### 3. POST /commit-and-push
Commit changes with LLM-generated message and push.

**Request:**
```json
{
  "sessionId": "abc123",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx",
  "userId": "user123"
}
```

**SSE Events:**
```
data: {"type": "progress", "stage": "downloading_session", "message": "Downloading session..."}
data: {"type": "progress", "stage": "analyzing", "message": "Analyzing changes..."}
data: {"type": "progress", "stage": "generating_message", "message": "Generating commit message..."}
data: {"type": "progress", "stage": "committing", "message": "Committing changes..."}
data: {"type": "progress", "stage": "pushing", "message": "Pushing to remote..."}
data: {"type": "completed", "commitHash": "abc1234", "commitMessage": "Add dark mode toggle", "branch": "webedt/add-dark-mode-abc12345"}
```

### 4. GET /health
Health check endpoint.

### 5. GET /status
Worker status (idle/busy).

## Changes to Existing Workers

### AI Coding Worker Changes

1. **Remove GitHub-related files:**
   - `src/clients/githubClient.ts`
   - `src/utils/gitHelper.ts`
   - `src/utils/llmHelper.ts`
   - `src/utils/credentialManager.ts`

2. **Add GitHub Worker client:**
   - `src/clients/githubWorkerClient.ts` - Client to call GitHub Worker endpoints

3. **Modify orchestrator.ts:**
   - Step 4: Call GitHub Worker `/clone-repository` instead of local `githubClient.pullRepository()`
   - Step 4.5: Call GitHub Worker `/create-branch` instead of local LLM + git operations
   - Step 6.5: Call GitHub Worker `/commit-and-push` instead of local auto-commit

4. **Remove `simple-git` dependency** from package.json

### Collaborative Session Worker Changes

1. **Remove `autoCommit.ts`**

2. **Add GitHub Worker client:**
   - `src/clients/githubWorkerClient.ts`

3. **Modify server.ts:**
   - Replace `AutoCommit` class with calls to GitHub Worker `/commit-and-push`
   - Keep the cooldown/scheduling logic, but delegate actual commit to GitHub Worker

4. **Remove `simple-git` dependency** from package.json

## Implementation Steps

### Phase 1: Create GitHub Worker (New Service)

1. Create directory structure `/github-worker/`
2. Create `package.json` with dependencies:
   - `express`, `cors` (HTTP server)
   - `simple-git` (Git operations)
   - `@anthropic-ai/claude-agent-sdk` (LLM calls)
   - `uuid`, `dotenv`
3. Create `tsconfig.json` (copy from storage-worker)
4. Copy and adapt files from ai-coding-worker:
   - `githubClient.ts` → `src/clients/githubClient.ts`
   - `gitHelper.ts` → `src/utils/gitHelper.ts`
   - `llmHelper.ts` → `src/utils/llmHelper.ts`
   - `credentialManager.ts` → `src/utils/credentialManager.ts`
   - `logger.ts` → `src/utils/logger.ts`
5. Create `src/types.ts` with request/response types
6. Create `src/storage/storageClient.ts` (simplified from ai-coding-worker)
7. Create operation modules:
   - `src/operations/cloneRepository.ts`
   - `src/operations/createBranch.ts`
   - `src/operations/commitAndPush.ts`
8. Create `src/server.ts` with SSE endpoints
9. Create `Dockerfile` (based on ai-coding-worker, needs git)
10. Create `swarm.yml`
11. Create `CLAUDE.md`

### Phase 2: Add GitHub Worker Client to Other Workers

1. Create `githubWorkerClient.ts` in ai-coding-worker
2. Create `githubWorkerClient.ts` in collaborative-session-worker

### Phase 3: Refactor AI Coding Worker

1. Modify `orchestrator.ts` to use GitHub Worker client
2. Remove unused GitHub-related files
3. Update `package.json` (remove simple-git)
4. Update tests if any

### Phase 4: Refactor Collaborative Session Worker

1. Modify `server.ts` to use GitHub Worker client for commits
2. Keep scheduling logic but delegate to GitHub Worker
3. Remove `autoCommit.ts`
4. Update `package.json` (remove simple-git)

### Phase 5: Update Monorepo Configuration

1. Update root `CLAUDE.md` with GitHub Worker documentation
2. Add GitHub Worker to any CI/CD pipelines
3. Update deployment documentation

## Environment Variables

### GitHub Worker
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5002` | Server port |
| `TMP_DIR` | `/tmp` | Temporary directory for workspaces |
| `STORAGE_WORKER_URL` | - | URL to storage worker |

## Docker/Swarm Configuration

```yaml
# github-worker/swarm.yml
version: '3.8'

services:
  github-worker:
    image: dockerregistry.etdofresh.com/github-worker:latest
    ports:
      - target: 5002
        published: 5003
        protocol: tcp
        mode: ingress
    environment:
      - PORT=5002
      - TMP_DIR=/tmp
      - STORAGE_WORKER_URL=${STORAGE_WORKER_URL:-}
    deploy:
      replicas: 5
      restart_policy:
        condition: any
        delay: 0s
        max_attempts: 0
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

## Security Considerations

1. **Ephemeral workers** - Each job runs in isolation, exits after completion
2. **No shared state** - Sessions downloaded fresh for each operation
3. **Token handling** - GitHub tokens only used in-memory, not persisted
4. **Credential isolation** - Claude credentials written to temp directory, cleaned up after

## SSE Event Types

All endpoints use SSE with these common event types:

```typescript
interface ProgressEvent {
  type: 'progress';
  stage: string;
  message: string;
  timestamp: string;
}

interface CompletedEvent {
  type: 'completed';
  // Operation-specific fields
  timestamp: string;
}

interface ErrorEvent {
  type: 'error';
  error: string;
  code: string;
  timestamp: string;
}
```

## File Count Estimate

| Category | Files |
|----------|-------|
| New files (github-worker) | ~15 |
| Modified files (ai-coding-worker) | ~3 |
| Modified files (collaborative-session-worker) | ~3 |
| Deleted files | ~5 |
| **Total changes** | ~26 files |

## Testing Strategy

1. Test GitHub Worker endpoints independently
2. Test AI Coding Worker with mocked GitHub Worker
3. Test Collaborative Session Worker with mocked GitHub Worker
4. Integration test full flow with all workers running
