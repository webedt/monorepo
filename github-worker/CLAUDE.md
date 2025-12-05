# GitHub Worker

Ephemeral worker service for GitHub/Git operations with SSE streaming.

## Overview

The GitHub Worker handles all Git operations for the monorepo's session-based workflow:
- Cloning/pulling repositories into sessions
- Creating branches with LLM-generated names
- Committing changes with LLM-generated messages
- Pushing to remote

## Architecture

This worker follows the **ephemeral worker model**:
- Each job runs in isolation
- Worker exits after completing each job (`process.exit(0)`)
- Docker Swarm automatically restarts workers after exit
- Returns 429 when busy (load balancer retries with another worker)

## API Endpoints

### POST /clone-repository
Clone a GitHub repository into a session.

```json
{
  "sessionId": "abc123",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "accessToken": "ghp_xxx"
}
```

### POST /init-session
Combined operation: clone repository AND create branch with LLM-generated name in a single call. This avoids 429 busy responses that can occur when calling `/clone-repository` and `/create-branch` sequentially.

```json
{
  "sessionId": "abc123",
  "repoUrl": "https://github.com/owner/repo",
  "branch": "main",
  "userRequest": "Add dark mode toggle",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx"
}
```

Response (via SSE completed event):
```json
{
  "clonedPath": "repo",
  "branch": "main",
  "wasCloned": true,
  "branchName": "webedt/add-dark-mode-abc12345",
  "sessionTitle": "Add Dark Mode Toggle",
  "sessionPath": "owner__repo__webedt-add-dark-mode-abc12345"
}
```

### POST /create-branch
Create a new branch with LLM-generated name.

```json
{
  "sessionId": "abc123",
  "userRequest": "Add dark mode toggle",
  "baseBranch": "main",
  "repoUrl": "https://github.com/owner/repo",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx"
}
```

### POST /commit-and-push
Commit changes with LLM-generated message and push.

```json
{
  "sessionId": "abc123",
  "claudeCredentials": "...",
  "githubAccessToken": "ghp_xxx",
  "userId": "user123"
}
```

### POST /create-pull-request
Create a pull request on GitHub.

```json
{
  "owner": "webedt",
  "repo": "monorepo",
  "title": "Add dark mode feature",
  "head": "feature/dark-mode",
  "base": "main",
  "body": "This PR adds dark mode support",
  "githubAccessToken": "ghp_xxx"
}
```

Response (via SSE completed event):
```json
{
  "number": 123,
  "title": "Add dark mode feature",
  "state": "open",
  "htmlUrl": "https://github.com/webedt/monorepo/pull/123",
  "head": { "ref": "feature/dark-mode", "sha": "abc123" },
  "base": { "ref": "main", "sha": "def456" },
  "mergeable": null,
  "merged": false
}
```

### POST /merge-pull-request
Merge an existing pull request.

```json
{
  "owner": "webedt",
  "repo": "monorepo",
  "pullNumber": 123,
  "mergeMethod": "merge",
  "commitTitle": "Merge PR #123",
  "commitMessage": "Merges the dark mode feature",
  "githubAccessToken": "ghp_xxx"
}
```

Response (via SSE completed event):
```json
{
  "merged": true,
  "sha": "abc123",
  "message": "Pull Request successfully merged"
}
```

### POST /auto-pull-request
Complete auto-merge workflow: create PR (or find existing), merge base into feature branch, wait for mergeable status, merge PR, and delete the feature branch.

```json
{
  "owner": "webedt",
  "repo": "monorepo",
  "branch": "feature/dark-mode",
  "base": "main",
  "title": "Add dark mode feature",
  "body": "This PR adds dark mode support",
  "githubAccessToken": "ghp_xxx"
}
```

Response (via SSE completed event):
```json
{
  "step": "completed",
  "progress": "Auto PR completed successfully!",
  "pr": { "number": 123, "htmlUrl": "https://github.com/webedt/monorepo/pull/123" },
  "mergeBase": { "sha": "abc123", "message": "Merged main into feature/dark-mode" },
  "mergePr": { "merged": true, "sha": "def456" }
}
```

### GET /health
Health check endpoint.

### GET /status
Worker status (idle/busy).

## SSE Event Format

All operation endpoints use SSE (Server-Sent Events) for real-time progress updates. Every event includes a `source` field to identify the origin:

```
data: {"type": "progress", "stage": "cloning", "message": "Cloning repository...", "source": "github-worker", "timestamp": "..."}
data: {"type": "progress", "stage": "uploading", "message": "Uploading to storage...", "source": "github-worker", "timestamp": "..."}
data: {"type": "completed", "data": {...}, "source": "github-worker", "timestamp": "..."}
```

Error events:
```
data: {"type": "error", "error": "Error message", "code": "error_code", "source": "github-worker", "timestamp": "..."}
```

### Event Types

| Type | Fields | Description |
|------|--------|-------------|
| `progress` | `stage`, `message`, `source`, `timestamp` | Operation progress |
| `completed` | `data`, `source`, `timestamp` | Operation completed successfully |
| `error` | `error`, `code`, `source`, `timestamp` | Operation failed |

### Progress Stages by Operation

**Clone Repository:**
- `downloading_session` - Checking for existing session
- `session_found` / `new_session` - Session status
- `cloning` - Cloning repository
- `cloned` - Clone complete
- `uploading` - Uploading to storage

**Init Session (clone + create branch):**
- `preparing` - Preparing credentials
- `checking_session` - Checking for existing session
- `session_found` / `new_session` - Session status
- `cloning` - Cloning repository
- `cloned` - Clone complete
- `generating_name` - LLM generating session title and branch name
- `name_generated` - Name generated
- `creating_branch` - Creating git branch
- `pushing` - Pushing to remote
- `uploading` - Uploading to storage

**Create Branch:**
- `preparing` - Preparing credentials
- `downloading_session` - Downloading session
- `generating_name` - LLM generating branch name
- `name_generated` - Name generated
- `creating_branch` - Creating git branch
- `pushing` - Pushing to remote
- `uploading` - Uploading to storage

**Commit and Push:**
- `preparing` - Preparing credentials
- `downloading_session` - Downloading session
- `analyzing` - Analyzing changes
- `changes_detected` - Changes found
- `generating_message` - LLM generating commit message
- `committing` - Creating commit
- `pushing` - Pushing to remote
- `uploading` - Uploading to storage

**Create Pull Request:**
- `creating_pr` - Creating pull request

**Merge Pull Request:**
- `merging_pr` - Merging pull request

**Auto Pull Request:**
- `started` - Starting auto PR process
- `checking_pr` - Checking for existing PR
- `pr_found` / `creating_pr` - Found existing or creating new PR
- `pr_created` - PR created
- `merging_base` - Merging base into feature branch
- `base_merged` / `base_already_up_to_date` - Base merge result
- `waiting_mergeable` - Waiting for PR to become mergeable
- `polling` - Polling GitHub for mergeable status
- `pr_mergeable` - PR is ready to merge
- `merging_pr` - Merging the PR
- `pr_merged` - PR successfully merged
- `deleting_branch` - Deleting feature branch
- `branch_deleted` / `branch_already_deleted` - Branch deletion result

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5002` | Server port |
| `TMP_DIR` | `/tmp` | Temporary directory for workspaces |
| `STORAGE_WORKER_URL` | (internal) | URL to storage worker service |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

## Docker

```bash
# Build image
docker build -t github-worker:latest .

# Run container
docker run -p 5002:5002 github-worker:latest
```

## Swarm Deployment

```bash
# Deploy stack
docker stack deploy -c swarm.yml github-worker

# Scale workers
docker service scale github-worker_github-worker=10

# View logs
docker service logs github-worker_github-worker -f
```

## Directory Structure

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
    │   ├── cloneRepository.ts # Clone/pull repository
    │   ├── initSession.ts     # Combined clone + create branch
    │   ├── createBranch.ts    # Create branch with LLM naming
    │   ├── commitAndPush.ts   # Commit and push changes
    │   └── pullRequest.ts     # PR operations (create, merge, auto-PR)
    ├── clients/
    │   └── githubClient.ts    # Git clone/pull operations
    ├── utils/
    │   ├── gitHelper.ts       # Git operations (branch, commit, push)
    │   ├── llmHelper.ts       # LLM-based naming generation
    │   ├── credentialManager.ts # Claude credential management
    │   └── logger.ts          # Logging utility
    └── storage/
        └── storageClient.ts   # Storage worker client
```

## Security Considerations

1. **Ephemeral isolation** - Each job runs in a fresh environment
2. **No cross-session data** - Sessions are downloaded fresh for each operation
3. **Token handling** - GitHub tokens only used in-memory, not persisted
4. **Credential cleanup** - Claude credentials cleaned up after each operation

## Integration with Other Services

### Website Server
Calls GitHub Worker for:
- Create pull request (`POST /create-pull-request`)
- Merge pull request (`POST /merge-pull-request`)
- Auto-PR workflow (`POST /auto-pull-request`)

### AI Coding Worker
Calls GitHub Worker for:
- Initialize new sessions (`POST /init-session`) - combines clone + branch creation
- Initial repository clone (`POST /clone-repository`) - fallback for resumed sessions
- Auto-commit after AI execution (`POST /commit-and-push`)

### Collaborative Session Worker
Calls GitHub Worker for:
- Scheduled auto-commit (`POST /commit-and-push`)
