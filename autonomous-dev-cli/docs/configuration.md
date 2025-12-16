# Configuration Guide

This document provides detailed information about configuring the Autonomous Dev CLI.

## Configuration Sources

The CLI loads configuration from three sources (in order of priority):

1. **Environment variables** (highest priority)
2. **Configuration file** (JSON)
3. **Default values** (lowest priority)

Values from higher priority sources override values from lower priority sources.

## Configuration File Locations

The CLI searches for configuration files in this order:

1. Path specified with `-c` or `--config` command line option
2. `./autonomous-dev.config.json`
3. `./autonomous-dev.json`
4. `./.autonomous-dev.json`

The first file found is used. If no file is found, the CLI uses environment variables and defaults.

## Complete Configuration Schema

```json
{
  "repo": {
    "owner": "string (required)",
    "name": "string (required)",
    "baseBranch": "string (default: 'main')"
  },
  "discovery": {
    "tasksPerCycle": "number 1-10 (default: 5)",
    "maxOpenIssues": "number >= 1 (default: 10)",
    "excludePaths": "string[] (default: ['node_modules', 'dist', '.git', 'coverage', '*.lock'])",
    "issueLabel": "string (default: 'autonomous-dev')"
  },
  "execution": {
    "parallelWorkers": "number 1-10 (default: 4)",
    "timeoutMinutes": "number 5-120 (default: 30)",
    "workDir": "string (default: '/tmp/autonomous-dev')"
  },
  "evaluation": {
    "requireBuild": "boolean (default: true)",
    "requireTests": "boolean (default: true)",
    "requireHealthCheck": "boolean (default: true)",
    "requireSmokeTests": "boolean (default: false)",
    "healthCheckUrls": "string[] (default: [])",
    "smokeTestUrls": "string[] (default: [])",
    "previewUrlPattern": "string (default: 'https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/')"
  },
  "merge": {
    "autoMerge": "boolean (default: true)",
    "requireAllChecks": "boolean (default: true)",
    "maxRetries": "number 1-5 (default: 3)",
    "conflictStrategy": "'rebase' | 'merge' | 'manual' (default: 'rebase')",
    "mergeMethod": "'merge' | 'squash' | 'rebase' (default: 'squash')"
  },
  "daemon": {
    "loopIntervalMs": "number >= 0 (default: 60000)",
    "pauseBetweenCycles": "boolean (default: true)"
  },
  "credentials": {
    "githubToken": "string (optional)",
    "claudeAuth": {
      "accessToken": "string (required if claudeAuth is set)",
      "refreshToken": "string (required if claudeAuth is set)",
      "expiresAt": "number (optional)"
    },
    "databaseUrl": "string (optional)",
    "userEmail": "string email format (optional)"
  }
}
```

## Environment Variable Mapping

| Config Path | Environment Variable | Notes |
|-------------|---------------------|-------|
| `repo.owner` | `REPO_OWNER` | Required |
| `repo.name` | `REPO_NAME` | Required |
| `repo.baseBranch` | `REPO_BASE_BRANCH` | Default: `main` |
| `discovery.tasksPerCycle` | `TASKS_PER_CYCLE` | Range: 1-10 |
| `discovery.maxOpenIssues` | `MAX_OPEN_ISSUES` | Min: 1 |
| `discovery.excludePaths` | `EXCLUDE_PATHS` | Comma-separated |
| `discovery.issueLabel` | `ISSUE_LABEL` | - |
| `execution.parallelWorkers` | `PARALLEL_WORKERS` | Range: 1-10 |
| `execution.timeoutMinutes` | `TIMEOUT_MINUTES` | Range: 5-120 |
| `execution.workDir` | `WORK_DIR` | - |
| `evaluation.requireBuild` | `REQUIRE_BUILD` | `true`/`false` |
| `evaluation.requireTests` | `REQUIRE_TESTS` | `true`/`false` |
| `evaluation.requireHealthCheck` | `REQUIRE_HEALTH_CHECK` | `true`/`false` |
| `evaluation.requireSmokeTests` | `REQUIRE_SMOKE_TESTS` | `true`/`false` |
| `evaluation.healthCheckUrls` | `HEALTH_CHECK_URLS` | Comma-separated |
| `evaluation.smokeTestUrls` | `SMOKE_TEST_URLS` | Comma-separated |
| `evaluation.previewUrlPattern` | `PREVIEW_URL_PATTERN` | - |
| `merge.autoMerge` | `AUTO_MERGE` | `true`/`false` |
| `merge.requireAllChecks` | `REQUIRE_ALL_CHECKS` | `true`/`false` |
| `merge.maxRetries` | `MAX_RETRIES` | Range: 1-5 |
| `merge.conflictStrategy` | `CONFLICT_STRATEGY` | `rebase`/`merge`/`manual` |
| `merge.mergeMethod` | `MERGE_METHOD` | `merge`/`squash`/`rebase` |
| `daemon.loopIntervalMs` | `LOOP_INTERVAL_MS` | Min: 0 |
| `daemon.pauseBetweenCycles` | `PAUSE_BETWEEN_CYCLES` | `true`/`false` |
| `credentials.githubToken` | `GITHUB_TOKEN` | - |
| `credentials.claudeAuth.accessToken` | `CLAUDE_ACCESS_TOKEN` | - |
| `credentials.claudeAuth.refreshToken` | `CLAUDE_REFRESH_TOKEN` | - |
| `credentials.claudeAuth.expiresAt` | `CLAUDE_EXPIRES_AT` | Unix timestamp |
| `credentials.databaseUrl` | `DATABASE_URL` | - |
| `credentials.userEmail` | `USER_EMAIL` | Email format |

## Section Details

### Repository Settings (`repo`)

```json
{
  "repo": {
    "owner": "webedt",
    "name": "monorepo",
    "baseBranch": "main"
  }
}
```

- **owner**: The GitHub username or organization that owns the repository. This is the first part of a repository URL (e.g., `github.com/{owner}/{name}`).
- **name**: The repository name. This is the second part of a repository URL.
- **baseBranch**: The branch that pull requests will be created against. Usually `main` or `master`.

### Discovery Settings (`discovery`)

```json
{
  "discovery": {
    "tasksPerCycle": 5,
    "maxOpenIssues": 10,
    "excludePaths": ["node_modules", "dist", ".git"],
    "issueLabel": "autonomous-dev"
  }
}
```

- **tasksPerCycle**: How many tasks Claude should discover in each cycle. Higher values find more work but may overwhelm review capacity.
- **maxOpenIssues**: The maximum number of open issues with the autonomous-dev label before discovery pauses. This prevents creating too many issues that pile up.
- **excludePaths**: Files and directories to ignore during codebase analysis. Supports glob patterns.
- **issueLabel**: The GitHub label applied to all auto-created issues. Used to identify and track autonomous work.

### Execution Settings (`execution`)

```json
{
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30,
    "workDir": "/tmp/autonomous-dev"
  }
}
```

- **parallelWorkers**: Number of issues to work on simultaneously. Higher values = faster throughput but more resource usage.
- **timeoutMinutes**: Maximum time allowed for a single task implementation. Prevents hanging on complex or problematic tasks.
- **workDir**: Directory where repositories are cloned for work. Should have sufficient disk space.

### Evaluation Settings (`evaluation`)

```json
{
  "evaluation": {
    "requireBuild": true,
    "requireTests": true,
    "requireHealthCheck": true,
    "requireSmokeTests": false,
    "healthCheckUrls": [],
    "smokeTestUrls": [],
    "previewUrlPattern": "https://preview.example.com/{owner}/{repo}/{branch}/"
  }
}
```

- **requireBuild**: If true, changes must pass `npm run build` before merging.
- **requireTests**: If true, changes must pass `npm test` before merging.
- **requireHealthCheck**: If true, health check URLs must return 200 OK.
- **requireSmokeTests**: If true, smoke test URLs must return 200 OK.
- **healthCheckUrls**: Specific URLs to check for health (e.g., `/api/health`).
- **smokeTestUrls**: URLs for smoke tests (e.g., homepage, critical features).
- **previewUrlPattern**: Template for preview deployment URLs. Placeholders: `{owner}`, `{repo}`, `{branch}`.

### Merge Settings (`merge`)

```json
{
  "merge": {
    "autoMerge": true,
    "requireAllChecks": true,
    "maxRetries": 3,
    "conflictStrategy": "rebase",
    "mergeMethod": "squash"
  }
}
```

- **autoMerge**: If true, PRs that pass all checks are automatically merged. If false, PRs require manual review.
- **requireAllChecks**: If true, all GitHub status checks must pass before merging.
- **maxRetries**: How many times to retry merging if conflicts occur.
- **conflictStrategy**: How to handle merge conflicts:
  - `rebase`: Automatically rebase on the base branch
  - `merge`: Create a merge commit
  - `manual`: Mark for manual review
- **mergeMethod**: Git merge strategy:
  - `squash`: Squash all commits into one (clean history)
  - `merge`: Create a merge commit (preserves individual commits)
  - `rebase`: Rebase commits onto base branch

### Daemon Settings (`daemon`)

```json
{
  "daemon": {
    "loopIntervalMs": 60000,
    "pauseBetweenCycles": true
  }
}
```

- **loopIntervalMs**: Time to wait between development cycles in milliseconds. 60000 = 1 minute.
- **pauseBetweenCycles**: If true, waits for the interval before starting the next cycle. If false, starts immediately.

### Credentials (`credentials`)

```json
{
  "credentials": {
    "githubToken": "ghp_xxxxxxxxxxxx",
    "claudeAuth": {
      "accessToken": "sk-ant-oat01-xxxxxxxxxxxx",
      "refreshToken": "sk-ant-ort01-xxxxxxxxxxxx",
      "expiresAt": 1234567890
    },
    "databaseUrl": "postgresql://user:pass@host:5432/db",
    "userEmail": "user@example.com"
  }
}
```

**Note**: It's recommended to use environment variables for credentials rather than storing them in config files.

- **githubToken**: GitHub personal access token with `repo` scope.
- **claudeAuth**: Claude API authentication credentials:
  - `accessToken`: The main API access token
  - `refreshToken`: Token for refreshing the access token
  - `expiresAt`: Unix timestamp when the access token expires
- **databaseUrl**: PostgreSQL connection string for credential storage (optional).
- **userEmail**: Email address to look up in the database for stored credentials.

## Validation

The CLI validates all configuration values on startup. If validation fails, you'll see detailed error messages with suggestions for fixing them.

Run `autonomous-dev config --validate` to check your configuration without starting the daemon.

Run `autonomous-dev help-config` to see detailed help for all configuration options.

---

*Documentation last updated: December 14, 2025*
