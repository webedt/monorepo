# Autonomous Dev CLI

A CLI tool that runs as a continuous daemon to autonomously develop your website. It discovers tasks, creates GitHub issues, implements them in parallel via Claude Agent SDK, evaluates the results, and auto-merges successful changes.

## Features

- **Task Discovery**: Uses Claude to analyze your codebase and suggest improvements
- **GitHub Issues Integration**: Creates issues for tasks, allowing manual task injection
- **Parallel Execution**: Runs multiple workers simultaneously (default: 4)
- **Evaluation Pipeline**: Verifies build, tests, and health checks pass
- **Auto-Merge**: Automatically merges PRs when all checks pass
- **Conflict Resolution**: Handles merge conflicts with configurable strategies

## Installation

```bash
# From the monorepo root
cd autonomous-dev-cli
npm install
npm run build

# Or run directly with tsx
npm run dev -- start
```

## Quick Start

### 1. Set up environment variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string (same as internal-api-server)
- `USER_EMAIL` - Your email for credential lookup (e.g., `etdofresh@gmail.com`)
- `REPO_OWNER` - GitHub repository owner
- `REPO_NAME` - GitHub repository name

### 2. Run the daemon

```bash
# Start continuous daemon
autonomous-dev start

# Or run a single cycle
autonomous-dev run

# Discover tasks without executing
autonomous-dev discover
```

## CLI Commands

### `autonomous-dev start`

Start the continuous daemon that:
1. Discovers new tasks
2. Creates GitHub issues
3. Implements tasks in parallel
4. Creates PRs
5. Evaluates and merges
6. Repeats

```bash
autonomous-dev start [options]

Options:
  -c, --config <path>  Path to config file
  -v, --verbose        Enable verbose logging
  --dry-run            Discover tasks but don't execute
```

### `autonomous-dev run`

Run a single development cycle and exit.

```bash
autonomous-dev run [options]
```

### `autonomous-dev discover`

Discover tasks without executing them.

```bash
autonomous-dev discover [options]

Options:
  -n, --count <number>  Number of tasks to discover (default: 5)
  --create-issues       Create GitHub issues for discovered tasks
```

### `autonomous-dev status`

Show current status of autonomous development.

```bash
autonomous-dev status
```

### `autonomous-dev config`

Show or validate configuration.

```bash
autonomous-dev config [options]

Options:
  --validate  Only validate, don't show
```

## Configuration

Configuration can be provided via:
1. Environment variables (`.env`)
2. Config file (`autonomous-dev.config.json`)
3. Command line options

### Environment Variables

```bash
# Database (for credential lookup)
DATABASE_URL=postgresql://user:password@localhost:5432/webedt
USER_EMAIL=etdofresh@gmail.com

# Target repository
REPO_OWNER=webedt
REPO_NAME=monorepo
REPO_BASE_BRANCH=main

# Execution settings
PARALLEL_WORKERS=4
TASKS_PER_CYCLE=5
WORK_DIR=/tmp/autonomous-dev
TIMEOUT_MINUTES=30

# Evaluation
REQUIRE_BUILD=true
REQUIRE_TESTS=true
REQUIRE_HEALTH_CHECK=true
PREVIEW_URL_PATTERN=https://github.etdofresh.com/{owner}/{repo}/{branch}/

# Merge settings
AUTO_MERGE=true
MERGE_METHOD=squash
CONFLICT_STRATEGY=rebase

# Daemon settings
LOOP_INTERVAL_MS=60000
```

### Config File

Create `autonomous-dev.config.json`:

```json
{
  "repo": {
    "owner": "webedt",
    "name": "monorepo",
    "baseBranch": "main"
  },
  "discovery": {
    "tasksPerCycle": 5,
    "maxOpenIssues": 10,
    "issueLabel": "autonomous-dev"
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30
  },
  "evaluation": {
    "requireBuild": true,
    "requireTests": true,
    "requireHealthCheck": true
  },
  "merge": {
    "autoMerge": true,
    "mergeMethod": "squash"
  }
}
```

## How It Works

### Development Cycle

```
1. DISCOVER
   ├── Fetch existing open issues
   ├── Analyze codebase with Claude
   ├── Generate 4-5 task suggestions
   └── Create GitHub issues

2. EXECUTE (Parallel)
   ├── Clone repo to temp directory
   ├── Create branch: auto/{issue-number}-{slug}
   ├── Run Claude Agent SDK
   ├── Commit and push changes
   └── Report completion

3. EVALUATE
   ├── Run build verification
   ├── Run tests
   └── Health check preview URL

4. MERGE (Sequential)
   ├── Create PR
   ├── Wait for CI checks
   ├── Handle conflicts (rebase)
   ├── Merge PR
   └── Close issue

5. REPEAT
```

### Branch Naming

Branches are named: `auto/{issue-number}-{slug}`

Example: `auto/42-add-loading-states`

### Issue Labels

- `autonomous-dev` - All auto-created issues
- `in-progress` - Currently being worked on
- `needs-review` - Failed and needs manual review
- `priority:high/medium/low` - Priority level
- `type:feature/bugfix/refactor/docs/test/chore` - Task type

## Adding Manual Tasks

You can add tasks manually by creating GitHub issues with the `autonomous-dev` label. The daemon will pick them up and implement them automatically.

Priority for task selection:
1. User-created issues with `autonomous-dev` label
2. Auto-discovered issues

## Architecture

```
autonomous-dev-cli/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── daemon.ts          # Main daemon loop
│   ├── config/            # Configuration management
│   ├── discovery/         # Task discovery with Claude
│   ├── github/            # GitHub API integration
│   ├── executor/          # Worker pool and execution
│   ├── evaluation/        # Build, test, health checks
│   ├── conflicts/         # Merge conflict resolution
│   └── db/               # Database client
```

## Troubleshooting

### "GitHub token not configured"

Ensure either:
- `GITHUB_TOKEN` is set in environment
- Database has valid `github_access_token` for your user email

### "Claude auth not configured"

Ensure either:
- `CLAUDE_ACCESS_TOKEN` and `CLAUDE_REFRESH_TOKEN` are set
- Database has valid `claude_auth` for your user email

### Tasks not being discovered

- Check Claude API credentials are valid
- Ensure the codebase has room for improvements
- Try running `autonomous-dev discover -v` for verbose output

### PRs failing to merge

- Check CI workflows are passing
- Review the evaluation pipeline output
- Check for merge conflicts with other branches

## Development

```bash
# Run in development mode
npm run dev -- start -v

# Build
npm run build

# Run tests
npm test
```

## License

MIT
