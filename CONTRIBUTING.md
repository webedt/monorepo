# Contributing to Autonomous Development System

Thank you for your interest in contributing to the Autonomous Development System! This document provides guidelines and information to help you contribute effectively.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to:

- Be respectful and considerate in communications
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm or pnpm
- Git
- Docker (for worker services)
- PostgreSQL (for database features)

### Repository Structure

```
monorepo/
├── autonomous-dev-cli/    # Main CLI tool
├── ai-coding-worker/      # AI execution worker
├── internal-api-server/   # Backend API server
├── website/               # React frontend
├── shared/                # Shared utilities
├── docs/                  # Documentation
└── examples/              # Configuration examples
```

## Development Setup

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/monorepo.git
cd monorepo
```

### 2. Set Up Each Project

Each project has its own setup. Here's how to set up the main CLI:

```bash
cd autonomous-dev-cli
npm install
npm run build
```

For other projects:

```bash
# AI Coding Worker
cd ai-coding-worker
npm install
npm run build

# Internal API Server
cd internal-api-server
npm install
npm run build
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 4. Verify Setup

```bash
# Run tests
npm test

# Build all TypeScript
npm run build
```

## Making Changes

### 1. Create a Branch

```bash
# Update your local main branch
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name
```

### Branch Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/description` | `feature/add-retry-logic` |
| Bug Fix | `fix/description` | `fix/memory-leak` |
| Refactor | `refactor/description` | `refactor/github-client` |
| Documentation | `docs/description` | `docs/update-api-guide` |

### 2. Make Your Changes

- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed
- Keep changes focused and minimal

### 3. Test Your Changes

```bash
# Run tests
npm test

# Build to check for compilation errors
npm run build

# Run the linter (if available)
npm run lint
```

## Commit Guidelines

### Commit Message Format

We follow a simple, clear commit message format:

```
Subject Line

- Optional detail line 1
- Optional detail line 2
```

### Rules

1. **Use imperative mood, present tense** - "Add feature" not "Added feature"
2. **Start with capital letter and verb** - "Fix bug in..." not "fix bug in..."
3. **No prefixes** - Don't use `feat:`, `fix:`, etc.
4. **No emojis** - Keep it professional and machine-readable
5. **Keep subject under 72 characters**

### Good Examples

```
Add retry logic to GitHub API client

- Implement exponential backoff
- Add configurable retry count
- Handle rate limit responses
```

```
Fix memory leak in worker pool

- Release resources after task completion
- Add cleanup on process exit
```

```
Update configuration documentation
```

### Bad Examples

```
feat: added new feature          # Has prefix
fixed the bug                    # Past tense, lowercase
WIP                             # Non-descriptive
Changes                         # Too vague
```

### Good Verbs

Add, Update, Remove, Fix, Refactor, Enhance, Rename, Move, Extract, Merge, Improve, Optimize, Document, Implement

## Pull Request Process

### 1. Before Submitting

- [ ] All tests pass locally
- [ ] Code compiles without errors
- [ ] Documentation is updated (if applicable)
- [ ] Commit messages follow guidelines
- [ ] Branch is up to date with main

### 2. Creating the PR

1. Push your branch to your fork
2. Open a pull request against `main`
3. Fill out the PR template completely
4. Link related issues

### PR Template

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Change 1
- Change 2

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Related Issues
Fixes #123
```

### 3. Review Process

- PRs require at least one approval
- Address review feedback promptly
- Keep discussions constructive
- Squash commits when merging

### 4. After Merge

- Delete your feature branch
- Update your local main branch
- Close related issues if not auto-closed

## Code Style

### TypeScript Guidelines

```typescript
// Use explicit types
function processTask(task: Task): Promise<Result> {
  // ...
}

// Prefer async/await over raw promises
async function fetchData(): Promise<Data> {
  const response = await fetch(url);
  return response.json();
}

// Use meaningful names
const isTaskCompleted = task.status === 'completed';
const taskCount = tasks.length;

// Add JSDoc comments for public APIs
/**
 * Creates a new GitHub client instance.
 * @param options - Client configuration options
 * @returns Configured GitHub client
 */
export function createGitHubClient(options: ClientOptions): GitHubClient {
  // ...
}
```

### File Organization

```typescript
// 1. Imports (external, then internal)
import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logger.js';

// 2. Type definitions
interface TaskOptions {
  timeout: number;
  retries: number;
}

// 3. Constants
const DEFAULT_TIMEOUT = 30000;

// 4. Main exports
export function createTask(options: TaskOptions): Task {
  // ...
}

// 5. Helper functions (private)
function validateOptions(options: TaskOptions): void {
  // ...
}
```

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `github-client.ts` |
| Classes | PascalCase | `GitHubClient` |
| Functions | camelCase | `createClient` |
| Constants | UPPER_SNAKE | `MAX_RETRIES` |
| Interfaces | PascalCase | `ClientOptions` |
| Types | PascalCase | `TaskResult` |

## Testing

### Writing Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTask } from './task.js';

describe('createTask', () => {
  let options: TaskOptions;

  beforeEach(() => {
    options = {
      timeout: 5000,
      retries: 3,
    };
  });

  it('should create task with default values', () => {
    const task = createTask(options);
    expect(task.status).toBe('pending');
  });

  it('should throw on invalid timeout', () => {
    options.timeout = -1;
    expect(() => createTask(options)).toThrow('Invalid timeout');
  });
});
```

### Test Guidelines

- Write tests for new functionality
- Test edge cases and error conditions
- Use descriptive test names
- Keep tests focused and independent
- Mock external dependencies

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Documentation

### When to Update Documentation

- Adding new features
- Changing existing behavior
- Adding configuration options
- Changing API endpoints
- Fixing confusing documentation

### Documentation Locations

| Type | Location |
|------|----------|
| Documentation Hub | `docs/README.md` |
| Architecture Guide | `docs/architecture.md` |
| Configuration Guide | `docs/configuration.md` |
| API Reference | `docs/api-reference.md` |
| Troubleshooting Guide | `docs/troubleshooting.md` |
| CLI docs | `autonomous-dev-cli/README.md` |
| API docs | `ai-coding-worker/API.md` |
| Config examples | `examples/` |

### Documentation Style

- Use clear, concise language
- Include code examples
- Add links to related documentation
- Keep formatting consistent

## Reporting Issues

### Bug Reports

Include:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)
- Relevant error messages or logs

### Feature Requests

Include:
- Clear description of the feature
- Use case / motivation
- Proposed implementation (if any)
- Alternatives considered

### Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `feature` | New feature request |
| `enhancement` | Improvement to existing feature |
| `documentation` | Documentation changes |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |

## Questions?

If you have questions about contributing:

1. Check existing documentation
2. Search existing issues
3. Open a new issue with the `question` label

Thank you for contributing!
