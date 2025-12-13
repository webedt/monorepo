# Documentation Hub

Welcome to the Autonomous Development System documentation. This hub provides comprehensive guides for understanding, configuring, and using the system.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Project Documentation](#project-documentation)
- [Guides](#guides)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

## Quick Start

Get up and running in 5 minutes:

```bash
# 1. Clone and install
git clone https://github.com/webedt/monorepo.git
cd monorepo/autonomous-dev-cli
npm install && npm run build

# 2. Configure (copy and edit .env)
cp ../.env.example .env

# 3. Initialize
autonomous-dev init

# 4. Start autonomous development
autonomous-dev start
```

For detailed setup, see the [Quick Start Guide](../autonomous-dev-cli/docs/quick-start.md).

## Architecture Overview

The system uses a 5-phase autonomous development workflow:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        5-PHASE AUTONOMOUS WORKFLOW                           │
│                                                                             │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────┐ │
│   │ DISCOVER │───▶│ EXECUTE  │───▶│ EVALUATE │───▶│ CREATE   │───▶│MERGE│ │
│   │          │    │          │    │          │    │   PR     │    │     │ │
│   │ Claude   │    │ Parallel │    │ Build    │    │ GitHub   │    │Auto │ │
│   │ Analysis │    │ Workers  │    │ Tests    │    │ API      │    │     │ │
│   └──────────┘    └──────────┘    └──────────┘    └──────────┘    └─────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Discovery

Claude AI analyzes your codebase to identify:
- Bug fixes needed
- New features to implement
- Code improvements and refactoring
- Documentation gaps
- Test coverage improvements

### Phase 2: Execution

Multiple parallel workers:
- Clone repository to isolated workspace
- Create feature branches: `auto/{issue-number}-{slug}`
- Run Claude Agent SDK to implement changes
- Commit and push to remote

### Phase 3: Evaluation

Comprehensive verification:
- Build verification (`npm run build`)
- Test execution (`npm test`)
- Health check validation
- Smoke test execution (optional)

### Phase 4: PR Creation

GitHub integration:
- Create pull request with description
- Link to related issue
- Wait for CI checks to pass

### Phase 5: Merge

Intelligent conflict handling:
- Auto-merge passing PRs
- Conflict resolution (rebase, merge, or manual)
- Close associated issue

### Component Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          COMPONENT ARCHITECTURE                              │
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
│                │                             │                           │
│                │  GitHub Operations          │                           │
│                │  └─ Clone, branch, push    │                           │
│                └─────────────────────────────┘                           │
│                                                                          │
│   External Services:                                                     │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│   │  GitHub API │ │  Claude AI  │ │ PostgreSQL  │ │    MinIO    │      │
│   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │
└────────────────────────────────────────────────────────────────────────────┘
```

## Project Documentation

| Project | Description | Documentation |
|---------|-------------|---------------|
| **Autonomous Dev CLI** | Main orchestration tool | [README](../autonomous-dev-cli/README.md) |
| **AI Coding Worker** | LLM execution service | [README](../ai-coding-worker/README.md) |
| **Internal API Server** | Central backend service | [README](../internal-api-server/README.md) |
| **Website** | React frontend | [README](../website/README.md) |

## Guides

### Setup Guides

| Guide | Description |
|-------|-------------|
| [Quick Start](../autonomous-dev-cli/docs/quick-start.md) | Get running in under 10 minutes |
| [Configuration](../autonomous-dev-cli/docs/configuration.md) | Complete configuration reference |
| [GitHub Setup](../autonomous-dev-cli/docs/github-setup.md) | GitHub token and OAuth setup |
| [Claude Setup](../autonomous-dev-cli/docs/claude-setup.md) | Claude API credential configuration |
| [Database Setup](../autonomous-dev-cli/docs/database-setup.md) | PostgreSQL credential storage |

### Operational Guides

| Guide | Description |
|-------|-------------|
| [Security](../autonomous-dev-cli/docs/security.md) | Security best practices |
| [Troubleshooting](../autonomous-dev-cli/docs/troubleshooting.md) | Common issues and solutions |
| [AI Worker API](../ai-coding-worker/API.md) | Worker API documentation |
| [Credentials](../ai-coding-worker/CREDENTIALS.md) | How to obtain OAuth credentials |

## API Reference

### CLI Commands

| Command | Description |
|---------|-------------|
| `autonomous-dev start` | Start continuous daemon |
| `autonomous-dev run` | Single development cycle |
| `autonomous-dev discover` | Discover tasks only |
| `autonomous-dev status` | Show current status |
| `autonomous-dev config` | Show/validate config |
| `autonomous-dev init` | Initialize configuration |

### Core Modules

| Module | Path | Purpose |
|--------|------|---------|
| Daemon | `daemon.ts` | Main orchestration loop |
| Discovery | `discovery/` | Task discovery with Claude |
| GitHub | `github/` | GitHub API client |
| Executor | `executor/` | Worker pool management |
| Evaluation | `evaluation/` | Build/test verification |
| Conflicts | `conflicts/` | Merge conflict resolution |
| Config | `config/` | Configuration management |

### Environment Variables

See [.env.example](../.env.example) for all supported environment variables.

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| GitHub token error | Check `GITHUB_TOKEN` has `repo` scope |
| Claude auth error | Verify `CLAUDE_ACCESS_TOKEN` is valid |
| Config validation failed | Run `autonomous-dev config --validate` |
| Tasks not discovered | Check Claude credentials and `excludePaths` |
| PRs failing to merge | Review CI status and branch protection |
| Worker stuck | Restart with `docker service update --force` |

For detailed troubleshooting, see the [Troubleshooting Guide](../autonomous-dev-cli/docs/troubleshooting.md).

## Contributing

We welcome contributions! See [CONTRIBUTING.md](../CONTRIBUTING.md) for:

- Reporting issues
- Submitting pull requests
- Development workflow
- Code style guidelines

## Additional Resources

- [GitHub Repository](https://github.com/webedt/monorepo)
- [Issue Tracker](https://github.com/webedt/monorepo/issues)
- [Example Configurations](../examples/)
