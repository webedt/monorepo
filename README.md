# WebEDT Platform

> A comprehensive web-based game development platform combining a digital storefront, game library, integrated development environment, and autonomous AI-powered development tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## Overview

WebEDT is a web-based game development platform that enables users to browse and purchase games, manage their library, and create games using an integrated development environment with AI assistance. This monorepo also includes an autonomous development system that uses AI to continuously analyze, improve, and evolve codebases.

### Platform Features

- **Dashboard** - Personalized aggregation hub separate from the Store
  - Customizable widget system with drag-and-drop arrangement
  - Widgets: Recently Played, Editor Quick Access, Store Highlights, Library Favorites, Community Activity, Session Activity
  - Layout saved per user, adapts based on player vs. editor preferences
- **Store** - Grid-based marketplace for browsing and purchasing games
  - Grid view layout with thumbnails, prices, Play Now/View Trailer buttons, wishlist option
  - Trailer auto-play on hover (Netflix/YouTube style)
  - Universal search across all fields, filter dropdowns for category/genre/price
  - Stripe and PayPal payment integration
  - Wishlist with sale notifications, ratings & reviews, creator analytics
- **Library** - Multi-view library visible only when logged in
  - Three view modes: Grid View, List View, Compact List View
  - Filtering: All items, Recently added, Recently played, Most used, Favorites, By collection, Wishlisted
  - Sorting: Title, Date Added, Last Played, Play Count (ascending/descending)
  - Quick Favorite icon, Custom Collections/Folders with full CRUD, Pagination controls
  - Cloud Services: Cloud saves synced across devices, Leaderboards API
- **Editor Suite** - Complete game development environment with AI assistance
  - Chat - AI-powered development assistant with verbosity modes
  - Code - VS Code-style editor with syntax highlighting, multi-file editing, Git diff
  - Images - Image editor with layers, sprite sheet editor, frame/bone animation editors
  - Sounds - Wave editor, SFXR-style SFX generator, multi-track mixer/DAW
  - Scenes - Object prefabs with component system, 2D/UI scene composition
  - Preview - Live preview of your current branch with hot reload

### Autonomous Development Features

- **AI-Powered Task Discovery** - Claude AI analyzes your codebase to identify improvements, bug fixes, and new features
- **Automated GitHub Integration** - Creates issues, branches, and pull requests automatically
- **Parallel Execution** - Multiple workers implement tasks simultaneously
- **Comprehensive Evaluation** - Build verification, test execution, and health checks
- **Auto-Merge** - Successful changes are automatically merged with conflict resolution
- **Multi-Provider Support** - Claude Agent SDK, Codex, and extensible provider architecture

### Use Cases

- **Game Development** - Create and publish games using the integrated editor
- **Continuous Code Improvement** - Let AI maintain and improve code quality
- **Automated Bug Fixing** - Identify and fix common issues automatically
- **Documentation Generation** - Auto-generate and update documentation
- **Test Coverage** - Identify and implement missing tests
- **Refactoring** - Continuous code quality improvements

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Git
- GitHub account with a personal access token
- Claude API credentials (OAuth tokens)
- PostgreSQL database (optional, for credential storage)

### Installation

```bash
# Clone the repository
git clone https://github.com/webedt/monorepo.git
cd monorepo

# Install and build the Autonomous Dev CLI
cd autonomous-dev-cli
npm install
npm run build

# Link globally (optional)
npm link
```

### Configuration

1. **Create environment file:**

```bash
cp .env.example .env
```

2. **Configure credentials in `.env`:**

```bash
# Required: Target repository
REPO_OWNER=your-username
REPO_NAME=your-repo

# Required: API credentials
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx

# Optional: Database for credential storage
DATABASE_URL=postgresql://user:password@localhost:5432/webedt
USER_EMAIL=your.email@example.com
```

3. **Initialize configuration:**

```bash
autonomous-dev init
```

4. **Validate setup:**

```bash
autonomous-dev config --validate
```

### Running

```bash
# Start the autonomous development daemon
autonomous-dev start

# Or run a single development cycle
autonomous-dev run

# Preview tasks without executing
autonomous-dev discover --dry-run
```

## Repository Structure

```
.
├── website/                           # React frontend with Dashboard, Store, Library, Editor
├── internal-api-server/               # Internal API Server for auth, storage, sessions
├── ai-coding-worker/                  # AI Coding Worker service for LLM execution
├── autonomous-dev-cli/                # Autonomous Development CLI
├── shared/                            # Shared utilities and types
├── examples/                          # Example configurations
├── docs/                              # Documentation hub
├── SPEC.md                            # Platform specification document
├── STATUS.md                          # Implementation status tracking
└── .github/
    └── workflows/                     # Centralized GitHub Actions workflows
        ├── website-deploy-dokploy.yml
        ├── website-cleanup-dokploy.yml
        └── ai-coding-worker-docker-build-push.yml
```

## Architecture

The autonomous development system follows a 5-phase workflow that continuously improves your codebase:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                           AUTONOMOUS DEVELOPMENT WORKFLOW                              │
│                                                                                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────┐ │
│  │  PHASE 1    │    │  PHASE 2    │    │  PHASE 3    │    │  PHASE 4    │    │  5  │ │
│  │  DISCOVERY  │───▶│  EXECUTION  │───▶│ EVALUATION  │───▶│ PR CREATION │───▶│MERGE│ │
│  │             │    │  (Parallel) │    │             │    │             │    │     │ │
│  │ Claude AI   │    │ Worker Pool │    │ Build/Test  │    │ GitHub API  │    │Auto │ │
│  │ Analyzes    │    │ Implements  │    │ Health Check│    │ Create PR   │    │Merge│ │
│  │ Codebase    │    │ Changes     │    │ Validation  │    │ CI Checks   │    │     │ │
│  └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────┘ │
│                                                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          COMPONENT ARCHITECTURE                                  │  │
│  │                                                                                  │  │
│  │   ┌──────────────────────────┐      ┌──────────────────────────┐               │  │
│  │   │    Autonomous Dev CLI    │      │    AI Coding Worker      │               │  │
│  │   │    ─────────────────     │      │    ────────────────      │               │  │
│  │   │  • Daemon Manager        │      │  • Claude Agent SDK      │               │  │
│  │   │  • Task Discovery        │◀────▶│  • Provider Factory      │               │  │
│  │   │  • GitHub Client         │      │  • Session Management    │               │  │
│  │   │  • Evaluation Engine     │      │  • SSE Streaming         │               │  │
│  │   │  • Conflict Resolution   │      │                          │               │  │
│  │   └──────────────────────────┘      └──────────────────────────┘               │  │
│  │              │                                  │                               │  │
│  │              └──────────────┬─────────────────┘                               │  │
│  │                             │                                                   │  │
│  │                             ▼                                                   │  │
│  │              ┌──────────────────────────┐                                      │  │
│  │              │   Internal API Server    │                                      │  │
│  │              │   ──────────────────     │                                      │  │
│  │              │  • API Routes            │                                      │  │
│  │              │  • Storage (MinIO)       │                                      │  │
│  │              │  • Database (PostgreSQL) │                                      │  │
│  │              │  • GitHub Operations     │                                      │  │
│  │              └──────────────────────────┘                                      │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  External Services:                                                                    │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐          │
│  │   GitHub API  │  │   Claude AI   │  │  PostgreSQL   │  │     MinIO     │          │
│  │  Issues/PRs   │  │   Analysis    │  │   Database    │  │   Storage     │          │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Phase Details

| Phase | Component | Description |
|-------|-----------|-------------|
| **Discovery** | Claude AI | Analyzes codebase to identify improvements, bugs, features, and documentation gaps |
| **Execution** | Worker Pool | Parallel workers clone repo, create branches, and implement changes using Claude Agent SDK |
| **Evaluation** | Evaluation Engine | Runs build verification, test suites, health checks, and smoke tests |
| **PR Creation** | GitHub Client | Creates pull requests, waits for CI checks, handles code review |
| **Merge** | Conflict Resolver | Auto-merges passing PRs with intelligent conflict resolution |

### Component Responsibilities

| Component | Path | Responsibility |
|-----------|------|----------------|
| **Autonomous Dev CLI** | `autonomous-dev-cli/` | Orchestrates the 5-phase workflow, manages daemon lifecycle, configuration |
| **AI Coding Worker** | `ai-coding-worker/` | Executes LLM requests, streams output via SSE, supports multiple providers |
| **Internal API Server** | `internal-api-server/` | Central backend for API routes, storage, database, GitHub operations |
| **Website** | `website/` | React frontend with Express API facade for user interaction |

## Projects

### 1. Website (WebEDT Frontend)

The **Website** is a React-based frontend that provides the complete WebEDT platform experience including the dashboard, store, library, and editor suite.

- **Path**: `website/`
- **Type**: React frontend (Vite) + Express API facade
- **Deployment**: Dokploy (self-hosted)

**Key Features:**
- **Dashboard**: Personalized aggregation hub with customizable widgets (Recently Played, Editor Quick Access, Store Highlights, Library Favorites, Community Activity, Session Activity)
- **Store**: Grid marketplace with trailer auto-play on hover, universal search, filtering, wishlists, ratings & reviews, and Stripe/PayPal integration
- **Library**: Three view modes (Grid, List, Compact) with filtering by recently added/played, favorites, collections; Quick Favorite and Custom Collections support
- **Editor Suite**: AI-powered development tools for Chat (with verbosity modes), Code (multi-file with Git diff), Images (layers, sprites, animations), Sounds (wave editor, SFX generator, DAW), Scenes (prefabs, 2D/UI)
- **Sessions**: Git-branch-based session management that persists indefinitely across all editor tools

**Workflows:**
- `website-deploy-dokploy.yml` - Deploys to Dokploy on non-main branch pushes
- `website-cleanup-dokploy.yml` - Cleans up Dokploy apps on branch deletion

### 2. Autonomous Dev CLI

The **Autonomous Development CLI** is a powerful command-line tool that runs as a continuous daemon to autonomously develop your codebase. It uses Claude AI to discover tasks, create GitHub issues, implement changes in parallel, evaluate results, and auto-merge successful changes.

- **Path**: `autonomous-dev-cli/`
- **Type**: Node.js/TypeScript CLI application
- **Documentation**: See [autonomous-dev-cli/README.md](./autonomous-dev-cli/README.md) for complete setup and usage guide

**Key Features:**
- Task Discovery: Claude AI analyzes your codebase and suggests improvements
- GitHub Integration: Auto-creates issues and pull requests
- Parallel Execution: Runs multiple workers simultaneously
- Evaluation Pipeline: Verifies builds, tests, and health checks
- Auto-Merge: Automatically merges PRs when all checks pass

**Quick Start:**
```bash
cd autonomous-dev-cli
npm install
npm run build
npm link  # optional

# Initialize configuration
autonomous-dev init

# Start autonomous development
autonomous-dev start
```

See the [Quick Start Guide](./autonomous-dev-cli/docs/quick-start.md) for detailed setup instructions.

### 3. AI Coding Worker
- **Path**: `ai-coding-worker/`
- **Type**: Node.js/TypeScript worker service
- **Deployment**: Docker Registry
- **Workflow**: `ai-coding-worker-docker-build-push.yml` - Builds and pushes Docker images on main branch
- **Purpose**: Provider-agnostic ephemeral worker for LLM execution with Docker Swarm orchestration

### 4. Internal API Server
- **Path**: `internal-api-server/`
- **Type**: Node.js/TypeScript backend service
- **Purpose**: Central backend handling API routes, database, storage, and GitHub operations

### 5. Shared
- **Path**: `shared/`
- **Type**: Shared utilities and TypeScript types
- **Purpose**: Common code shared across projects

## GitHub Actions Workflows

All GitHub Actions workflows are centralized in `.github/workflows/` at the repository root. Each workflow:

1. **Only runs when its project folder changes** using `paths` filters
2. **Runs independently** - changes to one project don't trigger other projects' workflows
3. **Preserves original functionality** - all features from the original separate repos are maintained

### How Path Filtering Works

Each workflow includes a `paths` filter like this:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - "project-name/**"
      - ".github/workflows/project-name-workflow.yml"
```

This ensures:
- ✅ Only changes in `project-name/` trigger the workflow
- ✅ Changes to the workflow file itself also trigger it
- ✅ Changes to other projects **do not** trigger this workflow
- ✅ No wasted CI/CD minutes

### Example Scenarios

**Scenario 1**: You modify `website/apps/web/page.tsx`
- ✅ `website-deploy-dokploy.yml` runs
- ❌ Worker Docker build workflows do NOT run

**Scenario 2**: You modify `ai-coding-worker/src/index.ts`
- ✅ `ai-coding-worker-docker-build-push.yml` runs
- ❌ Other workflows do NOT run

**Scenario 3**: You modify files in multiple projects
- ✅ Multiple workflows run in parallel (only for affected projects)

**Scenario 4**: You only modify `README.md` (this file)
- ❌ No workflows run (no project files changed)

## Development

Each project maintains its own:
- Dependencies (`package.json`, `pnpm-lock.yaml`, etc.)
- Configuration files
- Build processes
- Deployment requirements

Work on each project independently in its own directory. The monorepo structure is transparent to local development.

## CI/CD Details

### Website Deployment
- Uses Dokploy for deployment
- Creates separate apps per branch for preview environments
- Automatically cleans up apps when branches are deleted
- Configures environment variables and domains automatically

### Worker Services
- Build multi-platform Docker images (linux/amd64, linux/arm64)
- Push to private Docker registry
- Use layer caching for faster builds
- Tag images with branch name, SHA, and 'latest' for main branch

## Benefits of This Structure

1. **Independent CI/CD**: Each project only runs its workflows when it changes
2. **Cost Efficiency**: No wasted GitHub Actions minutes
3. **Simplified Management**: All code in one repository
4. **Atomic Changes**: Cross-project changes can be in a single PR
5. **Shared Resources**: Can share common configuration, scripts, or libraries if needed

## Documentation

For detailed documentation on each project, see the [docs/](./docs/) directory or the links below:

### Core Documentation

| Document | Description |
|----------|-------------|
| [Platform Specification](./SPEC.md) | Complete WebEDT platform specification and requirements |
| [Documentation Hub](./docs/README.md) | Central hub with quick links to all documentation |
| [Architecture Guide](./docs/architecture.md) | System design, component relationships, and the 5-phase daemon cycle |
| [Configuration Guide](./docs/configuration.md) | Complete reference for all configuration options |
| [API Reference](./docs/api-reference.md) | CLI commands, module APIs, and HTTP endpoints |
| [Troubleshooting Guide](./docs/troubleshooting.md) | Common issues, error messages, and solutions |

### Project Documentation

| Project | Documentation |
|---------|---------------|
| **Website** | [README](./website/README.md) - WebEDT frontend with Dashboard, Store, Library, and Editor |
| **Autonomous Dev CLI** | [README](./autonomous-dev-cli/README.md) \| [Quick Start](./autonomous-dev-cli/docs/quick-start.md) \| [Configuration](./autonomous-dev-cli/docs/configuration.md) |
| **AI Coding Worker** | [README](./ai-coding-worker/README.md) |
| **Internal API Server** | [README](./internal-api-server/README.md) |

### Documentation Hub

The [docs/](./docs/) directory provides a centralized documentation hub with quick links to all project documentation.

## Example Configurations

Example configuration files for the Autonomous Dev CLI are available in:
- `autonomous-dev-cli/examples/` - Various configuration presets
- `examples/` - Root-level example configs

## API Documentation

### Autonomous Dev CLI

The CLI provides these commands for controlling autonomous development:

| Command | Description |
|---------|-------------|
| `autonomous-dev start` | Start continuous daemon mode |
| `autonomous-dev run` | Run a single development cycle |
| `autonomous-dev discover` | Discover tasks without executing |
| `autonomous-dev status` | Show current status |
| `autonomous-dev config` | Show/validate configuration |
| `autonomous-dev init` | Initialize configuration file |

### Core Modules

#### Daemon (`daemon.ts`)

The main orchestrator that manages the autonomous development lifecycle:

```typescript
import { createDaemon } from 'autonomous-dev-cli';

const daemon = createDaemon({
  configPath: './autonomous-dev.config.json',
  verbose: true,
  dryRun: false,
  singleCycle: false,
});

await daemon.start();
```

#### GitHub Client (`github/`)

Handles all GitHub API operations:

```typescript
import { createGitHub } from './github/index.js';

const github = createGitHub({
  token: process.env.GITHUB_TOKEN,
  owner: 'your-username',
  repo: 'your-repo',
});

// Issues
const issues = await github.issues.list({ label: 'autonomous-dev' });
await github.issues.create({ title: 'Bug fix', body: 'Description...' });

// Branches
await github.branches.create({ name: 'auto/42-fix-bug', baseBranch: 'main' });

// Pull Requests
await github.pulls.create({ title: 'Fix bug', head: 'auto/42-fix-bug', base: 'main' });
await github.pulls.merge({ pullNumber: 123, method: 'squash' });
```

#### Worker Pool (`executor/`)

Manages parallel task execution:

```typescript
import { createWorkerPool } from './executor/index.js';

const pool = createWorkerPool({
  maxWorkers: 4,
  timeoutMinutes: 30,
});

const results = await pool.execute(tasks);
```

### AI Coding Worker API

The worker exposes these HTTP endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/execute` | POST | Execute AI coding request (SSE response) |
| `/health` | GET | Health check |
| `/status` | GET | Worker status (idle/busy) |
| `/sessions` | GET | List stored sessions |
| `/sessions/:id` | GET | Get session metadata |

**Example request:**

```bash
curl -X POST http://localhost:5001/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": "Add error handling",
    "codingAssistantProvider": "ClaudeAgentSDK",
    "codingAssistantAuthentication": "{\"claudeAiOauth\":{...}}",
    "github": {
      "repoUrl": "https://github.com/user/repo.git",
      "branch": "main"
    }
  }'
```

### Internal API Server

Central backend API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/execute` | POST | Execute AI request (SSE) |
| `/api/resume/:sessionId` | GET | Resume/replay session |
| `/api/sessions` | GET | List sessions |
| `/api/auth/*` | - | Authentication endpoints |
| `/api/github/*` | - | GitHub OAuth & repos |
| `/api/storage/*` | - | File storage operations |

## Configuration Reference

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes* | GitHub personal access token with `repo` scope |
| `CLAUDE_ACCESS_TOKEN` | Yes* | Claude API OAuth access token |
| `CLAUDE_REFRESH_TOKEN` | No | Claude API OAuth refresh token |
| `DATABASE_URL` | No | PostgreSQL connection string |
| `USER_EMAIL` | No | Email for database credential lookup |
| `REPO_OWNER` | Yes | GitHub repository owner |
| `REPO_NAME` | Yes | GitHub repository name |
| `PARALLEL_WORKERS` | No | Number of parallel workers (default: 4) |
| `TASKS_PER_CYCLE` | No | Tasks per cycle (default: 5) |
| `AUTO_MERGE` | No | Enable auto-merge (default: true) |

*Required unless using database credential storage

### Configuration File

Create `autonomous-dev.config.json`:

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
    "excludePaths": ["node_modules", "dist", ".git"]
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30
  },
  "evaluation": {
    "requireBuild": true,
    "requireTests": true
  },
  "merge": {
    "autoMerge": true,
    "mergeMethod": "squash"
  }
}
```

## Troubleshooting

### Common Issues

#### "GitHub token not configured"

**Cause:** Missing or invalid GitHub token.

**Solutions:**
1. Set `GITHUB_TOKEN` environment variable:
   ```bash
   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
   ```
2. Ensure token has `repo` scope
3. Check token hasn't expired

#### "Claude auth not configured"

**Cause:** Missing Claude API credentials.

**Solutions:**
1. Set environment variables:
   ```bash
   export CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxxxxxxxxxx
   export CLAUDE_REFRESH_TOKEN=sk-ant-ort01-xxxxxxxxxxxx
   ```
2. Or configure database credential storage

#### "Configuration validation failed"

**Cause:** Invalid configuration values.

**Solutions:**
1. Run `autonomous-dev config --validate`
2. Check JSON syntax in config file
3. Verify numeric values are within ranges
4. Run `autonomous-dev help-config` for valid options

#### Tasks not being discovered

**Possible causes:**
- Invalid Claude API credentials
- Repository is empty or minimal
- `excludePaths` too restrictive

**Solutions:**
1. Run `autonomous-dev discover -v` for verbose output
2. Check credential validity
3. Review `excludePaths` configuration

#### PRs failing to merge

**Possible causes:**
- CI workflows failing
- Branch protection rules
- Merge conflicts

**Solutions:**
1. Check CI workflow status on GitHub
2. Review branch protection rules
3. Try `conflictStrategy: "manual"` for manual resolution

#### Worker stuck in "busy" state

**Solutions:**
```bash
# Restart the service
docker service update --force <service-name>

# Or scale down and up
docker service scale <service-name>=0
docker service scale <service-name>=4
```

### Getting Help

- Check the [Documentation](./docs/) for detailed guides
- Review [CLI README](./autonomous-dev-cli/README.md) for complete reference
- Open an issue on [GitHub Issues](https://github.com/webedt/monorepo/issues)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on:

- Reporting issues
- Submitting pull requests
- Development workflow
- Code style guidelines

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes following existing code style
4. Run tests: `npm test`
5. Build the project: `npm run build`
6. Commit with clear messages (imperative mood, no prefixes)
7. Push and create a pull request

## License

MIT License - see individual project directories for full license text.

Copyright (c) 2024-2025 ETdoFresh

## Migration from Separate Repos

This monorepo was created by consolidating multiple repositories. All git history from the original repositories has been preserved in their respective folders.
