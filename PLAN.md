# Three-Tier Architecture Refactor Plan

## Executive Summary

This plan outlines the consolidation of the current multi-worker architecture into a three-tier model:

1. **Frontend** (unchanged) - React web application
2. **Main Server** (new) - Single persistent server handling API, database, storage, and GitHub operations
3. **AI Coding Worker** (refactored) - Ephemeral containers for isolated LLM execution only

## Current Architecture Analysis

### Current Components

| Component | Type | Responsibilities |
|-----------|------|-----------------|
| Website Server | Persistent | API endpoints, database, SSE proxy to workers |
| AI Coding Worker | Ephemeral | Orchestration, LLM execution, GitHub/Storage coordination |
| GitHub Worker | Ephemeral | Clone, branch, commit, push operations |
| Storage Worker | Persistent | MinIO session management, file operations |
| Collaborative Session Worker | Persistent | WebSocket CRDT collaboration |

### Key Insight from Analysis

The current AI Coding Worker does **too much** - it orchestrates everything:
- Downloads/uploads sessions from storage
- Calls GitHub Worker for clone/branch/commit
- Executes LLM via provider
- Coordinates all the pieces

This orchestration should move to the Main Server, leaving AI Coding Worker to do **only LLM execution**.

---

## Target Architecture

```
                          FRONTEND (unchanged)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  - React Chat UI, File browser/editor, GitHub OAuth                   │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                              MAIN SERVER
  ┌───────────────────────────────────────────────────────────────────────┐
  │  (Single persistent service consolidating website + workers)          │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐       │
  │  │   API Routes    │  │  Storage Layer  │  │  GitHub Layer   │       │
  │  │  - /execute     │  │  - MinIO client │  │  - Clone repos  │       │
  │  │  - /resume      │  │  - File CRUD    │  │  - Create branch│       │
  │  │  - /sessions    │  │  - Tarball ops  │  │  - Commit/push  │       │
  │  │  - /files       │  │                 │  │  - PR operations│       │
  │  └─────────────────┘  └─────────────────┘  └─────────────────┘       │
  │                                                                       │
  │  ┌─────────────────┐  ┌─────────────────┐                            │
  │  │  Database Layer │  │ Worker Manager  │                            │
  │  │  - PostgreSQL   │  │  - Spawn workers│                            │
  │  │  - Drizzle ORM  │  │  - Mount storage│                            │
  │  │  - Sessions/msgs│  │  - Stream SSE   │                            │
  │  └─────────────────┘  └─────────────────┘                            │
  └───────────────────────────────────────────────────────────────────────┘
                                    │
                    Spawn per-request with mounted storage
                                    │
                                    ▼
                       AI CODING WORKER (ephemeral)
  ┌───────────────────────────────────────────────────────────────────────┐
  │  (Stripped down - LLM execution only)                                 │
  │                                                                       │
  │  - Receives workspace path as mount point                             │
  │  - Executes Claude Agent SDK / Codex                                  │
  │  - Streams events to Main Server                                      │
  │  - NO storage operations                                              │
  │  - NO GitHub operations                                               │
  │  - NO orchestration                                                   │
  │  - Single user's session data only (complete isolation)               │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Create Main Server Project Structure

**Goal**: Set up the new main-server project by consolidating existing code.

#### Tasks

1. **Create `/main-server` directory structure**
   ```
   main-server/
   ├── src/
   │   ├── index.ts                    # Express app entrypoint
   │   ├── config/
   │   │   └── env.ts                  # Environment configuration
   │   ├── db/                         # From website/apps/server/src/db
   │   │   ├── index.ts
   │   │   ├── schema.ts
   │   │   └── migrations/
   │   ├── routes/
   │   │   ├── execute.ts              # Main /execute endpoint (refactored)
   │   │   ├── resume.ts               # New /resume endpoint
   │   │   ├── sessions.ts             # From website
   │   │   ├── auth.ts                 # From website
   │   │   ├── github.ts               # From website
   │   │   ├── user.ts                 # From website
   │   │   └── files.ts                # Consolidated file operations
   │   ├── services/
   │   │   ├── storage/
   │   │   │   ├── storageService.ts   # From storage-worker
   │   │   │   └── minioClient.ts      # From storage-worker
   │   │   ├── github/
   │   │   │   ├── gitHelper.ts        # From github-worker
   │   │   │   ├── githubClient.ts     # From github-worker
   │   │   │   └── operations.ts       # Clone, branch, commit, push
   │   │   └── worker/
   │   │       ├── workerManager.ts    # NEW: Spawn/manage AI workers
   │   │       └── workerClient.ts     # NEW: Communicate with workers
   │   ├── middleware/
   │   │   └── auth.ts                 # From website
   │   ├── lib/
   │   │   ├── claudeAuth.ts           # From website
   │   │   ├── codexAuth.ts            # From website
   │   │   ├── llmHelper.ts            # From github-worker (for naming)
   │   │   └── sessionEventBroadcaster.ts
   │   └── utils/
   │       ├── logger.ts
   │       ├── sessionPathHelper.ts
   │       └── emojiMapper.ts
   ├── package.json
   ├── tsconfig.json
   ├── Dockerfile
   └── swarm.yml
   ```

2. **Copy and adapt existing code**
   - Website server routes → Main Server routes
   - Storage Worker service → Main Server storage service
   - GitHub Worker operations → Main Server GitHub service
   - Move LLM naming (llmHelper.ts) to Main Server

3. **Remove ephemeral behavior from storage/github code**
   - Remove `process.exit()` calls
   - Remove busy/idle state management
   - Convert to regular service classes

### Phase 2: Implement /execute Endpoint

**Goal**: Main Server orchestrates the full workflow, AI Worker only does LLM.

#### New /execute Flow

```
1. Frontend POST /execute
   │
2. Main Server: Authenticate, validate request
   │
3. Main Server: Create/update database session
   │
4. Main Server: Check MinIO for existing session
   │
5. If new session:
   │  a. Main Server: Clone repo via GitHub service
   │  b. Main Server: Generate session title/branch via LLM
   │  c. Main Server: Create branch, push
   │  d. Main Server: Store session in MinIO
   │
6. Main Server: Prepare workspace directory
   │
7. Main Server: Spawn AI Coding Worker
   │  - Docker container with mounted workspace
   │  - Pass: workspace path, credentials, user request
   │
8. Main Server: Proxy SSE from AI Worker to Frontend
   │  - Write events to database as they arrive
   │
9. When AI Worker completes:
   │  a. Main Server: Commit changes via GitHub service
   │  b. Main Server: Push to remote
   │  c. Main Server: Upload session to MinIO
   │
10. Main Server: Update database status, send completion
```

#### Key Code Changes

**Main Server `/execute` route** (new orchestration):

```typescript
// main-server/src/routes/execute.ts

router.post('/execute', requireAuth, async (req, res) => {
  const { userRequest, websiteSessionId, github } = req.body;

  // 1. Setup SSE
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  // 2. Create/load session
  let session = await loadOrCreateSession(websiteSessionId, user, github);

  // 3. Initialize workspace if needed
  if (!session.sessionPath) {
    sendEvent(res, { type: 'message', message: 'Initializing session...' });

    // Clone repository (now done by Main Server, not GitHub Worker)
    await githubService.cloneRepository(session, github);

    // Generate title and branch (LLM call from Main Server)
    const { title, branchName } = await llmService.generateSessionName(userRequest);

    // Create and push branch
    await githubService.createBranch(session, branchName);
    await githubService.push(session);

    // Upload to MinIO
    await storageService.uploadSession(session);

    sendEvent(res, { type: 'session_name', sessionName: title, branchName });
  }

  // 4. Spawn AI Coding Worker
  sendEvent(res, { type: 'message', message: 'Starting AI assistant...' });

  const worker = await workerManager.spawn({
    workspacePath: session.localPath,
    credentials: user.claudeAuth,
    userRequest,
    sessionId: session.id
  });

  // 5. Stream events from worker to client
  worker.on('event', (event) => {
    sendEvent(res, event);
    saveEventToDatabase(session.id, event);
  });

  // 6. On worker completion
  worker.on('complete', async () => {
    // Commit and push changes
    await githubService.commitAndPush(session);

    // Upload final state
    await storageService.uploadSession(session);

    // Update database
    await updateSessionStatus(session.id, 'completed');

    sendEvent(res, { type: 'completed', websiteSessionId: session.id });
    res.end();
  });
});
```

### Phase 3: Implement /resume Endpoint

**Goal**: Allow reconnection to in-progress or completed sessions.

#### /resume Flow

```
1. Frontend GET /resume?sessionId=xxx
   │
2. Main Server: Load session from database
   │
3. If session is 'running':
   │  a. Check if AI Worker is still active
   │  b. If yes: Reconnect to SSE stream
   │  c. If no: Mark session as completed/error
   │
4. Main Server: Replay stored events from database
   │
5. If session is 'completed': Return full event history
```

### Phase 4: Refactor AI Coding Worker

**Goal**: Strip down to LLM execution only.

#### Remove from AI Coding Worker

- `orchestrator.ts` - Move to Main Server
- `clients/githubWorkerClient.ts` - No longer needed
- `storage/storageClient.ts` - No longer needed
- `utils/credentialManager.ts` - Keep (for Claude SDK)
- `utils/sessionPathHelper.ts` - Move to Main Server

#### Keep in AI Coding Worker

- `server.ts` - Simplified to receive workspace + credentials
- `providers/` - All provider code (ClaudeCodeProvider, CodexProvider)
- `utils/emojiMapper.ts` - For SSE event decoration

#### New AI Worker Interface

```typescript
// ai-coding-worker/src/server.ts (simplified)

interface WorkerRequest {
  workspacePath: string;        // Pre-mounted by Main Server
  credentials: string;          // Claude/Codex auth
  userRequest: UserRequestContent;
  sessionId: string;            // For correlation
  providerOptions?: ProviderOptions;
}

app.post('/execute', async (req, res) => {
  const { workspacePath, credentials, userRequest, sessionId, providerOptions } = req.body;

  // Setup SSE
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  // Write credentials
  CredentialManager.writeClaudeCredentials(credentials);

  // Create provider
  const provider = ProviderFactory.createProvider(
    'ClaudeAgentSDK',
    credentials,
    workspacePath,
    providerOptions
  );

  // Execute and stream
  await provider.execute(userRequest, { workspace: workspacePath }, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  res.end();
  process.exit(0); // Ephemeral - exit after completion
});
```

### Phase 5: Worker Manager Implementation

**Goal**: Main Server spawns Docker containers with mounted storage.

#### Worker Manager

```typescript
// main-server/src/services/worker/workerManager.ts

export class WorkerManager {
  private docker: Docker;

  async spawn(options: SpawnOptions): Promise<WorkerConnection> {
    const { workspacePath, credentials, userRequest, sessionId } = options;

    // Create container with mounted workspace
    const container = await this.docker.createContainer({
      Image: 'ai-coding-worker:latest',
      HostConfig: {
        Binds: [`${workspacePath}:/workspace:rw`],
        AutoRemove: true
      },
      Env: [
        `SESSION_ID=${sessionId}`,
        `CREDENTIALS=${credentials}`,
        `USER_REQUEST=${JSON.stringify(userRequest)}`
      ]
    });

    await container.start();

    // Connect to container's SSE endpoint
    return this.connectToWorker(container, sessionId);
  }
}
```

**Note**: For Docker Swarm, we may need to use service-based spawning or a task queue pattern. This will need further investigation during implementation.

### Phase 6: Update Frontend

**Goal**: Update API calls to point to consolidated Main Server.

#### Changes Required

1. **Update `lib/api.ts`**
   - All endpoints now go to Main Server
   - Remove separate storage-worker proxy calls
   - Remove GitHub worker awareness

2. **Update SSE event handling**
   - No changes needed if event format preserved

3. **Add `/resume` support**
   - Call `/resume` when returning to in-progress session

---

## Migration Strategy

### Phase A: Parallel Operation

1. Deploy Main Server alongside existing workers
2. Add feature flag to switch between old/new architecture
3. Test new architecture with subset of users

### Phase B: Gradual Migration

1. Route new sessions to Main Server
2. Keep existing workers for in-progress sessions
3. Monitor for issues

### Phase C: Deprecation

1. Stop routing to old workers
2. Allow existing sessions to complete
3. Remove old worker deployments

---

## Files to Create/Modify

### New Files

| Path | Description |
|------|-------------|
| `/main-server/*` | Entire new project |
| `/main-server/src/services/storage/storageService.ts` | Consolidated from storage-worker |
| `/main-server/src/services/github/operations.ts` | Consolidated from github-worker |
| `/main-server/src/services/worker/workerManager.ts` | New worker spawning logic |
| `/main-server/src/routes/resume.ts` | New resume endpoint |

### Modified Files

| Path | Changes |
|------|---------|
| `/ai-coding-worker/src/server.ts` | Simplified - remove orchestration |
| `/ai-coding-worker/src/orchestrator.ts` | DELETE - move to Main Server |
| `/website/apps/client/src/lib/api.ts` | Update endpoints |
| `/CLAUDE.md` | Update architecture documentation |

### Deprecated (to remove after migration)

| Path | Reason |
|------|--------|
| `/github-worker/*` | Consolidated into Main Server |
| `/storage-worker/*` | Consolidated into Main Server |

---

## Risk Assessment

### High Risk

1. **Worker Spawning Complexity**: Docker container spawning with mounts in Swarm requires careful handling
   - Mitigation: Start with HTTP-based worker communication, add Docker spawning later

2. **Data Migration**: Existing sessions use different storage format
   - Mitigation: Keep backward compatibility for session format

### Medium Risk

1. **Performance**: Single Main Server vs distributed workers
   - Mitigation: Main Server handles orchestration only; heavy work still in workers

2. **Rollback Difficulty**: Once migrated, hard to go back
   - Mitigation: Feature flags for gradual rollout

### Low Risk

1. **Frontend Changes**: Minimal changes required
2. **Database Schema**: No changes required

---

## Success Criteria

1. New `/execute` endpoint works end-to-end
2. New `/resume` endpoint reconnects properly
3. AI Workers only handle LLM execution
4. No cross-session data exposure
5. Performance equal or better than current architecture
6. All existing features preserved

---

## Questions for User Approval

Before proceeding, please clarify the following:

### 1. Worker Spawning Method

Should we use:
- **Option A: HTTP-based communication** (simpler, current pattern) - AI Workers run as a pool, Main Server makes HTTP requests to them
- **Option B: Docker API spawning with mounted volumes** (more isolated) - Main Server creates new containers per-request with volume mounts
- **Option C: Both** - HTTP for now, Docker later

**Recommendation**: Option A first (simpler), then Option B if needed for stronger isolation.

### 2. Collaborative Session Worker

Should this also be consolidated into Main Server, or kept separate?

**Recommendation**: Keep separate for now - it's already persistent and has different concerns (WebSocket, CRDT).

### 3. Migration Timeline

- **Big bang**: Replace all at once
- **Gradual**: Feature flag-based rollout
- **Parallel**: Both architectures running simultaneously

**Recommendation**: Gradual with feature flags.

### 4. Storage Worker Handling

The current storage-worker is persistent. Should we:
- **Option A**: Keep it as a separate service (just not ephemeral)
- **Option B**: Fully consolidate into Main Server

**Recommendation**: Option B - consolidate fully to reduce service count.

---

## Estimated Effort

| Phase | Estimated Complexity | Notes |
|-------|---------------------|-------|
| Phase 1: Project Structure | Medium | Mostly copy/reorganize existing code |
| Phase 2: /execute Endpoint | High | Core orchestration logic rewrite |
| Phase 3: /resume Endpoint | Medium | New feature, relatively contained |
| Phase 4: Refactor AI Worker | Medium | Remove code, simplify |
| Phase 5: Worker Manager | High | Docker integration complexity |
| Phase 6: Update Frontend | Low | Minimal API changes |
| Migration | Medium | Coordination and testing |

**Total**: This is a significant refactor that touches most of the codebase. Recommend incremental implementation with testing at each phase.

---

## Next Steps

Upon approval:

1. Create `/main-server` project scaffold
2. Copy database layer from website
3. Implement storage service (from storage-worker)
4. Implement GitHub service (from github-worker)
5. Implement new `/execute` orchestration
6. Refactor AI Coding Worker
7. Implement `/resume` endpoint
8. Update frontend
9. Test end-to-end
10. Deploy with feature flag
11. Gradual migration
12. Deprecate old workers
