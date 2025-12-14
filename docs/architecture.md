# Architecture Documentation

This document provides a comprehensive overview of the Autonomous Development System architecture, including component relationships, data flows, and the daemon cycle.

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [The 5-Phase Daemon Cycle](#the-5-phase-daemon-cycle)
- [Data Flow](#data-flow)
- [Module Reference](#module-reference)
- [External Dependencies](#external-dependencies)
- [Deployment Architecture](#deployment-architecture)

## System Overview

The Autonomous Development System is a platform that uses AI agents to continuously analyze, improve, and evolve codebases. It operates as a continuous daemon that discovers development tasks, creates GitHub issues, implements changes using AI (Claude Agent SDK), evaluates results, and auto-merges successful changes.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          AUTONOMOUS DEVELOPMENT SYSTEM                            │
│                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────┐ │
│   │                         ORCHESTRATION LAYER                                 │ │
│   │                                                                            │ │
│   │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │ │
│   │   │  Config Loader  │───▶│  Daemon Manager │───▶│  Cycle Executor │      │ │
│   │   │                 │    │                 │    │                 │      │ │
│   │   │ • JSON parsing  │    │ • Loop control  │    │ • Phase runner  │      │ │
│   │   │ • Env vars      │    │ • Signals       │    │ • Error handler │      │ │
│   │   │ • Validation    │    │ • Intervals     │    │ • Metrics       │      │ │
│   │   └─────────────────┘    └─────────────────┘    └─────────────────┘      │ │
│   └───────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                         │
│                                        ▼                                         │
│   ┌───────────────────────────────────────────────────────────────────────────┐ │
│   │                           EXECUTION LAYER                                   │ │
│   │                                                                            │ │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│   │  │  Discovery   │  │  Executor    │  │  Evaluation  │  │    Merge     │  │ │
│   │  │              │  │              │  │              │  │              │  │ │
│   │  │ • Analyzer   │  │ • Worker     │  │ • Build      │  │ • PR Create  │  │ │
│   │  │ • Generator  │  │   Pool       │  │ • Tests      │  │ • Conflict   │  │ │
│   │  │ • Deduplicator  │ • Tasks     │  │ • Health     │  │   Resolution │  │ │
│   │  │ • Cache      │  │              │  │              │  │ • Auto-merge │  │ │
│   │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│   └───────────────────────────────────────────────────────────────────────────┘ │
│                                        │                                         │
│                                        ▼                                         │
│   ┌───────────────────────────────────────────────────────────────────────────┐ │
│   │                         INTEGRATION LAYER                                   │ │
│   │                                                                            │ │
│   │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │ │
│   │   │  GitHub Client  │    │   Claude API    │    │   Database      │      │ │
│   │   │                 │    │                 │    │                 │      │ │
│   │   │ • Issues        │    │ • Analysis      │    │ • Credentials   │      │ │
│   │   │ • Branches      │    │ • Generation    │    │ • Sessions      │      │ │
│   │   │ • Pull Requests │    │ • Implementation│    │ • Users         │      │ │
│   │   └─────────────────┘    └─────────────────┘    └─────────────────┘      │ │
│   └───────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Autonomous Dev CLI

The main orchestration component that manages the development lifecycle.

```
autonomous-dev-cli/
├── src/
│   ├── index.ts              # CLI entry point (Commander.js)
│   ├── daemon.ts             # Main daemon class
│   │
│   ├── config/               # Configuration management
│   │   ├── index.ts          # Config loader
│   │   ├── schema.ts         # Zod validation schemas
│   │   └── migrations.ts     # Config version migrations
│   │
│   ├── discovery/            # Task discovery
│   │   ├── analyzer.ts       # Codebase analysis
│   │   ├── generator.ts      # Task generation with Claude
│   │   ├── deduplicator.ts   # Duplicate detection
│   │   └── cache.ts          # Persistent caching
│   │
│   ├── github/               # GitHub integration
│   │   ├── client.ts         # Octokit wrapper with circuit breaker
│   │   ├── issues.ts         # Issue management
│   │   ├── branches.ts       # Branch operations
│   │   └── pulls.ts          # Pull request management
│   │
│   ├── executor/             # Task execution
│   │   ├── worker.ts         # Individual worker
│   │   └── pool.ts           # Worker pool management
│   │
│   ├── evaluation/           # Quality verification
│   │   ├── build.ts          # Build verification
│   │   ├── tests.ts          # Test execution
│   │   └── health.ts         # Health checks
│   │
│   ├── conflicts/            # Merge conflict handling
│   │   └── resolver.ts       # Conflict resolution strategies
│   │
│   ├── db/                   # Database integration
│   │   └── index.ts          # PostgreSQL client
│   │
│   ├── monitoring/           # Health monitoring
│   │   └── index.ts          # Health server
│   │
│   └── utils/                # Utilities
│       ├── logger.ts         # Structured logging
│       ├── errors.ts         # Error handling
│       ├── metrics.ts        # Performance metrics
│       └── progress.ts       # Progress tracking
```

### AI Coding Worker

Ephemeral worker service for LLM execution.

```
ai-coding-worker/
├── src/
│   ├── server.ts             # Express server with SSE
│   ├── orchestrator.ts       # Request orchestration
│   ├── types.ts              # TypeScript definitions
│   │
│   ├── providers/            # LLM providers
│   │   ├── BaseProvider.ts   # Provider interface
│   │   ├── ClaudeCodeProvider.ts
│   │   ├── CodexProvider.ts
│   │   ├── GeminiProvider.ts
│   │   └── ProviderFactory.ts
│   │
│   ├── clients/              # Client management
│   │   └── sessionManager.ts
│   │
│   ├── storage/              # Storage integration
│   │   └── storageClient.ts
│   │
│   └── utils/                # Utilities
│       ├── credentialManager.ts
│       ├── filePathHelper.ts
│       └── llmHelper.ts
```

### Internal API Server

Central backend for API routes, storage, and GitHub operations.

```
internal-api-server/
├── src/
│   ├── index.ts              # Express app entrypoint
│   ├── auth.ts               # Lucia authentication
│   │
│   ├── routes/               # API endpoints
│   │   ├── execute.ts        # AI execution
│   │   ├── resume.ts         # Session replay
│   │   ├── sessions.ts       # Session CRUD
│   │   ├── auth.ts           # Authentication
│   │   ├── github.ts         # GitHub OAuth
│   │   └── storage.ts        # File storage
│   │
│   ├── services/
│   │   ├── storage/          # MinIO integration
│   │   └── github/           # Git operations
│   │
│   └── db/
│       ├── index.ts          # PostgreSQL connection
│       └── schema.ts         # Drizzle ORM schema
```

## The 5-Phase Daemon Cycle

The daemon runs a continuous loop executing these five phases:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DAEMON CYCLE                                         │
│                                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                           PHASE 1: DISCOVERY                              │   │
│   │                                                                          │   │
│   │   ┌────────────┐    ┌────────────┐    ┌────────────┐    ┌───────────┐  │   │
│   │   │  Analyze   │───▶│  Generate  │───▶│ Deduplicate │───▶│  Create   │  │   │
│   │   │  Codebase  │    │   Tasks    │    │   Tasks    │    │  Issues   │  │   │
│   │   └────────────┘    └────────────┘    └────────────┘    └───────────┘  │   │
│   │                                                                          │   │
│   │   • Scan file structure          • Categorize improvements              │   │
│   │   • Extract TODO comments        • Assign priorities                    │   │
│   │   • Analyze dependencies         • Estimate complexity                  │   │
│   │   • Check git history            • Remove duplicates                    │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                           PHASE 2: EXECUTION                              │   │
│   │                                                                          │   │
│   │              ┌─────────────────────────────────────┐                     │   │
│   │              │          WORKER POOL                │                     │   │
│   │              │                                     │                     │   │
│   │   Task 1 ───▶│  ┌──────────┐  ┌──────────┐       │                     │   │
│   │   Task 2 ───▶│  │ Worker 1 │  │ Worker 2 │       │                     │   │
│   │   Task 3 ───▶│  └──────────┘  └──────────┘       │                     │   │
│   │   Task 4 ───▶│  ┌──────────┐  ┌──────────┐       │                     │   │
│   │              │  │ Worker 3 │  │ Worker 4 │       │                     │   │
│   │              │  └──────────┘  └──────────┘       │                     │   │
│   │              └─────────────────────────────────────┘                     │   │
│   │                                                                          │   │
│   │   Each worker:                                                           │   │
│   │   • Clones repo to isolated directory                                   │   │
│   │   • Creates branch: auto/{issue-number}-{slug}                          │   │
│   │   • Runs Claude Agent SDK to implement                                  │   │
│   │   • Commits and pushes changes                                          │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                          PHASE 3: EVALUATION                              │   │
│   │                                                                          │   │
│   │   ┌────────────────┐    ┌────────────────┐    ┌────────────────┐        │   │
│   │   │      BUILD     │───▶│     TESTS      │───▶│  HEALTH CHECK  │        │   │
│   │   │                │    │                │    │                │        │   │
│   │   │  npm run build │    │    npm test    │    │  HTTP checks   │        │   │
│   │   │  TypeScript    │    │    vitest      │    │  Preview URLs  │        │   │
│   │   │  compilation   │    │    coverage    │    │  Smoke tests   │        │   │
│   │   └────────────────┘    └────────────────┘    └────────────────┘        │   │
│   │                                                                          │   │
│   │   Gate: Each step must pass before proceeding                           │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                         PHASE 4: PR CREATION                              │   │
│   │                                                                          │   │
│   │   ┌────────────────┐    ┌────────────────┐    ┌────────────────┐        │   │
│   │   │   Create PR    │───▶│  Wait for CI   │───▶│  Request       │        │   │
│   │   │                │    │                │    │  Review        │        │   │
│   │   │  • Title       │    │  • Actions     │    │  • CODEOWNERS  │        │   │
│   │   │  • Description │    │  • Status      │    │  • Reviewers   │        │   │
│   │   │  • Labels      │    │    checks      │    │                │        │   │
│   │   └────────────────┘    └────────────────┘    └────────────────┘        │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                           PHASE 5: MERGE                                  │   │
│   │                                                                          │   │
│   │   ┌────────────────┐    ┌────────────────┐    ┌────────────────┐        │   │
│   │   │ Check Conflicts│───▶│  Resolve/Retry │───▶│   Auto-Merge   │        │   │
│   │   │                │    │                │    │                │        │   │
│   │   │  • Up to date? │    │  • Rebase      │    │  • Squash      │        │   │
│   │   │  • Conflicts?  │    │  • Merge       │    │  • Close issue │        │   │
│   │   │                │    │  • Manual      │    │  • Cleanup     │        │   │
│   │   └────────────────┘    └────────────────┘    └────────────────┘        │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│                              [Wait for interval]                                 │
│                                        │                                         │
│                                        └──────────────────────────────────────┐ │
│                                                                               │ │
│                              ┌──────────────────────────────────────────────────┘ │
│                              │                                                   │
│                              ▼                                                   │
│                         [REPEAT CYCLE]                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Phase Details

#### Phase 1: Discovery

The discovery phase analyzes the codebase to identify improvement opportunities.

**Components:**
- `CodebaseAnalyzer`: Scans directory structure, extracts TODOs, analyzes dependencies
- `TaskGenerator`: Uses Claude AI to suggest improvements
- `TaskDeduplicator`: Removes duplicate tasks, detects conflicting file paths
- `PersistentCache`: Caches analysis results for performance

**Inputs:**
- Repository contents
- Git history
- Existing open issues

**Outputs:**
- List of `DiscoveredTask` objects
- GitHub issues created

#### Phase 2: Execution

The execution phase implements tasks in parallel using a worker pool.

**Components:**
- `WorkerPool`: Manages parallel execution with configurable concurrency
- `Worker`: Individual worker that clones, implements, and pushes

**Process per worker:**
1. Clone repository to temporary directory
2. Create feature branch (`auto/{issue-number}-{slug}`)
3. Execute Claude Agent SDK with task instructions
4. Commit changes with descriptive message
5. Push branch to remote

**Parallelism:**
- Tasks are grouped by conflicting file paths
- Non-conflicting tasks run in parallel
- Configurable worker count (1-10, default: 4)

#### Phase 3: Evaluation

The evaluation phase verifies code quality before merge.

**Components:**
- `runBuild`: Executes `npm run build` and TypeScript compilation
- `runTests`: Runs test suite (`npm test`)
- `runHealthChecks`: HTTP health checks and smoke tests

**Gates:**
- Each step must pass before proceeding
- Configurable requirements (build, tests, health checks)
- Preview URL validation

#### Phase 4: PR Creation

Create and configure pull requests.

**Components:**
- `PRManager`: Pull request creation and management
- `BranchManager`: Branch protection compliance

**Features:**
- AI-generated PR descriptions
- Category labels (feature, bugfix, refactor, etc.)
- Issue linking
- Reviewer assignment from CODEOWNERS

#### Phase 5: Merge

Auto-merge successful changes with conflict resolution.

**Components:**
- `ConflictResolver`: Handles merge conflicts
- Merge strategies: `squash` (default), `merge`, `rebase`
- Conflict strategies: `rebase`, `merge`, `manual`

**Retry Logic:**
- Configurable retry attempts (1-5, default: 3)
- Exponential backoff between retries

## Data Flow

### Task Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TASK LIFECYCLE                                   │
│                                                                              │
│   [Codebase] ──▶ [Analysis] ──▶ [DiscoveredTask] ──▶ [GitHub Issue]         │
│                                        │                                     │
│                                        ▼                                     │
│                               [DeduplicatedTask]                             │
│                                        │                                     │
│                                        ▼                                     │
│                                 [WorkerTask]                                 │
│                                        │                                     │
│                                        ▼                                     │
│   [Clone] ──▶ [Branch] ──▶ [Implement] ──▶ [Commit] ──▶ [Push]              │
│                                        │                                     │
│                                        ▼                                     │
│                                 [WorkerResult]                               │
│                                        │                                     │
│                                        ▼                                     │
│   [Build] ──▶ [Test] ──▶ [Health] ──▶ [EvaluationResult]                    │
│                                        │                                     │
│                                        ▼                                     │
│                                 [Pull Request]                               │
│                                        │                                     │
│                                        ▼                                     │
│   [CI Checks] ──▶ [Review] ──▶ [Merge] ──▶ [Close Issue]                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Credential Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CREDENTIAL FLOW                                   │
│                                                                              │
│   Priority Order:                                                            │
│   1. Environment variables (highest)                                         │
│   2. Database lookup                                                         │
│   3. Config file (NOT recommended for secrets)                               │
│                                                                              │
│   ┌───────────────────┐                                                     │
│   │  Environment Vars │                                                     │
│   │                   │                                                     │
│   │  GITHUB_TOKEN     │──┐                                                  │
│   │  CLAUDE_ACCESS_   │  │                                                  │
│   │  CLAUDE_REFRESH_  │  │                                                  │
│   │  DATABASE_URL     │  │                                                  │
│   │  USER_EMAIL       │  │                                                  │
│   └───────────────────┘  │                                                  │
│                          │                                                  │
│   ┌───────────────────┐  │    ┌───────────────────┐                        │
│   │     Database      │  │    │   Config Object   │                        │
│   │                   │  ├───▶│                   │                        │
│   │  users.github_    │──┘    │  credentials: {   │                        │
│   │  users.claude_auth│       │    githubToken    │                        │
│   └───────────────────┘       │    claudeAuth     │                        │
│                               │  }                │                        │
│                               └───────────────────┘                        │
│                                        │                                    │
│                                        ▼                                    │
│                              ┌───────────────────┐                         │
│                              │  GitHub Client    │                         │
│                              │  Claude API       │                         │
│                              └───────────────────┘                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Module Reference

### Core Interfaces

#### Daemon

```typescript
interface DaemonOptions {
  configPath?: string;      // Path to config file
  dryRun?: boolean;         // Preview without executing
  verbose?: boolean;        // Enable debug logging
  singleCycle?: boolean;    // Run once then exit
  logFormat?: LogFormat;    // 'pretty' | 'json'
  monitoringPort?: number;  // Health check port
}

interface CycleResult {
  success: boolean;
  tasksDiscovered: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsMerged: number;
  duration: number;
  errors: string[];
  degraded: boolean;
  serviceHealth: DaemonServiceHealth;
}
```

#### Discovery

```typescript
interface DiscoveredTask {
  title: string;
  description: string;
  category: 'bug-fix' | 'feature' | 'enhancement' | 'refactor' | 'docs' | 'test';
  priority: 'high' | 'medium' | 'low';
  complexity: 'low' | 'medium' | 'high';
  affectedPaths: string[];
  estimatedMinutes: number;
}

interface CodebaseAnalysis {
  structure: DirectoryEntry[];
  todos: TodoComment[];
  dependencies: PackageInfo[];
  gitAnalysis: GitAnalysis;
}
```

#### GitHub

```typescript
interface GitHub {
  client: GitHubClient;
  issues: IssueManager;
  branches: BranchManager;
  pulls: PRManager;
}

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
}

interface PullRequest {
  number: number;
  title: string;
  head: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean;
}
```

#### Execution

```typescript
interface WorkerPoolOptions {
  maxWorkers: number;        // 1-10
  timeoutMinutes: number;    // 5-120
  workDir: string;
}

interface WorkerTask {
  issueNumber: number;
  title: string;
  description: string;
  branchName: string;
}

interface WorkerResult {
  success: boolean;
  issueNumber: number;
  branchName: string;
  commitSha?: string;
  error?: string;
  duration: number;
}
```

#### Evaluation

```typescript
interface EvaluationResult {
  success: boolean;
  build?: BuildResult;
  tests?: TestResult;
  health?: HealthCheckResult;
  duration: number;
  summary: string;
}

interface EvaluationOptions {
  repoPath: string;
  branchName: string;
  config: {
    requireBuild: boolean;
    requireTests: boolean;
    requireHealthCheck: boolean;
    healthCheckUrls: string[];
    previewUrlPattern: string;
  };
}
```

## External Dependencies

### Required Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **GitHub API** | Repository operations | `GITHUB_TOKEN` with `repo` scope |
| **Claude API** | AI analysis and implementation | `CLAUDE_ACCESS_TOKEN`, `CLAUDE_REFRESH_TOKEN` |

### Optional Services

| Service | Purpose | Configuration |
|---------|---------|---------------|
| **PostgreSQL** | Credential storage, sessions | `DATABASE_URL` |
| **MinIO** | File storage | `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, etc. |

### Resilience Patterns

#### Circuit Breaker

The GitHub client implements a circuit breaker pattern:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CIRCUIT BREAKER                                    │
│                                                                              │
│   CLOSED ──[failure]──▶ (count failures) ──[threshold]──▶ OPEN              │
│     ▲                                                        │               │
│     │                                                        │               │
│     │                                              [timeout] │               │
│     │                                                        ▼               │
│     │                                                   HALF-OPEN            │
│     │                                                        │               │
│     └──────────────────[success]─────────────────────────────┘               │
│                                                                              │
│   Configuration:                                                             │
│   • failureThreshold: 5 consecutive failures                                 │
│   • resetTimeoutMs: 60000 (60 seconds)                                       │
│   • successThreshold: 1 success to close                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deployment Architecture

### Monorepo Deployment

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DEPLOYMENT TOPOLOGY                                  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                           DOCKER SWARM                                │   │
│   │                                                                      │   │
│   │   ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │   │
│   │   │    Website    │    │ Internal API  │    │  AI Workers   │      │   │
│   │   │   (Replicas)  │    │    Server     │    │  (Ephemeral)  │      │   │
│   │   │               │    │               │    │               │      │   │
│   │   │  React + SSR  │───▶│  Express API  │───▶│ Claude Agent  │      │   │
│   │   │  Static serve │    │  Auth/Storage │    │ SDK execution │      │   │
│   │   └───────────────┘    └───────────────┘    └───────────────┘      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        INFRASTRUCTURE                                 │   │
│   │                                                                      │   │
│   │   ┌───────────────┐    ┌───────────────┐    ┌───────────────┐      │   │
│   │   │  PostgreSQL   │    │     MinIO     │    │    GitHub     │      │   │
│   │   │               │    │               │    │               │      │   │
│   │   │  • Users      │    │  • Sessions   │    │  • Repos      │      │   │
│   │   │  • Sessions   │    │  • Artifacts  │    │  • Issues     │      │   │
│   │   │  • Credentials│    │               │    │  • PRs        │      │   │
│   │   └───────────────┘    └───────────────┘    └───────────────┘      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### CLI Deployment

The Autonomous Dev CLI can run as:

1. **Interactive CLI**: Manual execution for testing
2. **Continuous Daemon**: Background service with `autonomous-dev start`
3. **Scheduled Job**: Cron or CI/CD with `autonomous-dev run`
4. **Process Manager**: PM2 or systemd for production

```bash
# Interactive
autonomous-dev run --verbose

# Daemon mode
autonomous-dev start

# Scheduled (cron)
0 */4 * * * autonomous-dev run

# PM2
pm2 start autonomous-dev --name "auto-dev" -- start
```

## See Also

- [Configuration Guide](./configuration.md) - Complete configuration reference
- [API Reference](./api-reference.md) - Detailed API documentation
- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions

---

*Documentation last updated: December 2025*
