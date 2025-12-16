# Autonomous Dev CLI

A powerful CLI tool that runs as a continuous daemon to autonomously develop your codebase. It discovers tasks using AI analysis, creates GitHub issues, implements them in parallel via Claude Agent SDK, evaluates the results, and auto-merges successful changes.

> **New to Autonomous Dev?** Check out our [Quick Start Guide](./docs/quick-start.md) to get running in under 10 minutes!

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start (5 Steps)](#quick-start)
- [The Autonomous Cycle](#the-autonomous-cycle)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Configuration File](#configuration-file)
  - [Configuration Options Reference](#configuration-options-reference)
- [CLI Commands](#cli-commands)
  - [start](#autonomous-dev-start)
  - [run](#autonomous-dev-run)
  - [discover](#autonomous-dev-discover)
  - [status](#autonomous-dev-status)
  - [config](#autonomous-dev-config)
  - [init](#autonomous-dev-init)
  - [help-config](#autonomous-dev-help-config)
- [Database Setup](#database-setup)
- [Authentication Setup](#authentication-setup)
  - [GitHub Token](#github-token)
  - [Claude API](#claude-api)
- [How It Works](#how-it-works)
- [Example Configurations](#example-configurations)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Task Discovery**: Uses Claude AI to analyze your codebase and suggest improvements, bug fixes, and new features
- **GitHub Integration**: Automatically creates issues for discovered tasks, enabling manual task injection via GitHub
- **Parallel Execution**: Runs multiple workers simultaneously (configurable, default: 4)
- **Evaluation Pipeline**: Verifies build passes, tests pass, and health checks succeed before merging
- **Auto-Merge**: Automatically merges PRs when all checks pass
- **Conflict Resolution**: Handles merge conflicts with configurable strategies (rebase, merge, or manual)
- **Database Credential Storage**: Optionally stores and retrieves credentials from PostgreSQL

## Architecture Overview

The Autonomous Dev CLI orchestrates multiple components to provide end-to-end autonomous development:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          AUTONOMOUS DEV CLI                                      │
│                                                                                  │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐        │
│  │   Config Loader  │────▶│  Daemon Manager  │────▶│  Cycle Executor  │        │
│  │                  │     │                  │     │                  │        │
│  │  - JSON config   │     │  - Loop control  │     │  - Orchestrates  │        │
│  │  - Env vars      │     │  - Graceful stop │     │    all phases    │        │
│  │  - Validation    │     │  - Intervals     │     │                  │        │
│  └──────────────────┘     └──────────────────┘     └────────┬─────────┘        │
│                                                              │                  │
│                                                              ▼                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                           DEVELOPMENT CYCLE                               │  │
│  │                                                                          │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌───────────┐ │  │
│  │  │  DISCOVER   │───▶│   CREATE    │───▶│  IMPLEMENT  │───▶│  EVALUATE │ │  │
│  │  │             │    │   ISSUES    │    │  (Parallel) │    │           │ │  │
│  │  │ Claude AI   │    │  GitHub API │    │ Worker Pool │    │ Build/Test│ │  │
│  │  └─────────────┘    └─────────────┘    └─────────────┘    └─────┬─────┘ │  │
│  │                                                                  │       │  │
│  │                                         ┌────────────────────────┘       │  │
│  │                                         ▼                                │  │
│  │                                   ┌───────────┐                          │  │
│  │                                   │   MERGE   │                          │  │
│  │                                   │           │                          │  │
│  │                                   │ Auto-PR   │                          │  │
│  │                                   │ Conflicts │                          │  │
│  │                                   └───────────┘                          │  │
│  │                                                                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
           ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
           │   GitHub     │    │   Claude     │    │  PostgreSQL  │
           │   API        │    │   Agent SDK  │    │  (Optional)  │
           │              │    │              │    │              │
           │ - Issues     │    │ - Analysis   │    │ - Credential │
           │ - PRs        │    │ - Discovery  │    │   storage    │
           │ - Branches   │    │ - Implement  │    │              │
           └──────────────┘    └──────────────┘    └──────────────┘
```

### Component Responsibilities

| Component | Description |
|-----------|-------------|
| **Config Loader** | Reads configuration from JSON files and environment variables, validates settings |
| **Daemon Manager** | Controls the continuous loop, handles signals for graceful shutdown |
| **Cycle Executor** | Orchestrates the 5-phase development cycle |
| **Discovery Module** | Uses Claude AI to analyze codebase and suggest improvements |
| **GitHub Client** | Manages issues, pull requests, branches via Octokit |
| **Worker Pool** | Executes multiple implementations in parallel |
| **Evaluation Engine** | Runs build, tests, and health checks |
| **Merge Handler** | Creates PRs, handles conflicts, auto-merges passing changes |

## Prerequisites

Before using autonomous-dev-cli, ensure you have:

- **Node.js** version 20.0.0 or higher
- **npm** (comes with Node.js)
- **Git** installed and configured
- **GitHub account** with a personal access token
- **Claude API credentials** (access token and refresh token)
- **PostgreSQL database** (optional, for credential storage)

## Installation

### From Source (Recommended)

```bash
# Clone the repository
git clone https://github.com/webedt/monorepo.git
cd monorepo/autonomous-dev-cli

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

### Direct Execution

You can run the CLI directly without global installation:

```bash
# Using npm scripts
npm run dev -- start

# Or using the built version
node dist/index.js start
```

## Quick Start

### 1. Initialize Configuration

Run the interactive setup wizard to create a configuration file:

```bash
autonomous-dev init
```

This will guide you through setting up your repository settings, discovery preferences, execution options, and more.

### 2. Set Up Environment Variables

Create a `.env` file in the `autonomous-dev-cli` directory:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Required: Database connection (for credential lookup)
DATABASE_URL=postgresql://user:password@localhost:5432/webedt

# Required: Your email for credential lookup
USER_EMAIL=your.email@example.com

# Required: Target repository
REPO_OWNER=your-username
REPO_NAME=your-repo

# Optional: Direct credential override (if not using database)
# GITHUB_TOKEN=ghp_xxxxxxxxxxxx
# CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
# CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
```

### 3. Validate Configuration

```bash
autonomous-dev config --validate
```

### 4. Test Task Discovery

```bash
autonomous-dev discover --dry-run
```

### 5. Start Autonomous Development

```bash
autonomous-dev start
```

## The Autonomous Cycle

The CLI runs a continuous 5-step development cycle:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  STEP 1: DISCOVER                                                       │
│  ─────────────────                                                      │
│  Claude AI analyzes your codebase to identify:                          │
│  • Bug fixes needed                                                     │
│  • New features to implement                                            │
│  • Code improvements and refactoring                                    │
│  • Documentation gaps                                                   │
│  • Test coverage improvements                                           │
│                                                                         │
│                              ▼                                          │
│                                                                         │
│  STEP 2: CREATE ISSUES                                                  │
│  ─────────────────────                                                  │
│  For each discovered task:                                              │
│  • Create a GitHub issue with detailed description                      │
│  • Add appropriate labels (priority, type, complexity)                  │
│  • Link affected file paths                                             │
│                                                                         │
│                              ▼                                          │
│                                                                         │
│  STEP 3: IMPLEMENT (Parallel)                                           │
│  ────────────────────────────                                           │
│  Multiple workers operate simultaneously:                               │
│  • Clone repo to isolated workspace                                     │
│  • Create branch: auto/{issue-number}-{slug}                            │
│  • Claude Agent implements the change                                   │
│  • Commit and push to remote                                            │
│                                                                         │
│                              ▼                                          │
│                                                                         │
│  STEP 4: EVALUATE                                                       │
│  ────────────────                                                       │
│  Verify each implementation:                                            │
│  • Run build (npm run build)                                            │
│  • Run tests (npm test)                                                 │
│  • Check health endpoints                                               │
│  • Run smoke tests (if configured)                                      │
│                                                                         │
│                              ▼                                          │
│                                                                         │
│  STEP 5: MERGE                                                          │
│  ─────────────                                                          │
│  For passing implementations:                                           │
│  • Create pull request                                                  │
│  • Wait for CI checks                                                   │
│  • Handle merge conflicts                                               │
│  • Auto-merge (squash by default)                                       │
│  • Close the associated issue                                           │
│                                                                         │
│                              ▼                                          │
│                                                                         │
│  ↩ REPEAT                                                              │
│  Wait for configured interval, then start again                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

This cycle continues indefinitely (when using `start`) or runs once (when using `run`).

## Configuration

Autonomous-dev-cli can be configured through three methods (in order of priority):

1. **Environment variables** (highest priority)
2. **Configuration file** (`autonomous-dev.config.json`)
3. **Default values** (lowest priority)

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Optional | - | PostgreSQL connection string for credential storage |
| `USER_EMAIL` | Optional | - | Email address for database credential lookup |
| `GITHUB_TOKEN` | Yes* | - | GitHub personal access token with `repo` scope |
| `CLAUDE_ACCESS_TOKEN` | Yes* | - | Claude API access token |
| `CLAUDE_REFRESH_TOKEN` | Optional | - | Claude API refresh token |
| `REPO_OWNER` | Yes | - | GitHub repository owner (username or organization) |
| `REPO_NAME` | Yes | - | GitHub repository name |
| `REPO_BASE_BRANCH` | No | `main` | Base branch for pull requests |
| `PARALLEL_WORKERS` | No | `4` | Number of parallel workers (1-10) |
| `TASKS_PER_CYCLE` | No | `5` | Tasks to discover per cycle (1-10) |
| `MAX_OPEN_ISSUES` | No | `10` | Maximum open issues before pausing discovery |
| `WORK_DIR` | No | `/tmp/autonomous-dev` | Working directory for task execution |
| `TIMEOUT_MINUTES` | No | `30` | Task timeout in minutes (5-120) |
| `REQUIRE_BUILD` | No | `true` | Require build to pass before merging |
| `REQUIRE_TESTS` | No | `true` | Require tests to pass before merging |
| `REQUIRE_HEALTH_CHECK` | No | `true` | Require health checks to pass |
| `AUTO_MERGE` | No | `true` | Automatically merge passing PRs |
| `MERGE_METHOD` | No | `squash` | Git merge method: `merge`, `squash`, or `rebase` |
| `CONFLICT_STRATEGY` | No | `rebase` | Conflict handling: `rebase`, `merge`, or `manual` |
| `LOOP_INTERVAL_MS` | No | `60000` | Interval between daemon cycles (milliseconds) |
| `PREVIEW_URL_PATTERN` | No | See below | URL pattern for preview deployments |

*Required unless using database credential storage

### Configuration File

Create `autonomous-dev.config.json` in your working directory:

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo",
    "baseBranch": "main"
  },
  "discovery": {
    "tasksPerCycle": 5,
    "maxOpenIssues": 10,
    "excludePaths": [
      "node_modules",
      "dist",
      ".git",
      "coverage",
      "*.lock"
    ],
    "issueLabel": "autonomous-dev"
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30,
    "workDir": "/tmp/autonomous-dev"
  },
  "evaluation": {
    "requireBuild": true,
    "requireTests": true,
    "requireHealthCheck": true,
    "requireSmokeTests": false,
    "healthCheckUrls": [],
    "smokeTestUrls": [],
    "previewUrlPattern": "https://your-preview-domain.com/{owner}/{repo}/{branch}/"
  },
  "merge": {
    "autoMerge": true,
    "requireAllChecks": true,
    "maxRetries": 3,
    "conflictStrategy": "rebase",
    "mergeMethod": "squash"
  },
  "daemon": {
    "loopIntervalMs": 60000,
    "pauseBetweenCycles": true
  }
}
```

The CLI searches for config files in this order:
1. Path specified with `-c/--config` option
2. `./autonomous-dev.config.json`
3. `./autonomous-dev.json`
4. `./.autonomous-dev.json`

### Configuration Options Reference

#### Repository Settings (`repo`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `owner` | string | *required* | GitHub username or organization that owns the repository |
| `name` | string | *required* | Repository name |
| `baseBranch` | string | `main` | Base branch for pull requests |

#### Discovery Settings (`discovery`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tasksPerCycle` | number | `5` | Number of tasks to discover per cycle (1-10) |
| `maxOpenIssues` | number | `10` | Maximum open issues before pausing discovery |
| `excludePaths` | string[] | See below | File paths/patterns to exclude from analysis |
| `issueLabel` | string | `autonomous-dev` | Label applied to auto-created GitHub issues |

Default `excludePaths`:
```json
["node_modules", "dist", ".git", "coverage", "*.lock"]
```

#### Execution Settings (`execution`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `parallelWorkers` | number | `4` | Number of parallel workers (1-10) |
| `timeoutMinutes` | number | `30` | Task timeout in minutes (5-120) |
| `workDir` | string | `/tmp/autonomous-dev` | Working directory for task execution |

#### Evaluation Settings (`evaluation`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requireBuild` | boolean | `true` | Require build to pass before merging |
| `requireTests` | boolean | `true` | Require tests to pass before merging |
| `requireHealthCheck` | boolean | `true` | Require health checks to pass |
| `requireSmokeTests` | boolean | `false` | Require smoke tests to pass |
| `healthCheckUrls` | string[] | `[]` | URLs to check for health |
| `smokeTestUrls` | string[] | `[]` | URLs for smoke tests |
| `previewUrlPattern` | string | See below | URL pattern for preview deployments |

The `previewUrlPattern` supports placeholders:
- `{owner}` - Repository owner
- `{repo}` - Repository name
- `{branch}` - Branch name

Default: `https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/`

#### Merge Settings (`merge`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoMerge` | boolean | `true` | Automatically merge PRs that pass all checks |
| `requireAllChecks` | boolean | `true` | Require all status checks to pass |
| `maxRetries` | number | `3` | Maximum merge retry attempts (1-5) |
| `conflictStrategy` | string | `rebase` | Strategy: `rebase`, `merge`, or `manual` |
| `mergeMethod` | string | `squash` | Git merge method: `merge`, `squash`, or `rebase` |

#### Daemon Settings (`daemon`)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `loopIntervalMs` | number | `60000` | Interval between cycles in milliseconds |
| `pauseBetweenCycles` | boolean | `true` | Pause between development cycles |

## CLI Commands

### `autonomous-dev start`

Start the continuous daemon that runs development cycles indefinitely.

```bash
autonomous-dev start [options]

Options:
  -c, --config <path>  Path to configuration file
  -v, --verbose        Enable verbose logging
  --dry-run            Discover tasks but don't execute
```

**Example:**
```bash
# Start daemon with default config
autonomous-dev start

# Start with verbose logging
autonomous-dev start --verbose

# Start in dry-run mode (preview only)
autonomous-dev start --dry-run

# Start with custom config file
autonomous-dev start -c ./production.config.json
```

**Signals:**
- `SIGINT` (Ctrl+C): Graceful shutdown after current cycle
- `SIGTERM`: Graceful shutdown after current cycle

### `autonomous-dev run`

Run a single development cycle and exit.

```bash
autonomous-dev run [options]

Options:
  -c, --config <path>  Path to configuration file
  -v, --verbose        Enable verbose logging
  --dry-run            Discover tasks but don't execute
```

**Example:**
```bash
# Run single cycle
autonomous-dev run

# Run single cycle in dry-run mode
autonomous-dev run --dry-run
```

**Use Cases:**
- Scheduled runs via cron: `0 */4 * * * autonomous-dev run`
- CI/CD integration for nightly improvements
- Manual triggering for controlled development

### `autonomous-dev discover`

Discover development tasks without executing them.

```bash
autonomous-dev discover [options]

Options:
  -c, --config <path>   Path to configuration file
  -v, --verbose         Enable verbose logging
  -n, --count <number>  Number of tasks to discover (default: 5)
  --create-issues       Create GitHub issues for discovered tasks
```

**Example:**
```bash
# Discover 5 tasks (default)
autonomous-dev discover

# Discover 10 tasks
autonomous-dev discover -n 10

# Discover and create GitHub issues
autonomous-dev discover --create-issues

# Discover with verbose output
autonomous-dev discover -v --count 3
```

**Task Categories:**
- `bug-fix` - Bug fixes and error corrections
- `feature` - New feature implementations
- `enhancement` - Improvements to existing features
- `refactor` - Code quality improvements
- `docs` - Documentation updates
- `test` - Test coverage improvements

### `autonomous-dev status`

Show current status of autonomous development.

```bash
autonomous-dev status [options]

Options:
  -c, --config <path>  Path to configuration file
```

**Example:**
```bash
autonomous-dev status
```

**Output includes:**
- Repository information
- Open issues count (total, in progress, pending)
- Active pull requests
- Merge status indicators

### `autonomous-dev config`

Show or validate configuration.

```bash
autonomous-dev config [options]

Options:
  -c, --config <path>  Path to configuration file
  --validate           Only validate configuration
```

**Example:**
```bash
# Show current configuration
autonomous-dev config

# Validate configuration
autonomous-dev config --validate

# Show config from specific file
autonomous-dev config -c ./custom.json
```

### `autonomous-dev init`

Initialize a new configuration file interactively.

```bash
autonomous-dev init [options]

Options:
  --force            Overwrite existing configuration file
  -o, --output <path>  Output path for config file
```

**Example:**
```bash
# Create new config file interactively
autonomous-dev init

# Overwrite existing config
autonomous-dev init --force

# Create config at custom path
autonomous-dev init -o ./configs/production.json
```

### `autonomous-dev help-config`

Show detailed help for configuration options.

```bash
autonomous-dev help-config
```

## Database Setup

Autonomous-dev-cli can optionally use a PostgreSQL database to store and retrieve credentials. This is useful when you want to share credentials across multiple services or manage them centrally.

### Required Tables

The CLI expects a `users` table with the following relevant columns:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  github_access_token TEXT,
  claude_auth JSONB
);
```

The `claude_auth` JSON object should have:
```json
{
  "accessToken": "sk-ant-oat01-...",
  "refreshToken": "sk-ant-ort01-...",
  "expiresAt": 1234567890
}
```

### Connection Configuration

Set the `DATABASE_URL` environment variable:

```bash
DATABASE_URL=postgresql://username:password@hostname:5432/database_name
```

For SSL connections:
```bash
DATABASE_URL=postgresql://username:password@hostname:5432/database_name?sslmode=require
```

### Credential Lookup

When `DATABASE_URL` and `USER_EMAIL` are configured, the CLI will:
1. Connect to the database on startup
2. Look up the user by email address
3. Retrieve `github_access_token` and `claude_auth` credentials
4. Use these for GitHub API and Claude API calls

If credentials are also set via environment variables, environment variables take precedence.

## Authentication Setup

### GitHub Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select the following scopes:
   - `repo` (Full control of private repositories)
   - `workflow` (if you want to trigger GitHub Actions)
4. Generate and copy the token
5. Set it as an environment variable:
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```

### Claude API

The CLI uses the Claude Agent SDK, which requires OAuth-style authentication.

#### Option 1: Direct Environment Variables

```bash
export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
export CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
```

#### Option 2: Database Storage

Store credentials in your database's `users` table:

```sql
UPDATE users SET claude_auth = '{
  "accessToken": "sk-ant-oat01-xxxxxxxxxxxx",
  "refreshToken": "sk-ant-ort01-xxxxxxxxxxxx",
  "expiresAt": 1234567890
}'::jsonb WHERE email = 'your.email@example.com';
```

Then configure the database connection:
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/webedt
USER_EMAIL=your.email@example.com
```

## How It Works

### Development Cycle

Each cycle performs the following steps:

```
1. DISCOVER
   ├── Fetch existing open issues with 'autonomous-dev' label
   ├── Analyze codebase with Claude AI
   ├── Generate task suggestions (bug fixes, features, improvements)
   └── Create GitHub issues for new tasks

2. EXECUTE (Parallel)
   ├── Clone repository to temporary directory
   ├── Create branch: auto/{issue-number}-{slug}
   ├── Run Claude Agent SDK to implement task
   ├── Commit changes and push branch
   └── Report completion status

3. EVALUATE
   ├── Run build verification (npm run build)
   ├── Run tests (npm test)
   ├── Check health endpoints
   └── Run smoke tests (if configured)

4. MERGE (Sequential)
   ├── Create pull request
   ├── Wait for CI checks to pass
   ├── Handle conflicts (rebase if necessary)
   ├── Merge PR (squash by default)
   └── Close associated issue

5. REPEAT
   └── Wait for configured interval, then start again
```

### Branch Naming

Branches follow the pattern: `auto/{issue-number}-{slug}`

Example: `auto/42-add-loading-states`

### Issue Labels

The CLI uses these labels to track state:
- `autonomous-dev` - All auto-created issues
- `in-progress` - Currently being worked on
- `needs-review` - Failed and needs manual review
- `priority:high/medium/low` - Priority level
- `type:feature/bugfix/refactor/docs/test/chore` - Task type
- `complexity:low/medium/high` - Estimated complexity

### Adding Manual Tasks

You can add tasks manually by creating GitHub issues with the `autonomous-dev` label (or your configured label). The daemon will pick them up and implement them automatically.

Priority for task selection:
1. User-created issues with `autonomous-dev` label
2. Auto-discovered issues

## Example Configurations

### Minimal Configuration

For quick setup with defaults:

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo"
  }
}
```

### Conservative Configuration

For careful, reviewed changes:

```json
{
  "repo": {
    "owner": "your-org",
    "name": "production-app",
    "baseBranch": "develop"
  },
  "discovery": {
    "tasksPerCycle": 2,
    "maxOpenIssues": 5
  },
  "execution": {
    "parallelWorkers": 2,
    "timeoutMinutes": 45
  },
  "merge": {
    "autoMerge": false,
    "mergeMethod": "merge"
  }
}
```

### Aggressive Configuration

For rapid development:

```json
{
  "repo": {
    "owner": "your-username",
    "name": "side-project"
  },
  "discovery": {
    "tasksPerCycle": 10,
    "maxOpenIssues": 20
  },
  "execution": {
    "parallelWorkers": 8,
    "timeoutMinutes": 60
  },
  "evaluation": {
    "requireBuild": true,
    "requireTests": false,
    "requireHealthCheck": false
  },
  "merge": {
    "autoMerge": true,
    "mergeMethod": "squash"
  },
  "daemon": {
    "loopIntervalMs": 30000
  }
}
```

### Monorepo Configuration

For monorepo projects:

```json
{
  "repo": {
    "owner": "your-org",
    "name": "monorepo"
  },
  "discovery": {
    "tasksPerCycle": 5,
    "excludePaths": [
      "node_modules",
      "dist",
      ".git",
      "coverage",
      "*.lock",
      "packages/legacy/**"
    ]
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 45
  },
  "evaluation": {
    "previewUrlPattern": "https://preview.your-domain.com/{owner}/{repo}/{branch}/"
  }
}
```

## Troubleshooting

### "GitHub token not configured"

**Cause:** The CLI cannot find a valid GitHub token.

**Solutions:**
1. Set the `GITHUB_TOKEN` environment variable:
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```
2. Or ensure database has a valid `github_access_token` for your user email
3. Verify the token has `repo` scope

### "Claude auth not configured"

**Cause:** The CLI cannot find valid Claude API credentials.

**Solutions:**
1. Set environment variables:
   ```bash
   export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
   export CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
   ```
2. Or ensure database has valid `claude_auth` JSON for your user email
3. Verify the tokens are not expired

### "User not found in database"

**Cause:** The `USER_EMAIL` doesn't match any user in the database.

**Solutions:**
1. Verify the email address is correct
2. Check the database connection is working
3. Ensure the user exists in the `users` table

### "Configuration validation failed"

**Cause:** Invalid values in config file or environment variables.

**Solutions:**
1. Run `autonomous-dev config` to see current configuration
2. Run `autonomous-dev help-config` for valid options
3. Check that numeric values are within allowed ranges
4. Verify JSON syntax in config file

### Tasks not being discovered

**Possible causes:**
- Claude API credentials are invalid or expired
- Repository is empty or has minimal code
- All obvious improvements have been addressed

**Solutions:**
1. Run `autonomous-dev discover -v` for verbose output
2. Check Claude API credentials are valid
3. Try with `--count 10` to request more tasks
4. Review `excludePaths` to ensure important files aren't excluded

### PRs failing to merge

**Possible causes:**
- CI workflows are failing
- Branch protection rules prevent auto-merge
- Merge conflicts with other branches

**Solutions:**
1. Check CI workflow status on GitHub
2. Review branch protection rules
3. Try `conflictStrategy: "manual"` and merge manually
4. Increase `maxRetries` in merge settings

### Build or tests failing after implementation

**Cause:** Claude implementation introduced bugs.

**Solutions:**
1. Review the PR diff on GitHub
2. Add failing patterns to `excludePaths`
3. Improve task descriptions in issues
4. Reduce `parallelWorkers` to catch issues earlier

### Daemon stops unexpectedly

**Possible causes:**
- Unhandled exception
- Out of memory
- Network timeout

**Solutions:**
1. Run with `--verbose` for detailed logs
2. Check system resources
3. Increase `timeoutMinutes` for complex tasks
4. Use a process manager like PM2 for automatic restarts

## Documentation

Comprehensive documentation is available in the `docs/` directory:

| Document | Description |
|----------|-------------|
| [Quick Start Guide](./docs/quick-start.md) | Get running in under 10 minutes |
| [Configuration Guide](./docs/configuration.md) | Complete configuration reference |
| [GitHub Setup](./docs/github-setup.md) | Detailed GitHub token setup |
| [Claude Setup](./docs/claude-setup.md) | Claude API credential configuration |
| [Database Setup](./docs/database-setup.md) | PostgreSQL credential storage |
| [Security Best Practices](./docs/security.md) | Credential management and security |
| [Troubleshooting](./docs/troubleshooting.md) | Common issues and solutions |

### Example Configurations

See the `examples/` directory for ready-to-use configuration files:

- `minimal.config.json` - Simplest setup with defaults
- `conservative.config.json` - Safe, review-focused configuration
- `aggressive.config.json` - Fast, high-throughput configuration
- `monorepo.config.json` - Optimized for monorepo projects
- `ci-cd.config.json` - For scheduled CI/CD runs

## Development

### Local Development

```bash
# Run in development mode
npm run dev -- start -v

# Run single command
npm run dev -- discover -n 3
```

### Building

```bash
# Build TypeScript
npm run build

# Clean and rebuild
npm run clean && npm run build
```

### Testing

```bash
# Run tests
npm test
```

### Project Structure

```
autonomous-dev-cli/
├── src/
│   ├── index.ts           # CLI entry point
│   ├── daemon.ts          # Main daemon loop
│   ├── config/            # Configuration management
│   │   ├── index.ts       # Config loader
│   │   └── schema.ts      # Zod validation schema
│   ├── discovery/         # Task discovery with Claude
│   ├── github/            # GitHub API integration
│   │   ├── client.ts      # Octokit wrapper
│   │   ├── issues.ts      # Issue management
│   │   ├── branches.ts    # Branch management
│   │   └── pulls.ts       # PR management
│   ├── executor/          # Worker pool and execution
│   ├── evaluation/        # Build, test, health checks
│   ├── conflicts/         # Merge conflict resolution
│   ├── db/                # Database client
│   └── utils/             # Logging, errors, helpers
├── bin/
│   └── autonomous-dev.js  # CLI executable
├── package.json
├── tsconfig.json
├── .env.example
└── autonomous-dev.config.example.json
```

## Contributing

Contributions are welcome! Here's how you can help:

### Reporting Issues

- Check existing issues before creating a new one
- Provide clear reproduction steps
- Include relevant configuration and error logs

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes following the coding style
4. Run tests: `npm test`
5. Build the project: `npm run build`
6. Commit with clear messages (imperative mood, no prefixes)
7. Push and create a pull request

### Development Guidelines

- Follow TypeScript best practices
- Add tests for new features
- Update documentation for API changes
- Keep PRs focused on a single change

### Code Style

- Use TypeScript strict mode
- Prefer `async/await` over raw promises
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

## License

MIT License

Copyright (c) 2024 ETdoFresh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
