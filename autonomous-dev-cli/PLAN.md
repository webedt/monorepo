# Autonomous Development CLI - Implementation Plan

## Overview

A CLI tool that runs as a continuous daemon to autonomously develop your WebEDT website. It discovers tasks, creates GitHub issues, implements them in parallel, evaluates the results, and auto-merges successful changes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTONOMOUS DEV CLI                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Daemon     │    │    Task      │    │   GitHub     │                   │
│  │   Loop       │───▶│   Discovery  │───▶│   Issues     │                   │
│  │              │    │   (Claude)   │    │   Creation   │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                                       │                            │
│         ▼                                       ▼                            │
│  ┌──────────────────────────────────────────────────────────────┐           │
│  │                    PARALLEL WORKERS                          │           │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐         │           │
│  │  │ Worker1 │  │ Worker2 │  │ Worker3 │  │ Worker4 │         │           │
│  │  │ Issue#1 │  │ Issue#2 │  │ Issue#3 │  │ Issue#4 │         │           │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘         │           │
│  └──────────────────────────────────────────────────────────────┘           │
│         │                                                                    │
│         ▼                                                                    │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  Evaluation  │───▶│   Auto-PR    │───▶│  Conflict    │                   │
│  │   Pipeline   │    │   & Merge    │    │  Resolution  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Main Daemon (`src/daemon.ts`)
- Runs continuously in the background
- Configurable loop interval (default: wait for all tasks to complete, then restart)
- Graceful shutdown handling (SIGINT, SIGTERM)
- State persistence (resume after restart)
- Logging to file and console

### 2. Task Discovery (`src/discovery/`)
- **Codebase Analyzer** (`analyzer.ts`)
  - Scans repo structure, identifies patterns
  - Finds TODOs, FIXMEs, incomplete features
  - Analyzes code quality issues

- **Task Generator** (`generator.ts`)
  - Uses Claude to analyze codebase and suggest improvements
  - Considers existing GitHub issues (don't duplicate)
  - Prioritizes tasks based on impact/complexity
  - Generates 4-5 actionable tasks per cycle

### 3. GitHub Integration (`src/github/`)
- **Issue Manager** (`issues.ts`)
  - Create issues for discovered tasks
  - Label issues (e.g., `autonomous-dev`, `priority:high`)
  - Track issue state (open, in-progress, closed)
  - Fetch existing issues to avoid duplicates
  - Allow user-created issues to be picked up

- **Branch Manager** (`branches.ts`)
  - Create feature branches per issue
  - Naming convention: `auto/{issue-number}-{short-description}`

- **PR Manager** (`pulls.ts`)
  - Create PRs with detailed descriptions
  - Auto-merge when checks pass
  - Handle merge conflicts (rebase/merge from main)

### 4. Task Executor (`src/executor/`)
- **Worker Pool** (`pool.ts`)
  - Manages parallel workers (configurable, default: 4)
  - Assigns issues to workers
  - Tracks worker state and progress

- **Worker** (`worker.ts`)
  - Clones repo to isolated directory
  - Creates branch for issue
  - Invokes Claude Agent SDK to implement task
  - Commits changes and pushes
  - Reports completion status

### 5. Evaluation Pipeline (`src/evaluation/`)
This is the critical "does it still work?" verification.

- **Build Verification** (`build.ts`)
  - Run `npm run build` for each affected package
  - Fail fast if build fails

- **Test Runner** (`tests.ts`)
  - Run existing tests (`npm test`)
  - Track test pass/fail

- **Health Check** (`health.ts`)
  - Start the app locally (or use preview URL)
  - Check critical endpoints respond (200 OK)
  - Verify no console errors

- **Smoke Tests** (`smoke.ts`)
  - Critical path verification
  - Homepage loads
  - Auth flow works (if applicable)
  - Key features render

- **Visual Regression** (`visual.ts`) [Optional Phase 2]
  - Screenshot comparison using Playwright
  - Flag significant visual changes

- **LLM Evaluation** (`llm-eval.ts`) [Optional Phase 2]
  - Take screenshots of key pages
  - Ask Claude to evaluate if they look correct
  - Natural language assessment

### 6. Conflict Resolution (`src/conflicts/`)
- **Merge Handler** (`merge.ts`)
  - When multiple PRs try to merge, handle sequentially
  - If PR has conflicts after another merges:
    1. Rebase on main
    2. Re-run evaluation
    3. Attempt merge again
  - Max retry attempts before marking as needs-manual-review

### 7. Configuration (`src/config/`)
- **Settings** (`settings.ts`)
  ```typescript
  interface Config {
    // Target repository
    repo: {
      owner: string;
      name: string;
      baseBranch: string; // 'main'
    };

    // Task discovery
    discovery: {
      tasksPerCycle: number; // 4-5
      maxOpenIssues: number; // Don't create more if too many open
      excludePaths: string[]; // Paths to ignore
    };

    // Execution
    execution: {
      parallelWorkers: number; // 4
      timeoutMinutes: number; // 30
      workDir: string; // Where to clone repos
    };

    // Evaluation
    evaluation: {
      requireBuild: boolean;
      requireTests: boolean;
      requireHealthCheck: boolean;
      requireSmokeTests: boolean;
      smokeTestUrls: string[];
      previewUrlPattern: string; // For branch previews
    };

    // Auto-merge
    merge: {
      autoMerge: boolean;
      requireAllChecks: boolean;
      maxRetries: number;
      conflictStrategy: 'rebase' | 'merge' | 'manual';
    };

    // Daemon
    daemon: {
      loopIntervalMs: number;
      pauseBetweenCycles: boolean;
    };

    // Credentials
    credentials: {
      githubToken: string;
      claudeAuth: object; // From DB or env
      databaseUrl: string;
      userEmail: string; // For DB lookup
    };
  }
  ```

## Database Integration

Query user credentials from your existing database:

```typescript
// src/db/client.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

async function getUserCredentials(email: string) {
  const user = await db.select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return {
    githubAccessToken: user.githubAccessToken,
    claudeAuth: user.claudeAuth,
  };
}
```

## Execution Flow

### One Complete Cycle:

```
1. DISCOVER
   ├── Fetch existing open issues labeled 'autonomous-dev'
   ├── Fetch codebase state (git status, recent changes)
   ├── Ask Claude: "What are the next 4-5 improvements?"
   ├── Filter out duplicates (already open issues)
   └── Create GitHub issues for new tasks

2. ASSIGN
   ├── Get all open issues labeled 'autonomous-dev'
   ├── Prioritize (user-created issues first, then auto-created)
   ├── Assign to available workers (up to parallelWorkers)
   └── Label issues as 'in-progress'

3. EXECUTE (Parallel)
   ├── Each worker:
   │   ├── Clone repo to temp directory
   │   ├── Create branch: auto/{issue-number}-{slug}
   │   ├── Run Claude Agent SDK with issue description
   │   ├── Commit changes with message referencing issue
   │   └── Push branch to remote

4. EVALUATE (Per branch)
   ├── Build verification
   ├── Run tests
   ├── Health checks (if preview available)
   ├── Smoke tests
   └── Record pass/fail per branch

5. MERGE (Sequential)
   ├── For each passing branch:
   │   ├── Create PR (or update existing)
   │   ├── Wait for CI checks
   │   ├── If mergeable: merge and delete branch
   │   ├── If conflicts: rebase and retry
   │   └── Close issue on success
   └── Label failed branches for review

6. CLEANUP
   ├── Remove temp directories
   ├── Update issue labels
   └── Log cycle summary

7. WAIT (if daemon mode)
   └── Sleep for configured interval, then goto 1
```

## CLI Interface

```bash
# Install globally
npm install -g @webedt/autonomous-dev-cli

# Or run directly
npx autonomous-dev

# Commands
autonomous-dev start           # Start daemon (continuous)
autonomous-dev run             # Run one cycle and exit
autonomous-dev discover        # Only discover tasks (no execution)
autonomous-dev status          # Show current status
autonomous-dev stop            # Stop running daemon
autonomous-dev config          # Interactive configuration
autonomous-dev logs            # Tail daemon logs

# Options
--config, -c    Path to config file (default: ./autonomous-dev.config.json)
--verbose, -v   Verbose logging
--dry-run       Discover tasks but don't create issues/execute
--workers, -w   Number of parallel workers (default: 4)
--repo, -r      Repository (owner/name)
```

## File Structure

```
autonomous-dev-cli/
├── package.json
├── tsconfig.json
├── README.md
├── .env.example
├── autonomous-dev.config.example.json
│
├── src/
│   ├── index.ts              # CLI entry point
│   ├── daemon.ts             # Main daemon loop
│   │
│   ├── config/
│   │   ├── index.ts          # Config loader
│   │   ├── schema.ts         # Config validation (zod)
│   │   └── defaults.ts       # Default values
│   │
│   ├── discovery/
│   │   ├── index.ts
│   │   ├── analyzer.ts       # Codebase analysis
│   │   └── generator.ts      # Task generation with Claude
│   │
│   ├── github/
│   │   ├── index.ts
│   │   ├── client.ts         # Octokit wrapper
│   │   ├── issues.ts         # Issue management
│   │   ├── branches.ts       # Branch management
│   │   └── pulls.ts          # PR management
│   │
│   ├── executor/
│   │   ├── index.ts
│   │   ├── pool.ts           # Worker pool
│   │   ├── worker.ts         # Individual worker
│   │   └── claude.ts         # Claude Agent SDK integration
│   │
│   ├── evaluation/
│   │   ├── index.ts          # Evaluation orchestrator
│   │   ├── build.ts          # Build verification
│   │   ├── tests.ts          # Test runner
│   │   ├── health.ts         # Health checks
│   │   ├── smoke.ts          # Smoke tests
│   │   └── llm-eval.ts       # LLM-based evaluation
│   │
│   ├── conflicts/
│   │   ├── index.ts
│   │   └── resolver.ts       # Conflict resolution
│   │
│   ├── db/
│   │   ├── index.ts
│   │   └── client.ts         # Database client (reuse from internal-api-server)
│   │
│   └── utils/
│       ├── logger.ts         # Logging utility
│       ├── git.ts            # Git helpers
│       └── process.ts        # Process management
│
├── tests/
│   └── ...
│
└── bin/
    └── autonomous-dev        # CLI executable
```

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "@octokit/rest": "^20.0.0",
    "commander": "^12.0.0",
    "drizzle-orm": "^0.30.0",
    "pg": "^8.11.0",
    "simple-git": "^3.22.0",
    "zod": "^3.22.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.0",
    "dotenv": "^16.0.0",
    "playwright": "^1.40.0"
  }
}
```

## Implementation Phases

### Phase 1: Core Loop (MVP)
- [x] Project setup (package.json, tsconfig)
- [ ] Config loader with validation
- [ ] GitHub client (issues, branches, PRs)
- [ ] Task discovery with Claude
- [ ] Single worker execution
- [ ] Basic evaluation (build + tests)
- [ ] Auto-PR creation
- [ ] CLI commands (start, run, status)

### Phase 2: Parallel & Evaluation
- [ ] Worker pool for parallel execution
- [ ] Health checks with preview URLs
- [ ] Smoke tests
- [ ] Conflict resolution
- [ ] Auto-merge with retry logic

### Phase 3: Advanced Evaluation
- [ ] Visual regression testing
- [ ] LLM-based screenshot evaluation
- [ ] Performance metrics tracking
- [ ] Rollback capability

### Phase 4: Polish
- [ ] Web dashboard for monitoring
- [ ] Slack/Discord notifications
- [ ] Cost tracking (Claude API usage)
- [ ] Analytics and reporting

## Key Design Decisions

### 1. GitHub Issues as Task Queue
**Why:** Creates visibility, allows manual task injection, familiar interface
**Alternative considered:** Local task file or database table
**Decision:** GitHub Issues because it's already integrated, visible, and allows you to add tasks manually

### 2. Claude Agent SDK for Implementation
**Why:** Already proven in ai-coding-worker, handles tools automatically
**Reuse:** Same credential management, same execution pattern
**Benefit:** Workers get full Claude Code capabilities

### 3. Sequential Merging
**Why:** Avoids complex merge conflict scenarios
**How:** Lock main during merge, rebase failed branches
**Fallback:** Mark as needs-manual-review after N retries

### 4. Layered Evaluation
**Why:** Fail fast, don't waste time on obvious failures
**Order:** Build → Tests → Health → Smoke → Visual → LLM
**Config:** Each layer can be enabled/disabled

### 5. Preview URL Integration
**Why:** Your Dokploy setup already creates preview URLs per branch
**Use:** Health checks and smoke tests hit the preview URL
**Pattern:** `https://webedt.etdofresh.com/github/{owner}/{repo}/{branch}/`

## Questions Resolved

1. **Where to store state?** → Config file + GitHub Issues (source of truth)
2. **How to handle credentials?** → Query from your existing PostgreSQL DB
3. **How many parallel workers?** → Configurable, default 4
4. **What if evaluation fails?** → Don't merge, label issue, continue with others
5. **What if merge conflicts?** → Rebase and retry, eventually mark for manual review

## Next Steps

1. Create the project structure
2. Implement config loader
3. Implement GitHub client with issue management
4. Implement task discovery with Claude
5. Implement single worker execution
6. Implement basic evaluation pipeline
7. Implement auto-PR and merge
8. Add CLI interface
9. Test end-to-end
10. Add parallel workers

Ready to start implementation?
