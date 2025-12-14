# API Reference

This document provides detailed API documentation for the WebEDT Platform and Autonomous Development System's key interfaces, classes, and modules.

The WebEDT Platform includes a Dashboard (Section 2), Store/Marketplace (Section 3), Library (Section 4), Community (Section 5), and Editor Suite (Section 6) as defined in SPEC.md. The autonomous development system powers continuous AI-driven code improvement.

## Table of Contents

- [CLI Commands](#cli-commands)
- [Core Modules](#core-modules)
  - [Daemon](#daemon)
  - [Config](#config)
  - [Discovery](#discovery)
  - [GitHub](#github)
  - [Executor](#executor)
  - [Evaluation](#evaluation)
  - [Conflicts](#conflicts)
- [TypeScript Interfaces](#typescript-interfaces)
- [AI Coding Worker API](#ai-coding-worker-api)
- [Internal API Server](#internal-api-server)

## CLI Commands

### `autonomous-dev start`

Start the continuous daemon that runs development cycles indefinitely.

```bash
autonomous-dev start [options]
```

**Options:**

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--config <path>` | `-c` | - | Path to configuration file |
| `--verbose` | `-v` | `false` | Enable verbose debug logging |
| `--dry-run` | - | `false` | Discover tasks without executing |
| `--log-format <format>` | - | `pretty` | Log format: `pretty` or `json` |

**Examples:**

```bash
# Start daemon with defaults
autonomous-dev start

# Start with verbose logging
autonomous-dev start --verbose

# Start in dry-run mode
autonomous-dev start --dry-run

# Start with custom config
autonomous-dev start -c ./production.config.json

# Start with JSON logging (for log aggregators)
autonomous-dev start --log-format json
```

**Signals:**

- `SIGINT` (Ctrl+C): Graceful shutdown after current cycle
- `SIGTERM`: Graceful shutdown after current cycle

---

### `autonomous-dev run`

Run a single development cycle and exit.

```bash
autonomous-dev run [options]
```

**Options:**

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--config <path>` | `-c` | - | Path to configuration file |
| `--verbose` | `-v` | `false` | Enable verbose logging |
| `--dry-run` | - | `false` | Discover without executing |

**Examples:**

```bash
# Run single cycle
autonomous-dev run

# Run with dry-run
autonomous-dev run --dry-run

# For cron jobs (every 4 hours)
# 0 */4 * * * cd /path/to/repo && autonomous-dev run
```

---

### `autonomous-dev discover`

Discover development tasks without executing them.

```bash
autonomous-dev discover [options]
```

**Options:**

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--config <path>` | `-c` | - | Configuration file path |
| `--verbose` | `-v` | `false` | Enable verbose output |
| `--count <number>` | `-n` | `5` | Number of tasks to discover |
| `--create-issues` | - | `false` | Create GitHub issues for tasks |

**Examples:**

```bash
# Discover 5 tasks (default)
autonomous-dev discover

# Discover 10 tasks
autonomous-dev discover -n 10

# Discover and create issues
autonomous-dev discover --create-issues

# Verbose output
autonomous-dev discover -v --count 3
```

**Output:**

```
╭─────────────────────────────────────────────────────────────────────╮
│ Discovered Tasks                                                      │
├─────────────────────────────────────────────────────────────────────┤
│ 1. [feature/high] Add input validation to user registration          │
│    Affected: src/auth/register.ts, src/utils/validation.ts          │
│    Complexity: medium | Est: 30 min                                  │
├─────────────────────────────────────────────────────────────────────┤
│ 2. [bug-fix/medium] Fix memory leak in WebSocket handler             │
│    Affected: src/websocket/handler.ts                               │
│    Complexity: low | Est: 15 min                                     │
╰─────────────────────────────────────────────────────────────────────╯
```

---

### `autonomous-dev status`

Show current status of autonomous development.

```bash
autonomous-dev status [options]
```

**Options:**

| Option | Short | Description |
|--------|-------|-------------|
| `--config <path>` | `-c` | Configuration file path |

**Output:**

```
╭─────────────────────────────────────────────────────────────────────╮
│ Autonomous Dev Status                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ Repository: owner/repo                                               │
│ Base Branch: main                                                    │
├─────────────────────────────────────────────────────────────────────┤
│ Open Issues: 5 (3 pending, 2 in progress)                           │
│ Active PRs: 2                                                        │
│ Merged Today: 8                                                      │
╰─────────────────────────────────────────────────────────────────────╯
```

---

### `autonomous-dev config`

Show or validate configuration.

```bash
autonomous-dev config [options]
```

**Options:**

| Option | Short | Description |
|--------|-------|-------------|
| `--config <path>` | `-c` | Configuration file path |
| `--validate` | - | Only validate, don't display |

**Examples:**

```bash
# Show current config
autonomous-dev config

# Validate config
autonomous-dev config --validate
```

---

### `autonomous-dev init`

Initialize a new configuration file interactively.

```bash
autonomous-dev init [options]
```

**Options:**

| Option | Short | Description |
|--------|-------|-------------|
| `--force` | - | Overwrite existing config |
| `--output <path>` | `-o` | Custom output path |

**Examples:**

```bash
# Interactive setup
autonomous-dev init

# Overwrite existing
autonomous-dev init --force

# Custom path
autonomous-dev init -o ./configs/prod.json
```

---

### `autonomous-dev help-config`

Show detailed help for all configuration options.

```bash
autonomous-dev help-config
```

## Core Modules

### Daemon

The main daemon class that orchestrates the development lifecycle.

#### `Daemon` Class

```typescript
import { Daemon, DaemonOptions, CycleResult } from 'autonomous-dev-cli';

const daemon = new Daemon(options);
await daemon.start();
```

#### `DaemonOptions` Interface

```typescript
interface DaemonOptions {
  configPath?: string;      // Path to config file
  dryRun?: boolean;         // Preview without executing
  verbose?: boolean;        // Enable debug logging
  singleCycle?: boolean;    // Run once then exit
  logFormat?: 'pretty' | 'json';
  monitoringPort?: number;  // Health check port
}
```

#### `CycleResult` Interface

```typescript
interface CycleResult {
  success: boolean;         // Overall cycle success
  tasksDiscovered: number;  // Tasks found
  tasksCompleted: number;   // Tasks successfully completed
  tasksFailed: number;      // Tasks that failed
  prsMerged: number;        // PRs merged this cycle
  duration: number;         // Cycle duration in ms
  errors: string[];         // Error messages
  degraded: boolean;        // Running in degraded mode
  serviceHealth: DaemonServiceHealth;
}
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Start the daemon |
| `stop()` | `Promise<void>` | Gracefully stop the daemon |
| `runCycle()` | `Promise<CycleResult>` | Run a single cycle |

---

### Config

Configuration loading and validation.

#### `loadConfig` Function

```typescript
import { loadConfig, Config } from 'autonomous-dev-cli/config';

const config: Config = loadConfig(configPath);
```

#### `Config` Type

```typescript
interface Config {
  version: number;
  repo: {
    owner: string;
    name: string;
    baseBranch: string;
  };
  discovery: {
    tasksPerCycle: number;
    maxOpenIssues: number;
    excludePaths: string[];
    issueLabel: string;
    maxDepth: number;
    maxFiles: number;
  };
  cache: CacheConfig;
  execution: ExecutionConfig;
  evaluation: EvaluationConfig;
  merge: MergeConfig;
  pullRequest: PullRequestConfig;
  daemon: DaemonConfig;
  logging: LoggingConfig;
  alerting: AlertingConfig;
  metrics: MetricsConfig;
  circuitBreaker: CircuitBreakerConfig;
  credentials: CredentialsConfig;
}
```

---

### Discovery

Task discovery using Claude AI analysis.

#### `discoverTasks` Function

```typescript
import { discoverTasks, DiscoveredTask } from 'autonomous-dev-cli/discovery';

const tasks: DiscoveredTask[] = await discoverTasks({
  repoPath: '/path/to/repo',
  excludePaths: ['node_modules'],
  tasksPerCycle: 5,
  claudeAuth: { accessToken, refreshToken },
});
```

#### `DiscoveredTask` Interface

```typescript
interface DiscoveredTask {
  title: string;
  description: string;
  category: DiscoveredTaskCategory;
  priority: DiscoveredTaskPriority;
  complexity: DiscoveredTaskComplexity;
  affectedPaths: string[];
  estimatedMinutes: number;
}

type DiscoveredTaskCategory =
  | 'bug-fix'
  | 'feature'
  | 'enhancement'
  | 'refactor'
  | 'docs'
  | 'test';

type DiscoveredTaskPriority = 'high' | 'medium' | 'low';

type DiscoveredTaskComplexity = 'low' | 'medium' | 'high';
```

#### `CodebaseAnalyzer` Class

```typescript
import { CodebaseAnalyzer, CodebaseAnalysis } from 'autonomous-dev-cli/discovery';

const analyzer = new CodebaseAnalyzer({
  excludePaths: ['node_modules'],
  maxDepth: 10,
  maxFiles: 10000,
});

const analysis: CodebaseAnalysis = await analyzer.analyze('/path/to/repo');
```

#### `CodebaseAnalysis` Interface

```typescript
interface CodebaseAnalysis {
  structure: DirectoryEntry[];
  todos: TodoComment[];
  dependencies: PackageInfo[];
  gitAnalysis: GitAnalysis;
}

interface DirectoryEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: DirectoryEntry[];
}

interface TodoComment {
  file: string;
  line: number;
  text: string;
  type: 'TODO' | 'FIXME' | 'HACK' | 'BUG';
}

interface GitAnalysis {
  recentCommits: GitCommitInfo[];
  fileChanges: FileChangeStats[];
  dependencies: DependencyGraph;
}
```

#### `TaskDeduplicator` Class

```typescript
import {
  createDeduplicator,
  getParallelSafeTasks,
  DeduplicatedTask
} from 'autonomous-dev-cli/discovery';

const deduplicator = createDeduplicator();
const deduplicated: DeduplicatedTask[] = deduplicator.deduplicate(tasks);

// Get tasks safe for parallel execution
const safeTasks = getParallelSafeTasks(deduplicated);
```

---

### GitHub

GitHub API integration via Octokit.

#### `createGitHub` Function

```typescript
import { createGitHub, GitHub } from 'autonomous-dev-cli/github';

const github: GitHub = createGitHub({
  token: process.env.GITHUB_TOKEN,
  owner: 'your-username',
  repo: 'your-repo',
});
```

#### `GitHub` Interface

```typescript
interface GitHub {
  client: GitHubClient;
  issues: IssueManager;
  branches: BranchManager;
  pulls: PRManager;
}
```

#### `IssueManager` Interface

```typescript
interface IssueManager {
  list(options?: ListIssuesOptions): Promise<Issue[]>;
  get(issueNumber: number): Promise<Issue>;
  create(options: CreateIssueOptions): Promise<Issue>;
  update(issueNumber: number, options: UpdateIssueOptions): Promise<Issue>;
  close(issueNumber: number): Promise<Issue>;
  addLabels(issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(issueNumber: number, label: string): Promise<void>;
}

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}
```

#### `BranchManager` Interface

```typescript
interface BranchManager {
  list(): Promise<Branch[]>;
  get(name: string): Promise<Branch>;
  create(options: CreateBranchOptions): Promise<Branch>;
  delete(name: string): Promise<void>;
  getProtection(name: string): Promise<BranchProtectionRules>;
  checkMergeReadiness(options: MergeReadinessOptions): Promise<MergeReadiness>;
}

interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

interface CreateBranchOptions {
  name: string;
  baseBranch?: string;
  baseSha?: string;
}
```

#### `PRManager` Interface

```typescript
interface PRManager {
  list(options?: ListPRsOptions): Promise<PullRequest[]>;
  get(prNumber: number): Promise<PullRequest>;
  create(options: CreatePROptions): Promise<PullRequest>;
  update(prNumber: number, options: UpdatePROptions): Promise<PullRequest>;
  merge(prNumber: number, options: MergePROptions): Promise<MergeResult>;
  requestReviewers(prNumber: number, reviewers: string[]): Promise<void>;
  getChecks(prNumber: number): Promise<CheckStatus[]>;
}

interface PullRequest {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean;
  draft: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CreatePROptions {
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

interface MergeResult {
  merged: boolean;
  sha?: string;
  message?: string;
  error?: string;
}
```

---

### Executor

Worker pool for parallel task execution.

#### `createWorkerPool` Function

```typescript
import { createWorkerPool, WorkerPool, PoolResult } from 'autonomous-dev-cli/executor';

const pool: WorkerPool = createWorkerPool({
  maxWorkers: 4,
  timeoutMinutes: 30,
  workDir: '/tmp/autonomous-dev',
});

const results: PoolResult[] = await pool.execute(tasks);
```

#### `WorkerPool` Interface

```typescript
interface WorkerPool {
  execute(tasks: WorkerTask[]): Promise<PoolResult[]>;
  cancel(): void;
  getStatus(): WorkerPoolStatus;
}

interface WorkerPoolOptions {
  maxWorkers: number;
  timeoutMinutes: number;
  workDir: string;
}

interface WorkerPoolStatus {
  activeWorkers: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
}
```

#### `WorkerTask` Interface

```typescript
interface WorkerTask {
  issueNumber: number;
  title: string;
  description: string;
  branchName: string;
  affectedPaths: string[];
  category: string;
  priority: string;
}

interface WorkerResult {
  success: boolean;
  issueNumber: number;
  branchName: string;
  commitSha?: string;
  error?: string;
  duration: number;
}

interface PoolResult extends WorkerResult {
  metadata: TaskMetadata;
}
```

---

### Evaluation

Build, test, and health check verification.

#### `runEvaluation` Function

```typescript
import { runEvaluation, EvaluationResult } from 'autonomous-dev-cli/evaluation';

const result: EvaluationResult = await runEvaluation({
  repoPath: '/path/to/repo',
  branchName: 'auto/42-fix-bug',
  config: {
    requireBuild: true,
    requireTests: true,
    requireHealthCheck: true,
    healthCheckUrls: [],
    previewUrlPattern: 'https://preview.example.com/{owner}/{repo}/{branch}/',
  },
  repoInfo: {
    owner: 'your-username',
    repo: 'your-repo',
  },
});
```

#### `EvaluationResult` Interface

```typescript
interface EvaluationResult {
  success: boolean;
  build?: BuildResult;
  tests?: TestResult;
  health?: HealthCheckResult;
  duration: number;
  summary: string;
}

interface BuildResult {
  success: boolean;
  duration: number;
  error?: string;
  output?: string;
}

interface TestResult {
  success: boolean;
  duration: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  coverage?: number;
}

interface HealthCheckResult {
  success: boolean;
  checks: HealthCheck[];
}

interface HealthCheck {
  url: string;
  ok: boolean;
  status?: number;
  duration: number;
  error?: string;
}
```

---

### Conflicts

Merge conflict resolution.

#### `createConflictResolver` Function

```typescript
import { createConflictResolver, ConflictResolver } from 'autonomous-dev-cli/conflicts';

const resolver: ConflictResolver = createConflictResolver({
  strategy: 'rebase',
  maxRetries: 3,
});

const result = await resolver.resolve({
  repoPath: '/path/to/repo',
  sourceBranch: 'auto/42-fix-bug',
  targetBranch: 'main',
});
```

## TypeScript Interfaces

### Complete Type Definitions

```typescript
// Config Types
type LogFormat = 'pretty' | 'json';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type MergeMethod = 'merge' | 'squash' | 'rebase';
type ConflictStrategy = 'rebase' | 'merge' | 'manual';
type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';
type RotationPolicy = 'size' | 'time' | 'both';
type RotationInterval = 'hourly' | 'daily' | 'weekly';

// Service Health
interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  latencyMs: number;
  lastCheck: Date;
  consecutiveFailures: number;
}

// Circuit Breaker State
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  lastFailure?: Date;
  nextAttempt?: Date;
}

// Error Types
interface StructuredError {
  code: ErrorCode;
  message: string;
  context?: ErrorContext;
  cause?: Error;
}

type ErrorCode =
  | 'GITHUB_API_ERROR'
  | 'CLAUDE_API_ERROR'
  | 'CONFIG_ERROR'
  | 'BUILD_FAILED'
  | 'TESTS_FAILED'
  | 'MERGE_CONFLICT'
  | 'TIMEOUT'
  | 'UNKNOWN';
```

## AI Coding Worker API

The AI Coding Worker exposes HTTP endpoints for LLM execution.

### Endpoints

#### `POST /execute`

Execute an AI coding request with SSE response.

**Request:**

```typescript
interface ExecuteRequest {
  userRequest: string;
  codingAssistantProvider: 'ClaudeAgentSDK' | 'Codex' | 'Gemini';
  codingAssistantAuthentication: string; // JSON stringified auth
  github: {
    repoUrl: string;
    branch: string;
    token?: string;
  };
  sessionId?: string;
  workspacePath?: string;
}
```

**Example:**

```bash
curl -X POST http://localhost:5001/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userRequest": "Add error handling to the login function",
    "codingAssistantProvider": "ClaudeAgentSDK",
    "codingAssistantAuthentication": "{\"claudeAiOauth\":{...}}",
    "github": {
      "repoUrl": "https://github.com/user/repo.git",
      "branch": "main"
    }
  }'
```

**Response (SSE):**

```
event: connected
data: {"sessionId": "abc123"}

event: message
data: {"stage": "cloning", "message": "Cloning repository..."}

event: assistant_message
data: {"content": "I'll add try-catch blocks..."}

event: completed
data: {"success": true, "commitSha": "abc123"}
```

#### `GET /health`

Health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "uptime": 3600,
  "version": "1.0.0"
}
```

#### `GET /status`

Worker status.

**Response:**

```json
{
  "busy": false,
  "currentSession": null,
  "completedJobs": 42
}
```

### SSE Event Types

| Event | Description |
|-------|-------------|
| `connected` | Initial connection established |
| `message` | Progress messages with stage info |
| `session_name` | Generated session title |
| `assistant_message` | LLM output |
| `completed` | Job finished |
| `error` | Error occurred |

### Stage Types

| Stage | Emoji | Description |
|-------|-------|-------------|
| `preparing` | 🔧 | Initialization |
| `downloading_session` | 📥 | Downloading from storage |
| `cloning` | 📥 | Cloning repository |
| `generating_name` | 🤖 | Generating session name |
| `creating_branch` | 🌿 | Creating git branch |
| `pushing` | 📤 | Pushing to remote |
| `committing` | 💾 | Creating commit |
| `error` | ❌ | Operation failed |

## Internal API Server

The Internal API Server provides the central backend API.

### Endpoints

#### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/register` | POST | Register new user |
| `/api/auth/login` | POST | User login |
| `/api/auth/logout` | POST | User logout |
| `/api/auth/session` | GET | Get current session |

#### Sessions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | List user sessions |
| `/api/sessions/:id` | GET | Get session by ID |
| `/api/sessions/:id` | DELETE | Delete session |

#### Execution

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/execute` | POST | Execute AI request (SSE) |
| `/api/resume/:sessionId` | GET | Resume/replay session (SSE) |

#### GitHub

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/github/repos` | GET | List user repositories |
| `/api/github/branches/:owner/:repo` | GET | List branches |
| `/api/github/oauth/callback` | GET | OAuth callback |

#### Storage

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/storage/sessions/:path/files` | GET | List files |
| `/api/storage/sessions/:path/files/*` | GET | Read file |
| `/api/storage/sessions/:path/files/*` | PUT | Write file |
| `/api/storage/sessions/:path/files/*` | DELETE | Delete file |

### Health Check

```
GET /health
```

**Response:**

```json
{
  "status": "healthy",
  "services": {
    "database": "connected",
    "storage": "connected",
    "worker": "available"
  }
}
```

## See Also

- [Architecture Documentation](./architecture.md) - System architecture overview
- [Configuration Guide](./configuration.md) - Complete configuration reference
- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions

---

*Documentation last updated: December 14, 2025*
