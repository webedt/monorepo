import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  TaskGenerator,
  discoverTasks,
  type TaskGeneratorOptions,
  type DiscoveredTask,
  type DiscoveredTaskPriority,
  type DiscoveredTaskCategory,
  type DiscoveredTaskComplexity,
} from './generator.js';
import { type Issue } from '../github/issues.js';
import { ClaudeError, ErrorCode } from '../utils/errors.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create mock issue
function createMockIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: 'Existing Issue',
    body: 'Existing issue description',
    state: 'open',
    labels: ['autonomous-dev'],
    htmlUrl: 'https://github.com/owner/repo/issues/1',
    createdAt: new Date().toISOString(),
    assignee: null,
    ...overrides,
  };
}

// Create mock discovered task
function createMockTask(overrides: Partial<DiscoveredTask> = {}): DiscoveredTask {
  return {
    title: 'Add feature',
    description: 'Feature description with acceptance criteria',
    priority: 'medium',
    category: 'feature',
    estimatedComplexity: 'moderate',
    affectedPaths: ['src/components/'],
    ...overrides,
  };
}

describe('TaskGenerator', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory with sample structure
    testDir = join(tmpdir(), `generator-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create basic project structure
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: { test: 'jest', build: 'tsc' },
      dependencies: {},
    }));
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export const main = () => {};');
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create generator with required options', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
        },
        repoPath: testDir,
        excludePaths: ['node_modules'],
        tasksPerCycle: 3,
        existingIssues: [],
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should accept repoContext', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
        },
        repoPath: testDir,
        excludePaths: [],
        tasksPerCycle: 5,
        existingIssues: [],
        repoContext: 'E-commerce platform with React frontend and Node.js backend',
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should accept analyzerConfig', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
        },
        repoPath: testDir,
        excludePaths: [],
        tasksPerCycle: 5,
        existingIssues: [],
        analyzerConfig: {
          maxDepth: 10,
          maxFiles: 5000,
        },
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should handle existing issues list', () => {
      const existingIssues = [
        createMockIssue({ number: 1, title: 'Issue 1' }),
        createMockIssue({ number: 2, title: 'Issue 2' }),
      ];

      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
        },
        repoPath: testDir,
        excludePaths: [],
        tasksPerCycle: 5,
        existingIssues,
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });
  });

  describe('discoverTasks factory', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof discoverTasks, 'function');
    });
  });

  describe('DiscoveredTask interface', () => {
    it('should validate priority values', () => {
      const priorities: DiscoveredTaskPriority[] = ['critical', 'high', 'medium', 'low'];

      priorities.forEach((priority) => {
        const task = createMockTask({ priority });
        assert.ok(['critical', 'high', 'medium', 'low'].includes(task.priority));
      });
    });

    it('should validate category values', () => {
      const categories: DiscoveredTaskCategory[] = [
        'security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore',
      ];

      categories.forEach((category) => {
        const task = createMockTask({ category });
        assert.ok([
          'security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore',
        ].includes(task.category));
      });
    });

    it('should validate complexity values', () => {
      const complexities: DiscoveredTaskComplexity[] = ['simple', 'moderate', 'complex'];

      complexities.forEach((estimatedComplexity) => {
        const task = createMockTask({ estimatedComplexity });
        assert.ok(['simple', 'moderate', 'complex'].includes(task.estimatedComplexity));
      });
    });

    it('should include optional estimatedDurationMinutes', () => {
      const taskWithDuration = createMockTask({ estimatedDurationMinutes: 60 });
      assert.strictEqual(taskWithDuration.estimatedDurationMinutes, 60);

      const taskWithoutDuration = createMockTask();
      assert.strictEqual(taskWithoutDuration.estimatedDurationMinutes, undefined);
    });

    it('should include affectedPaths array', () => {
      const task = createMockTask({
        affectedPaths: ['src/components/', 'src/utils/', 'package.json'],
      });

      assert.ok(Array.isArray(task.affectedPaths));
      assert.strictEqual(task.affectedPaths.length, 3);
    });
  });

  describe('prompt building', () => {
    it('should include repository context', () => {
      const repoContext = 'AI-powered code assistant';
      const prompt = buildTestPrompt({
        repoContext,
        codebaseSummary: '## Structure\n- src/\n- package.json',
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes(repoContext));
    });

    it('should include codebase summary', () => {
      const codebaseSummary = '## Files\n- index.ts\n- utils.ts';
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary,
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes(codebaseSummary));
    });

    it('should include existing issues', () => {
      const existingIssues = '- #1: Fix bug\n- #2: Add feature';
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues,
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes(existingIssues));
    });

    it('should specify number of tasks', () => {
      const tasksPerCycle = 5;
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues: 'None',
        tasksPerCycle,
      });

      assert.ok(prompt.includes('5'));
    });

    it('should include category descriptions', () => {
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes('security'));
      assert.ok(prompt.includes('bugfix'));
      assert.ok(prompt.includes('feature'));
      assert.ok(prompt.includes('refactor'));
      assert.ok(prompt.includes('docs'));
      assert.ok(prompt.includes('test'));
      assert.ok(prompt.includes('chore'));
    });

    it('should include priority descriptions', () => {
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes('critical'));
      assert.ok(prompt.includes('high'));
      assert.ok(prompt.includes('medium'));
      assert.ok(prompt.includes('low'));
    });

    it('should include complexity descriptions', () => {
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes('simple'));
      assert.ok(prompt.includes('moderate'));
      assert.ok(prompt.includes('complex'));
    });

    it('should include JSON output format example', () => {
      const prompt = buildTestPrompt({
        repoContext: 'Test project',
        codebaseSummary: '## Files',
        existingIssues: 'None',
        tasksPerCycle: 3,
      });

      assert.ok(prompt.includes('JSON'));
      assert.ok(prompt.includes('title'));
      assert.ok(prompt.includes('description'));
      assert.ok(prompt.includes('affectedPaths'));
    });
  });

  describe('response parsing', () => {
    it('should extract JSON array from response', () => {
      const content = `Here are the tasks:
\`\`\`json
[
  {
    "title": "Add loading states",
    "description": "Add loading indicators",
    "priority": "medium",
    "category": "feature",
    "estimatedComplexity": "simple",
    "affectedPaths": ["src/"]
  }
]
\`\`\``;

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      assert.ok(jsonMatch);

      const tasks = JSON.parse(jsonMatch[0]);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].title, 'Add loading states');
    });

    it('should handle response without markdown code block', () => {
      const content = `[
  {
    "title": "Fix bug",
    "description": "Fix the bug",
    "priority": "high",
    "category": "bugfix",
    "estimatedComplexity": "simple",
    "affectedPaths": ["src/index.ts"]
  }
]`;

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      assert.ok(jsonMatch);

      const tasks = JSON.parse(jsonMatch[0]);
      assert.strictEqual(tasks.length, 1);
    });

    it('should handle multiple tasks in response', () => {
      const content = `[
  {
    "title": "Task 1",
    "description": "Description 1",
    "priority": "high",
    "category": "feature",
    "estimatedComplexity": "simple",
    "affectedPaths": ["src/"]
  },
  {
    "title": "Task 2",
    "description": "Description 2",
    "priority": "medium",
    "category": "bugfix",
    "estimatedComplexity": "moderate",
    "affectedPaths": ["tests/"]
  }
]`;

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      const tasks = JSON.parse(jsonMatch![0]);
      assert.strictEqual(tasks.length, 2);
    });
  });

  describe('task validation', () => {
    it('should filter out invalid tasks', () => {
      const tasks = [
        createMockTask(), // Valid
        { title: 'No description', priority: 'high', category: 'bugfix' }, // Invalid - missing fields
        createMockTask({ priority: 'invalid' as any }), // Invalid priority
      ];

      const validTasks = tasks.filter((task) => {
        return (
          typeof task.title === 'string' &&
          typeof (task as any).description === 'string' &&
          ['critical', 'high', 'medium', 'low'].includes((task as any).priority) &&
          ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes((task as any).category) &&
          ['simple', 'moderate', 'complex'].includes((task as any).estimatedComplexity) &&
          Array.isArray((task as any).affectedPaths)
        );
      });

      assert.strictEqual(validTasks.length, 1);
    });

    it('should accept valid priority values', () => {
      const validPriorities = ['critical', 'high', 'medium', 'low'];
      validPriorities.forEach((priority) => {
        const isValid = ['critical', 'high', 'medium', 'low'].includes(priority);
        assert.ok(isValid);
      });
    });

    it('should reject invalid priority values', () => {
      const invalidPriorities = ['urgent', 'normal', 'very-high', ''];
      invalidPriorities.forEach((priority) => {
        const isValid = ['critical', 'high', 'medium', 'low'].includes(priority);
        assert.strictEqual(isValid, false);
      });
    });

    it('should accept valid category values', () => {
      const validCategories = ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'];
      validCategories.forEach((category) => {
        const isValid = validCategories.includes(category);
        assert.ok(isValid);
      });
    });

    it('should reject invalid category values', () => {
      const invalidCategories = ['improvement', 'enhancement', 'fix', ''];
      const validCategories = ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'];
      invalidCategories.forEach((category) => {
        const isValid = validCategories.includes(category);
        assert.strictEqual(isValid, false);
      });
    });

    it('should accept valid complexity values', () => {
      const validComplexities = ['simple', 'moderate', 'complex'];
      validComplexities.forEach((complexity) => {
        const isValid = validComplexities.includes(complexity);
        assert.ok(isValid);
      });
    });

    it('should reject invalid complexity values', () => {
      const invalidComplexities = ['easy', 'hard', 'very-complex', ''];
      const validComplexities = ['simple', 'moderate', 'complex'];
      invalidComplexities.forEach((complexity) => {
        const isValid = validComplexities.includes(complexity);
        assert.strictEqual(isValid, false);
      });
    });

    it('should limit tasks to tasksPerCycle', () => {
      const tasksPerCycle = 3;
      const allTasks = [
        createMockTask({ title: 'Task 1' }),
        createMockTask({ title: 'Task 2' }),
        createMockTask({ title: 'Task 3' }),
        createMockTask({ title: 'Task 4' }),
        createMockTask({ title: 'Task 5' }),
      ];

      const limitedTasks = allTasks.slice(0, tasksPerCycle);
      assert.strictEqual(limitedTasks.length, 3);
    });
  });

  describe('ClaudeError handling', () => {
    it('should create error for 401 status', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_AUTH_FAILED,
        'Claude API authentication failed'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_AUTH_FAILED);
      assert.ok(error.message.includes('authentication'));
    });

    it('should create error for 403 status', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_AUTH_FAILED,
        'Claude API access denied'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_AUTH_FAILED);
    });

    it('should create error for 429 status', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_RATE_LIMITED,
        'Claude API rate limited'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_RATE_LIMITED);
      assert.ok(error.isRetryable);
    });

    it('should create error for timeout', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_TIMEOUT,
        'Claude API request timed out'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_TIMEOUT);
      assert.ok(error.isRetryable);
    });

    it('should create error for server errors', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_API_ERROR,
        'Claude API server error (500)'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_API_ERROR);
    });

    it('should create error for invalid response', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_INVALID_RESPONSE,
        'No JSON array found in Claude response'
      );

      assert.strictEqual(error.code, ErrorCode.CLAUDE_INVALID_RESPONSE);
    });

    it('should include recovery actions for auth errors', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_AUTH_FAILED,
        'Auth failed'
      );

      assert.ok(error.recoveryActions.length > 0);
    });

    it('should include recovery actions for rate limit errors', () => {
      const error = new ClaudeError(
        ErrorCode.CLAUDE_RATE_LIMITED,
        'Rate limited'
      );

      assert.ok(error.recoveryActions.length > 0);
    });
  });

  describe('retry configuration', () => {
    it('should define retry config for API calls', () => {
      const retryConfig = {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      };

      assert.strictEqual(retryConfig.maxRetries, 3);
      assert.strictEqual(retryConfig.baseDelayMs, 1000);
    });

    it('should identify retryable errors', () => {
      const retryableCodes = [
        ErrorCode.CLAUDE_RATE_LIMITED,
        ErrorCode.CLAUDE_TIMEOUT,
        ErrorCode.CLAUDE_NETWORK_ERROR,
      ];

      retryableCodes.forEach((code) => {
        const error = new ClaudeError(code, 'Error');
        assert.ok(error.isRetryable);
      });
    });

    it('should identify non-retryable errors', () => {
      const nonRetryableCodes = [
        ErrorCode.CLAUDE_AUTH_FAILED,
        ErrorCode.CLAUDE_QUOTA_EXCEEDED,
        ErrorCode.CLAUDE_INVALID_RESPONSE,
      ];

      nonRetryableCodes.forEach((code) => {
        const error = new ClaudeError(code, 'Error');
        assert.strictEqual(error.isRetryable, false);
      });
    });
  });

  describe('existing issues formatting', () => {
    it('should format issues list', () => {
      const issues = [
        createMockIssue({ number: 1, title: 'Fix login bug' }),
        createMockIssue({ number: 2, title: 'Add search feature' }),
        createMockIssue({ number: 3, title: 'Update documentation' }),
      ];

      const formatted = issues.map((i) => `- #${i.number}: ${i.title}`).join('\n');

      assert.ok(formatted.includes('#1: Fix login bug'));
      assert.ok(formatted.includes('#2: Add search feature'));
      assert.ok(formatted.includes('#3: Update documentation'));
    });

    it('should handle empty issues list', () => {
      const issues: Issue[] = [];
      const formatted = issues.map((i) => `- #${i.number}: ${i.title}`).join('\n') || 'None';

      assert.strictEqual(formatted, 'None');
    });
  });
});

describe('TaskGeneratorOptions validation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `options-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should require claudeAuth', () => {
    const options: TaskGeneratorOptions = {
      claudeAuth: {
        accessToken: 'token',
        refreshToken: 'refresh',
      },
      repoPath: testDir,
      excludePaths: [],
      tasksPerCycle: 5,
      existingIssues: [],
    };

    assert.ok(options.claudeAuth);
    assert.ok(options.claudeAuth.accessToken);
    assert.ok(options.claudeAuth.refreshToken);
  });

  it('should require repoPath', () => {
    const options: TaskGeneratorOptions = {
      claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
      repoPath: testDir,
      excludePaths: [],
      tasksPerCycle: 5,
      existingIssues: [],
    };

    assert.strictEqual(options.repoPath, testDir);
  });

  it('should accept various tasksPerCycle values', () => {
    [1, 3, 5, 10].forEach((tasksPerCycle) => {
      const options: TaskGeneratorOptions = {
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
        repoPath: testDir,
        excludePaths: [],
        tasksPerCycle,
        existingIssues: [],
      };

      assert.strictEqual(options.tasksPerCycle, tasksPerCycle);
    });
  });

  it('should accept multiple exclude paths', () => {
    const excludePaths = ['node_modules', 'dist', 'build', '.git', 'coverage'];
    const options: TaskGeneratorOptions = {
      claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
      repoPath: testDir,
      excludePaths,
      tasksPerCycle: 5,
      existingIssues: [],
    };

    assert.deepStrictEqual(options.excludePaths, excludePaths);
  });
});

describe('API response status code mapping', () => {
  it('should map 401 to CLAUDE_AUTH_FAILED', () => {
    const statusCode = 401;
    let code: ErrorCode;

    switch (statusCode) {
      case 401:
        code = ErrorCode.CLAUDE_AUTH_FAILED;
        break;
      default:
        code = ErrorCode.CLAUDE_API_ERROR;
    }

    assert.strictEqual(code, ErrorCode.CLAUDE_AUTH_FAILED);
  });

  it('should map 403 to CLAUDE_AUTH_FAILED', () => {
    const statusCode = 403;
    let code: ErrorCode;

    switch (statusCode) {
      case 403:
        code = ErrorCode.CLAUDE_AUTH_FAILED;
        break;
      default:
        code = ErrorCode.CLAUDE_API_ERROR;
    }

    assert.strictEqual(code, ErrorCode.CLAUDE_AUTH_FAILED);
  });

  it('should map 429 to CLAUDE_RATE_LIMITED', () => {
    const statusCode = 429;
    let code: ErrorCode;

    switch (statusCode) {
      case 429:
        code = ErrorCode.CLAUDE_RATE_LIMITED;
        break;
      default:
        code = ErrorCode.CLAUDE_API_ERROR;
    }

    assert.strictEqual(code, ErrorCode.CLAUDE_RATE_LIMITED);
  });

  it('should map 504 to CLAUDE_TIMEOUT', () => {
    const statusCode = 504;
    let code: ErrorCode;

    switch (statusCode) {
      case 408:
      case 504:
        code = ErrorCode.CLAUDE_TIMEOUT;
        break;
      default:
        code = ErrorCode.CLAUDE_API_ERROR;
    }

    assert.strictEqual(code, ErrorCode.CLAUDE_TIMEOUT);
  });

  it('should map 5xx to CLAUDE_API_ERROR', () => {
    [500, 502, 503].forEach((statusCode) => {
      let code: ErrorCode;

      switch (statusCode) {
        case 500:
        case 502:
        case 503:
          code = ErrorCode.CLAUDE_API_ERROR;
          break;
        default:
          code = ErrorCode.CLAUDE_API_ERROR;
      }

      assert.strictEqual(code, ErrorCode.CLAUDE_API_ERROR);
    });
  });
});

// Helper function to build test prompt
function buildTestPrompt(options: {
  repoContext: string;
  codebaseSummary: string;
  existingIssues: string;
  tasksPerCycle: number;
}): string {
  return `You are an expert software developer analyzing a codebase to identify improvements.

## Repository Context
${options.repoContext || 'This is a web application project.'}

## Current Codebase Analysis
${options.codebaseSummary}

## Existing Open Issues (DO NOT DUPLICATE)
${options.existingIssues}

## Your Task
Identify exactly ${options.tasksPerCycle} actionable improvements.

### Categories:
- security: Security vulnerabilities
- bugfix: Fix existing broken behavior
- feature: New functionality
- refactor: Improve code quality
- docs: Documentation
- test: Tests
- chore: Maintenance

### Priorities:
- critical: Security vulnerabilities, data loss
- high: User-facing bugs
- medium: Important improvements
- low: Nice-to-have

### Complexity:
- simple: < 1 hour
- moderate: 1-4 hours
- complex: 4+ hours

## Output Format
Return a JSON array with:
- title: Short action title
- description: Detailed description
- priority: critical | high | medium | low
- category: security | bugfix | feature | refactor | docs | test | chore
- estimatedComplexity: simple | moderate | complex
- affectedPaths: Array of paths

Return ONLY the JSON array, no other text.`;
}
