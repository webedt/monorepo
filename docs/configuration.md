# Configuration Guide

This guide provides comprehensive documentation for all configuration options in the WebEDT Platform and Autonomous Development System.

For platform feature specifications, see SPEC.md (Dashboard: Section 2, Store: Section 3, Library: Section 4, Community: Section 5, Editor Suite: Section 6).

## Table of Contents

- [Configuration Methods](#configuration-methods)
- [Configuration File](#configuration-file)
- [Environment Variables](#environment-variables)
- [Configuration Schema](#configuration-schema)
  - [Repository Settings](#repository-settings-repo)
  - [Discovery Settings](#discovery-settings-discovery)
  - [Cache Settings](#cache-settings-cache)
  - [Execution Settings](#execution-settings-execution)
  - [Evaluation Settings](#evaluation-settings-evaluation)
  - [Merge Settings](#merge-settings-merge)
  - [Pull Request Settings](#pull-request-settings-pullrequest)
  - [Daemon Settings](#daemon-settings-daemon)
  - [Logging Settings](#logging-settings-logging)
  - [Alerting Settings](#alerting-settings-alerting)
  - [Metrics Settings](#metrics-settings-metrics)
  - [Circuit Breaker Settings](#circuit-breaker-settings-circuitbreaker)
- [Example Configurations](#example-configurations)
- [Configuration Validation](#configuration-validation)
- [Best Practices](#best-practices)

## Configuration Methods

Configuration is loaded from multiple sources with the following priority (highest to lowest):

1. **Environment Variables** - Highest priority, overrides all others
2. **Configuration File** - JSON file with structured settings
3. **Default Values** - Built-in defaults for all optional settings

### Configuration Priority Example

```
Environment: PARALLEL_WORKERS=8
Config file: "parallelWorkers": 4
Default: 4

Result: 8 (environment variable wins)
```

## Configuration File

### File Locations

The CLI searches for configuration files in this order:

1. Path specified with `-c/--config` option
2. `./autonomous-dev.config.json`
3. `./autonomous-dev.json`
4. `./.autonomous-dev.json`

### Creating a Configuration File

Use the interactive wizard:

```bash
autonomous-dev init
```

Or create manually:

```bash
cp autonomous-dev.config.example.json autonomous-dev.config.json
```

### Minimal Configuration

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo"
  }
}
```

All other settings use sensible defaults.

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `REPO_OWNER` | GitHub repository owner | `your-username` |
| `REPO_NAME` | GitHub repository name | `your-repo` |

### Authentication (choose one method)

**Method 1: Direct API Credentials**

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub personal access token | `ghp_xxxxxxxxxxxx` |
| `CLAUDE_ACCESS_TOKEN` | Claude API OAuth access token | `sk-ant-oat01-xxxx` |
| `CLAUDE_REFRESH_TOKEN` | Claude API OAuth refresh token | `sk-ant-ort01-xxxx` |

**Method 2: Database Credential Storage**

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `USER_EMAIL` | Email for credential lookup | `your.email@example.com` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REPO_BASE_BRANCH` | `main` | Base branch for pull requests |
| `PARALLEL_WORKERS` | `4` | Number of parallel workers (1-10) |
| `TASKS_PER_CYCLE` | `5` | Tasks to discover per cycle (1-10) |
| `MAX_OPEN_ISSUES` | `10` | Maximum open issues before pausing |
| `WORK_DIR` | `/tmp/autonomous-dev` | Working directory for execution |
| `TIMEOUT_MINUTES` | `30` | Task timeout in minutes (5-120) |
| `REQUIRE_BUILD` | `true` | Require build to pass |
| `REQUIRE_TESTS` | `true` | Require tests to pass |
| `REQUIRE_HEALTH_CHECK` | `true` | Require health checks to pass |
| `AUTO_MERGE` | `true` | Auto-merge passing PRs |
| `MERGE_METHOD` | `squash` | Git merge method |
| `CONFLICT_STRATEGY` | `rebase` | Conflict resolution strategy |
| `LOOP_INTERVAL_MS` | `60000` | Interval between cycles (ms) |
| `PREVIEW_URL_PATTERN` | See below | Preview deployment URL pattern |

## Configuration Schema

### Repository Settings (`repo`)

Configure the target GitHub repository.

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo",
    "baseBranch": "main"
  }
}
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `owner` | string | Yes | - | GitHub username or organization |
| `name` | string | Yes | - | Repository name |
| `baseBranch` | string | No | `main` | Base branch for PRs |

### Discovery Settings (`discovery`)

Control how tasks are discovered and managed.

```json
{
  "discovery": {
    "tasksPerCycle": 5,
    "maxOpenIssues": 10,
    "excludePaths": ["node_modules", "dist", ".git", "coverage", "*.lock"],
    "issueLabel": "autonomous-dev",
    "maxDepth": 10,
    "maxFiles": 10000
  }
}
```

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `tasksPerCycle` | number | `5` | 1-10 | Tasks to discover per cycle |
| `maxOpenIssues` | number | `10` | 1+ | Max open issues before pausing |
| `excludePaths` | string[] | See above | - | Paths to exclude from analysis |
| `issueLabel` | string | `autonomous-dev` | - | Label for auto-created issues |
| `maxDepth` | number | `10` | 1-20 | Maximum directory depth to scan |
| `maxFiles` | number | `10000` | 100-50000 | Maximum files to scan |

#### Exclude Paths Patterns

```json
{
  "excludePaths": [
    "node_modules",       // Directory name
    "dist",               // Build output
    ".git",               // Git directory
    "coverage",           // Test coverage
    "*.lock",             // Lock files
    "packages/legacy/**", // Glob patterns
    "**/*.min.js"         // Minified files
  ]
}
```

### Cache Settings (`cache`)

Configure caching for improved performance.

```json
{
  "cache": {
    "enabled": true,
    "maxEntries": 100,
    "ttlMinutes": 30,
    "maxSizeMB": 100,
    "cacheDir": ".autonomous-dev-cache",
    "persistToDisk": true,
    "useGitInvalidation": true,
    "enableIncrementalAnalysis": true,
    "warmOnStartup": true
  }
}
```

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `enabled` | boolean | `true` | - | Enable caching |
| `maxEntries` | number | `100` | 1-1000 | Max cached entries |
| `ttlMinutes` | number | `30` | 1-1440 | Cache TTL in minutes |
| `maxSizeMB` | number | `100` | 10-1000 | Max cache size in MB |
| `cacheDir` | string | `.autonomous-dev-cache` | - | Cache directory |
| `persistToDisk` | boolean | `true` | - | Persist cache to disk |
| `useGitInvalidation` | boolean | `true` | - | Invalidate on git changes |
| `enableIncrementalAnalysis` | boolean | `true` | - | Analyze only changed files |
| `warmOnStartup` | boolean | `true` | - | Pre-populate cache on start |

### Execution Settings (`execution`)

Control how tasks are executed.

```json
{
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 30,
    "workDir": "/tmp/autonomous-dev"
  }
}
```

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `parallelWorkers` | number | `4` | 1-10 | Number of parallel workers |
| `timeoutMinutes` | number | `30` | 5-120 | Task timeout in minutes |
| `workDir` | string | `/tmp/autonomous-dev` | - | Working directory |

#### Worker Count Guidelines

| Workers | Use Case | Memory Requirement |
|---------|----------|-------------------|
| 1-2 | Small codebases, low resources | 2-4 GB |
| 3-4 | Standard codebases (recommended) | 4-8 GB |
| 5-8 | Large codebases, high throughput | 8-16 GB |
| 9-10 | Enterprise, dedicated resources | 16+ GB |

### Evaluation Settings (`evaluation`)

Control quality checks before merging.

```json
{
  "evaluation": {
    "requireBuild": true,
    "requireTests": true,
    "requireHealthCheck": true,
    "requireSmokeTests": false,
    "healthCheckUrls": [],
    "smokeTestUrls": [],
    "previewUrlPattern": "https://preview.your-domain.com/{owner}/{repo}/{branch}/"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `requireBuild` | boolean | `true` | Require build to pass |
| `requireTests` | boolean | `true` | Require tests to pass |
| `requireHealthCheck` | boolean | `true` | Require health checks |
| `requireSmokeTests` | boolean | `false` | Require smoke tests |
| `healthCheckUrls` | string[] | `[]` | URLs for health checks |
| `smokeTestUrls` | string[] | `[]` | URLs for smoke tests |
| `previewUrlPattern` | string | See below | Preview URL template |

#### Preview URL Pattern

The pattern supports these placeholders:

- `{owner}` - Repository owner
- `{repo}` - Repository name
- `{branch}` - Branch name (slashes replaced with hyphens)

Example: `https://preview.example.com/{owner}/{repo}/{branch}/`

### Merge Settings (`merge`)

Control how pull requests are merged.

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

| Option | Type | Default | Options | Description |
|--------|------|---------|---------|-------------|
| `autoMerge` | boolean | `true` | - | Auto-merge passing PRs |
| `requireAllChecks` | boolean | `true` | - | Wait for all CI checks |
| `maxRetries` | number | `3` | 1-5 | Merge retry attempts |
| `conflictStrategy` | string | `rebase` | `rebase`, `merge`, `manual` | Conflict handling |
| `mergeMethod` | string | `squash` | `merge`, `squash`, `rebase` | Git merge method |

#### Merge Methods

| Method | Description | Best For |
|--------|-------------|----------|
| `squash` | Combine all commits into one | Clean history, default |
| `merge` | Create merge commit | Preserving commit history |
| `rebase` | Rebase then fast-forward | Linear history |

#### Conflict Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `rebase` | Automatically rebase on main | Most cases |
| `merge` | Attempt automatic merge | Complex merges |
| `manual` | Skip, require human review | Critical repos |

### Pull Request Settings (`pullRequest`)

Advanced PR configuration.

```json
{
  "pullRequest": {
    "useDraftPRs": false,
    "autoAssignReviewers": true,
    "usePRTemplate": true,
    "generateDescription": true,
    "addCategoryLabels": true,
    "addPriorityLabels": false,
    "defaultPriority": "medium",
    "checkBranchProtection": true,
    "additionalLabels": ["autonomous-dev"],
    "defaultReviewers": [],
    "maxReviewers": 5,
    "linkIssue": true,
    "includeChangedFiles": true,
    "maxChangedFilesInDescription": 10
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `useDraftPRs` | boolean | `false` | Create PRs as drafts |
| `autoAssignReviewers` | boolean | `true` | Assign from CODEOWNERS |
| `usePRTemplate` | boolean | `true` | Use PR template |
| `generateDescription` | boolean | `true` | AI-generated descriptions |
| `addCategoryLabels` | boolean | `true` | Add category labels |
| `addPriorityLabels` | boolean | `false` | Add priority labels |
| `defaultPriority` | string | `medium` | Default priority level |
| `checkBranchProtection` | boolean | `true` | Check protection rules |
| `additionalLabels` | string[] | `["autonomous-dev"]` | Extra labels |
| `defaultReviewers` | string[] | `[]` | Default reviewers |
| `maxReviewers` | number | `5` | Max reviewers (1-15) |
| `linkIssue` | boolean | `true` | Link related issue |
| `includeChangedFiles` | boolean | `true` | List changed files |
| `maxChangedFilesInDescription` | number | `10` | Max files to list |

### Daemon Settings (`daemon`)

Control the continuous daemon mode.

```json
{
  "daemon": {
    "loopIntervalMs": 60000,
    "pauseBetweenCycles": true
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `loopIntervalMs` | number | `60000` | Interval between cycles (ms) |
| `pauseBetweenCycles` | boolean | `true` | Pause between cycles |

### Logging Settings (`logging`)

Configure log output.

```json
{
  "logging": {
    "format": "pretty",
    "level": "info",
    "includeCorrelationId": true,
    "includeTimestamp": true,
    "enableStructuredFileLogging": false,
    "structuredLogDir": "./logs",
    "maxLogFileSizeBytes": 10485760,
    "maxLogFiles": 5,
    "includeMetrics": true,
    "rotationPolicy": "size",
    "rotationInterval": "daily",
    "maxLogAgeDays": 30
  }
}
```

| Option | Type | Default | Options | Description |
|--------|------|---------|---------|-------------|
| `format` | string | `pretty` | `pretty`, `json` | Log output format |
| `level` | string | `info` | `debug`, `info`, `warn`, `error` | Minimum log level |
| `includeCorrelationId` | boolean | `true` | - | Include correlation IDs |
| `includeTimestamp` | boolean | `true` | - | Include timestamps |
| `enableStructuredFileLogging` | boolean | `false` | - | Write structured logs to file |
| `structuredLogDir` | string | `./logs` | - | Log directory |
| `maxLogFileSizeBytes` | number | `10485760` | 1MB-1GB | Max log file size |
| `maxLogFiles` | number | `5` | 1-100 | Log files to retain |
| `includeMetrics` | boolean | `true` | - | Include metrics in logs |
| `rotationPolicy` | string | `size` | `size`, `time`, `both` | Rotation policy |
| `rotationInterval` | string | `daily` | `hourly`, `daily`, `weekly` | Time-based rotation |
| `maxLogAgeDays` | number | `30` | 1-365 | Max log age in days |

### Alerting Settings (`alerting`)

Configure alerting for failures.

```json
{
  "alerting": {
    "enabled": true,
    "webhookUrl": "https://hooks.slack.com/...",
    "alertLogPath": "./alerts.log",
    "cooldownMs": 60000,
    "maxAlertsPerMinute": 30,
    "consoleOutput": true,
    "webhookMinSeverity": "error"
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable alerting |
| `webhookUrl` | string | - | Webhook URL for alerts |
| `alertLogPath` | string | - | File for alert logs |
| `cooldownMs` | number | `60000` | Min interval between alerts |
| `maxAlertsPerMinute` | number | `30` | Rate limit |
| `consoleOutput` | boolean | `true` | Log alerts to console |
| `webhookMinSeverity` | string | `error` | Min severity for webhooks |

### Metrics Settings (`metrics`)

Configure metrics collection.

```json
{
  "metrics": {
    "enableRegressionDetection": true,
    "regressionThresholdPercent": 20,
    "enableComplexityTracking": true,
    "baselineSampleSize": 100,
    "enableDashboard": true,
    "metricsPort": 9090
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableRegressionDetection` | boolean | `true` | Detect regressions |
| `regressionThresholdPercent` | number | `20` | Regression threshold % |
| `enableComplexityTracking` | boolean | `true` | Track task complexity |
| `baselineSampleSize` | number | `100` | Samples for baseline |
| `enableDashboard` | boolean | `true` | Enable metrics endpoint |
| `metricsPort` | number | `9090` | Metrics HTTP port |

### Circuit Breaker Settings (`circuitBreaker`)

Configure resilience for API calls.

```json
{
  "circuitBreaker": {
    "failureThreshold": 5,
    "resetTimeoutMs": 60000,
    "baseDelayMs": 100,
    "maxDelayMs": 30000,
    "successThreshold": 1,
    "enabled": true
  }
}
```

| Option | Type | Default | Range | Description |
|--------|------|---------|-------|-------------|
| `failureThreshold` | number | `5` | 1-20 | Failures to open circuit |
| `resetTimeoutMs` | number | `60000` | 10s-5min | Reset timeout |
| `baseDelayMs` | number | `100` | 50-1000 | Base backoff delay |
| `maxDelayMs` | number | `30000` | 5s-60s | Max backoff delay |
| `successThreshold` | number | `1` | 1-5 | Successes to close |
| `enabled` | boolean | `true` | - | Enable circuit breaker |

## Example Configurations

### Minimal Setup

```json
{
  "repo": {
    "owner": "your-username",
    "name": "your-repo"
  }
}
```

### Conservative (Production)

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
  "evaluation": {
    "requireBuild": true,
    "requireTests": true,
    "requireHealthCheck": true,
    "requireSmokeTests": true
  },
  "merge": {
    "autoMerge": false,
    "mergeMethod": "merge"
  },
  "pullRequest": {
    "useDraftPRs": true,
    "autoAssignReviewers": true
  }
}
```

### Aggressive (Side Projects)

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

### Monorepo

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
      "packages/legacy/**",
      "**/test-fixtures/**"
    ],
    "maxDepth": 15,
    "maxFiles": 25000
  },
  "execution": {
    "parallelWorkers": 4,
    "timeoutMinutes": 45
  },
  "evaluation": {
    "previewUrlPattern": "https://preview.example.com/{owner}/{repo}/{branch}/"
  }
}
```

### CI/CD Scheduled Run

```json
{
  "repo": {
    "owner": "your-org",
    "name": "your-repo"
  },
  "discovery": {
    "tasksPerCycle": 3,
    "maxOpenIssues": 10
  },
  "execution": {
    "parallelWorkers": 2,
    "timeoutMinutes": 20
  },
  "merge": {
    "autoMerge": true,
    "maxRetries": 2
  },
  "logging": {
    "format": "json",
    "level": "info"
  }
}
```

## Configuration Validation

### Validate Configuration

```bash
# Validate current configuration
autonomous-dev config --validate

# Show current configuration
autonomous-dev config

# Show config help
autonomous-dev help-config
```

### Common Validation Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Repository owner is required` | Missing `repo.owner` | Add owner to config or `REPO_OWNER` env |
| `Repository name is required` | Missing `repo.name` | Add name to config or `REPO_NAME` env |
| `Maximum 10 workers` | `parallelWorkers > 10` | Reduce worker count |
| `Timeout must be at least 5 minutes` | `timeoutMinutes < 5` | Increase timeout |

## Best Practices

### Security

1. **Never store credentials in config files**
   ```json
   // ❌ WRONG
   {
     "credentials": {
       "githubToken": "ghp_xxxx"
     }
   }

   // ✅ RIGHT - Use environment variables
   export GITHUB_TOKEN=ghp_xxxx
   ```

2. **Use database credential storage for teams**
   ```bash
   DATABASE_URL=postgresql://...
   USER_EMAIL=team@example.com
   ```

3. **Add config files to .gitignore**
   ```
   # .gitignore
   autonomous-dev.config.json
   .autonomous-dev.json
   ```

### Performance

1. **Tune worker count to resources**
   ```json
   {
     "execution": {
       "parallelWorkers": 4  // Match available CPU/memory
     }
   }
   ```

2. **Enable caching**
   ```json
   {
     "cache": {
       "enabled": true,
       "persistToDisk": true
     }
   }
   ```

3. **Optimize exclude paths**
   ```json
   {
     "discovery": {
       "excludePaths": [
         "node_modules",
         "dist",
         "coverage",
         "**/*.min.js",
         "**/fixtures/**"
       ]
     }
   }
   ```

### Reliability

1. **Enable circuit breaker**
   ```json
   {
     "circuitBreaker": {
       "enabled": true,
       "failureThreshold": 5
     }
   }
   ```

2. **Set reasonable timeouts**
   ```json
   {
     "execution": {
       "timeoutMinutes": 30
     }
   }
   ```

3. **Configure alerting**
   ```json
   {
     "alerting": {
       "enabled": true,
       "webhookUrl": "https://hooks.slack.com/..."
     }
   }
   ```

## See Also

- [Architecture Documentation](./architecture.md) - System architecture overview
- [API Reference](./api-reference.md) - Detailed API documentation
- [Troubleshooting Guide](./troubleshooting.md) - Common issues and solutions

---

*Documentation last updated: December 2025*
