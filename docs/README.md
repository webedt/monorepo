# Documentation Hub

Welcome to the WebEDT Platform documentation. This hub provides comprehensive guides for understanding, configuring, and using the platform and its autonomous development tools.

## Platform Overview

WebEDT is a web-based game development platform that combines:
- **Digital Storefront** - Browse, purchase, and manage games
- **Game Library** - Organize your purchased and wishlisted games
- **Customizable Dashboard** - Personalized widgets for quick access to content
- **Integrated Development Environment** - Create and edit games using AI-powered tools
- **Autonomous Development System** - AI agents that continuously improve codebases

## Quick Links

| I want to... | Go to |
|--------------|-------|
| Get started quickly | [Quick Start](#quick-start) |
| Learn about WebEDT features | [Platform Features](#webedt-platform-features) |
| Understand the architecture | [Architecture Guide](./architecture.md) |
| Configure the system | [Configuration Guide](./configuration.md) |
| Use the CLI and APIs | [API Reference](./api-reference.md) |
| Fix an issue | [Troubleshooting Guide](./troubleshooting.md) |
| Contribute to the project | [Contributing Guide](../CONTRIBUTING.md) |

## Quick Start

Get up and running in 5 minutes:

```bash
# 1. Clone and install
git clone https://github.com/webedt/monorepo.git
cd monorepo/autonomous-dev-cli
npm install && npm run build

# 2. Configure (copy and edit .env)
cp ../.env.example .env
# Edit .env with your credentials:
#   REPO_OWNER=your-username
#   REPO_NAME=your-repo
#   GITHUB_TOKEN=ghp_xxxx
#   CLAUDE_ACCESS_TOKEN=sk-ant-oat01-xxxx

# 3. Initialize configuration
autonomous-dev init

# 4. Validate setup
autonomous-dev config --validate

# 5. Start autonomous development
autonomous-dev start
```

### Prerequisites

- **Node.js** >= 20.0.0
- **Git** installed and configured
- **GitHub account** with personal access token (`repo` scope)
- **Claude API credentials** (OAuth access token)

### First Run Checklist

- [ ] Node.js 20+ installed (`node --version`)
- [ ] Repository cloned and built
- [ ] `.env` file created with credentials
- [ ] Configuration validated (`autonomous-dev config --validate`)
- [ ] Test discovery works (`autonomous-dev discover --count 1`)

## Documentation Index

### Core Documentation

| Document | Description |
|----------|-------------|
| [Architecture Guide](./architecture.md) | System design, component relationships, and the 5-phase daemon cycle |
| [Configuration Guide](./configuration.md) | Complete reference for all configuration options |
| [API Reference](./api-reference.md) | CLI commands, module APIs, and HTTP endpoints |
| [Troubleshooting Guide](./troubleshooting.md) | Common issues, error messages, and solutions |

### Project Documentation

| Project | Description | Location |
|---------|-------------|----------|
| **Website** | React frontend with personalized Dashboard, Store marketplace, multi-view Library, and complete Editor Suite | [README](../website/README.md) |
| **Autonomous Dev CLI** | Main orchestration tool for autonomous development | [README](../autonomous-dev-cli/README.md) |
| **AI Coding Worker** | LLM execution service for code generation | [README](../ai-coding-worker/README.md) |
| **Internal API Server** | Central backend service for API, storage, auth | [README](../internal-api-server/README.md) |

### Additional Resources

| Resource | Description |
|----------|-------------|
| [Contributing Guide](../CONTRIBUTING.md) | How to contribute to the project |
| [Example Configurations](../examples/) | Ready-to-use config presets |
| [Environment Variables](../.env.example) | All supported environment variables |

## Architecture Overview

The system uses a 5-phase autonomous development workflow:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        5-PHASE AUTONOMOUS WORKFLOW                           │
│                                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────┐  │
│   │ DISCOVER │───▶│ EXECUTE  │───▶│ EVALUATE │───▶│ CREATE   │───▶│MERGE│  │
│   │          │    │          │    │          │    │   PR     │    │     │  │
│   │ Claude   │    │ Parallel │    │ Build    │    │ GitHub   │    │Auto │  │
│   │ Analysis │    │ Workers  │    │ Tests    │    │ API      │    │     │  │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘    └─────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase Summary

| Phase | What Happens |
|-------|--------------|
| **1. Discovery** | Claude AI analyzes codebase, identifies improvements, creates GitHub issues |
| **2. Execution** | Parallel workers clone repo, create branches, implement changes with Claude Agent SDK |
| **3. Evaluation** | Run build verification, test suites, health checks |
| **4. PR Creation** | Create pull requests, link issues, request reviewers |
| **5. Merge** | Auto-merge passing PRs, handle conflicts, close issues |

For detailed architecture information, see the [Architecture Guide](./architecture.md).

## WebEDT Platform Features

### Dashboard (Homepage)

The Dashboard is a separate page from the Store, serving as a personalized aggregation hub that pulls content from multiple sections of the platform.

**Layout:**
- **Customizable Widget System** - Drag-and-drop widget arrangement
- Choose which sections appear on your dashboard
- Layout saved per user for persistent personalization

**Available Widgets/Sections:**
- **Recently Played** - Your recently played games
- **Editor Quick Access** - Recent sessions, quick-start options
- **Store Highlights** - Featured and new items
- **Library Favorites** - Quick access to favorited items
- **Community Activity** - Recent channel messages
- **Session Activity** - Active/recent editor sessions

**Personalization:**
- Adapts based on user preferences (player vs. editor focus)
- Default landing page configurable in settings

### Store (Marketplace)

The Store provides a grid-based marketplace for browsing and purchasing games.

**Layout & Display:**
- Grid view layout with thumbnails
- Each item displays: thumbnail image, price (or "Free" badge), "Play Now" button, "View Trailer" button/link, and wishlist button

**Hover Behavior:**
- **Trailer Auto-play** - When hovering over an item with a trailer, automatically play the trailer video (Netflix/YouTube style)

**Search & Filtering:**
- **Universal Search Box** - Single text input that searches across all fields (title, description, tags, creator, etc.)
- **Filter Dropdowns** - Category, genre, price range, etc.
- **Categories/Tags/Genres** - Admin-configurable taxonomy system for organizing items

**Pricing & Commerce:**
- **Payment Providers** - Stripe and PayPal integration
- **Pricing Options** - Free items, paid items, sales/discounts, bundles (items can also be purchased individually)

**Wishlist:**
- Add items to personal wishlist
- Wishlist notifications (price drops, sales)
- Wishlist visible in user library

**Ratings & Reviews:**
- User rating system (star-based or similar)
- Written reviews with review moderation

**Creator Analytics:**
- Views/impressions, wishlist adds, conversion rates
- Revenue tracking, download/play counts

**Publishing Pipeline:**
- Mechanism for developers to publish projects from editor to store
- Support for publishing as individual or organization/studio

### Library

The Library displays your purchased and wishlisted items with multiple view options. The library is only visible when the user is logged in (hidden for unauthenticated users).

**View Options (Three View Modes):**
1. **Grid View** - Thumbnail-based grid layout with visual item cards
2. **List View** - Standard list with more details including description and metadata
3. **Compact List View** - Dense list for power users with minimal visual elements

**Filtering & Sorting:**
- All items - View complete library
- Recently added - Sort by purchase date
- Recently played - Sort by last played date
- Most used - Sort by play count
- Favorites - Filter to starred items only
- By collection/folder - Filter by user-created collections
- Wishlisted items - View items on wishlist

**Sorting Options:**
- Title (A-Z, Z-A)
- Date Added (Newest/Oldest)
- Last Played (Recent/Oldest)
- Play Count (Most/Least)

**Sorting Direction:**
- Click column headers to toggle ascending/descending sort

**Organization Features:**
- **Quick Favorite** - Star/favorite icon accessible directly from any view (click to toggle)
- **Custom Collections/Folders** - User-created organizational folders with create/delete/add/remove functionality
- **Pagination** - Navigate through large libraries with page controls

**Cloud Services:**
- **Cloud Saves** - Synced across devices automatically (web-based games sync inherently)
- **Shared Platform Libraries for Games:**
  - Cloud save API
  - Leaderboards API
  - Achievement system (future)
  - Voice chat library for games (future)

### Editor Suite

The Editor provides a complete game development environment with AI assistance.

**Session Management:**
- Each session is tied to a Git branch
- User selects a repository and base branch
- Sessions persist across all editor tools
- Sessions never auto-expire

**Components:**
- **Chat** - AI-powered development assistant with verbosity modes
- **Code Editor** - VS Code-style interface with syntax highlighting, multi-file editing, and Git integration
- **Images** - Image editor (canvas with layers), sprite sheet editor, frame animation editor, bone animation editor
- **Sounds** - Wave editor, sound effects generator (SFXR-style), track editor (multi-track mixer/DAW)
- **Scenes** - Object editor (prefabs with component system), scene editor with 2D/UI support
- **Preview** - Live preview of your current branch with hot reload

**Target Runtimes:**
- **Web (TypeScript/JavaScript)** - HTML, CSS, JS/TS games running directly in browser
- **Love2D** - Lua games running via Love.js in an embedded panel

For complete platform specifications, see [SPEC.md](../SPEC.md).

## Component Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          COMPONENT ARCHITECTURE                             │
│                                                                             │
│   ┌─────────────────────────────┐     ┌─────────────────────────────┐     │
│   │    Autonomous Dev CLI       │     │      AI Coding Worker       │     │
│   │    ───────────────────      │     │      ────────────────       │     │
│   │                             │     │                             │     │
│   │  Daemon Manager             │     │  Claude Agent SDK           │     │
│   │  └─ Controls cycle loop    │     │  └─ Executes LLM requests   │     │
│   │                             │     │                             │     │
│   │  Task Discovery             │◀───▶│  Provider Factory           │     │
│   │  └─ Claude AI analysis     │     │  └─ Multi-provider support  │     │
│   │                             │     │                             │     │
│   │  GitHub Client              │     │  Session Manager            │     │
│   │  └─ Issues, PRs, branches  │     │  └─ MinIO persistence       │     │
│   │                             │     │                             │     │
│   │  Worker Pool                │     │  SSE Streaming              │     │
│   │  └─ Parallel execution     │     │  └─ Real-time output        │     │
│   │                             │     │                             │     │
│   │  Evaluation Engine          │     │                             │     │
│   │  └─ Build/test validation  │     │                             │     │
│   │                             │     │                             │     │
│   │  Conflict Resolver          │     │                             │     │
│   │  └─ Merge strategy         │     │                             │     │
│   └─────────────────────────────┘     └─────────────────────────────┘     │
│                │                                   │                       │
│                └───────────────┬─────────────────┘                       │
│                                │                                          │
│                                ▼                                          │
│                ┌─────────────────────────────┐                           │
│                │    Internal API Server      │                           │
│                │    ──────────────────       │                           │
│                │                             │                           │
│                │  API Routes                 │                           │
│                │  └─ /execute, /sessions    │                           │
│                │                             │                           │
│                │  Storage Service            │                           │
│                │  └─ MinIO integration      │                           │
│                │                             │                           │
│                │  Database Layer             │                           │
│                │  └─ PostgreSQL + Drizzle   │                           │
│                └─────────────────────────────┘                           │
│                                                                          │
│   External Services:                                                     │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│   │  GitHub API │ │  Claude AI  │ │ PostgreSQL  │ │    MinIO    │      │
│   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `autonomous-dev start` | Start continuous daemon mode |
| `autonomous-dev run` | Run a single development cycle |
| `autonomous-dev discover` | Discover tasks without executing |
| `autonomous-dev status` | Show current status |
| `autonomous-dev config` | Show/validate configuration |
| `autonomous-dev init` | Initialize configuration file |
| `autonomous-dev help-config` | Show configuration help |

For detailed command documentation, see the [API Reference](./api-reference.md).

## Configuration Quick Reference

### Minimal Configuration

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo"
  }
}
```

### Common Settings

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo",
    "baseBranch": "main"
  },
  "discovery": {
    "tasksPerCycle": 5,
    "maxOpenIssues": 10
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30
  },
  "merge": {
    "autoMerge": true,
    "mergeMethod": "squash"
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REPO_OWNER` | Yes | GitHub repository owner |
| `REPO_NAME` | Yes | Repository name |
| `GITHUB_TOKEN` | Yes* | GitHub personal access token |
| `CLAUDE_ACCESS_TOKEN` | Yes* | Claude API access token |
| `CLAUDE_REFRESH_TOKEN` | No | Claude API refresh token |
| `DATABASE_URL` | No | PostgreSQL for credential storage |
| `USER_EMAIL` | No | Email for database lookup |

*Required unless using database credential storage

For complete configuration documentation, see the [Configuration Guide](./configuration.md).

## Troubleshooting Quick Reference

### Common Issues

| Issue | Quick Fix |
|-------|-----------|
| GitHub token error | Check `GITHUB_TOKEN` has `repo` scope |
| Claude auth error | Verify `CLAUDE_ACCESS_TOKEN` is valid |
| Config validation failed | Run `autonomous-dev config --validate` |
| Tasks not discovered | Check Claude credentials, reduce `excludePaths` |
| PRs not merging | Review CI status, branch protection rules |
| Worker stuck | Restart daemon, clear work directory |

### Diagnostic Commands

```bash
# Validate configuration
autonomous-dev config --validate

# Test discovery
autonomous-dev discover -v --count 1

# Check status
autonomous-dev status

# Run with verbose logging
autonomous-dev run --dry-run --verbose
```

For detailed troubleshooting, see the [Troubleshooting Guide](./troubleshooting.md).

## Example Configurations

Ready-to-use configurations for common scenarios:

### Conservative (Production)

```json
{
  "repo": { "owner": "org", "name": "production-app" },
  "discovery": { "tasksPerCycle": 2, "maxOpenIssues": 5 },
  "execution": { "parallelWorkers": 2 },
  "merge": { "autoMerge": false }
}
```

### Aggressive (Side Projects)

```json
{
  "repo": { "owner": "user", "name": "side-project" },
  "discovery": { "tasksPerCycle": 10, "maxOpenIssues": 20 },
  "execution": { "parallelWorkers": 8 },
  "evaluation": { "requireTests": false }
}
```

### CI/CD Scheduled

```json
{
  "repo": { "owner": "org", "name": "repo" },
  "discovery": { "tasksPerCycle": 3 },
  "logging": { "format": "json" }
}
```

More examples in `autonomous-dev-cli/examples/` and [Configuration Guide](./configuration.md#example-configurations).

## API Quick Reference

### Core Interfaces

```typescript
// Daemon
const daemon = new Daemon({ configPath, verbose, dryRun });
await daemon.start();

// GitHub
const github = createGitHub({ token, owner, repo });
await github.issues.create({ title, body });
await github.pulls.merge({ number, method: 'squash' });

// Discovery
const tasks = await discoverTasks({ repoPath, claudeAuth });

// Evaluation
const result = await runEvaluation({ repoPath, branchName, config });
```

For complete API documentation, see the [API Reference](./api-reference.md).

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Code of conduct
- Development setup
- Commit message guidelines
- Pull request process
- Code style guidelines

### Quick Contribution Guide

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes following existing code style
4. Run tests: `npm test`
5. Build: `npm run build`
6. Commit with clear messages (imperative mood, no prefixes)
7. Push and create a pull request

## Repository Links

- **GitHub Repository**: https://github.com/webedt/monorepo
- **Issue Tracker**: https://github.com/webedt/monorepo/issues
- **Pull Requests**: https://github.com/webedt/monorepo/pulls

---

*Documentation last updated: December 2025*
*Updated for Dashboard, Store, and Library features per SPEC.md Sections 2-4*
