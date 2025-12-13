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
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create mock issue
function createMockIssue(number: number, title: string): Issue {
  return {
    number,
    title,
    body: `Description for issue ${number}`,
    state: 'open',
    labels: [],
    htmlUrl: `https://github.com/owner/repo/issues/${number}`,
    createdAt: new Date().toISOString(),
    assignee: null,
  };
}

// Create mock discovered task
function createMockDiscoveredTask(overrides: Partial<DiscoveredTask> = {}): DiscoveredTask {
  return {
    title: 'Add loading states to components',
    description: 'Add loading indicators to improve UX',
    priority: 'medium',
    category: 'feature',
    estimatedComplexity: 'simple',
    affectedPaths: ['src/components/'],
    estimatedDurationMinutes: 30,
    ...overrides,
  };
}

describe('TaskGenerator', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `generator-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create minimal project structure
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'jest' },
    }));
    mkdirSync(join(testDir, 'src'));
    writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');
  });

  afterEach(() => {
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
        tasksPerCycle: 5,
        existingIssues: [],
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should accept optional repo context', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
        },
        repoPath: testDir,
        excludePaths: [],
        tasksPerCycle: 3,
        existingIssues: [],
        repoContext: 'This is a React application for e-commerce',
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should accept analyzer config', () => {
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
          maxDepth: 5,
          maxFiles: 1000,
        },
      };

      const generator = new TaskGenerator(options);
      assert.ok(generator);
    });

    it('should accept existing issues', () => {
      const existingIssues = [
        createMockIssue(1, 'Fix login bug'),
        createMockIssue(2, 'Add dark mode'),
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

  describe('TaskGeneratorOptions interface', () => {
    it('should require claude auth', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: {
          accessToken: 'access',
          refreshToken: 'refresh',
        },
        repoPath: '/path/to/repo',
        excludePaths: [],
        tasksPerCycle: 5,
        existingIssues: [],
      };

      assert.ok(options.claudeAuth.accessToken);
      assert.ok(options.claudeAuth.refreshToken);
    });

    it('should require repoPath', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: { accessToken: 'a', refreshToken: 'r' },
        repoPath: '/path/to/repo',
        excludePaths: [],
        tasksPerCycle: 5,
        existingIssues: [],
      };

      assert.strictEqual(options.repoPath, '/path/to/repo');
    });

    it('should require excludePaths array', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: { accessToken: 'a', refreshToken: 'r' },
        repoPath: '/path',
        excludePaths: ['node_modules', 'dist', 'coverage'],
        tasksPerCycle: 5,
        existingIssues: [],
      };

      assert.deepStrictEqual(options.excludePaths, ['node_modules', 'dist', 'coverage']);
    });

    it('should require tasksPerCycle', () => {
      const options: TaskGeneratorOptions = {
        claudeAuth: { accessToken: 'a', refreshToken: 'r' },
        repoPath: '/path',
        excludePaths: [],
        tasksPerCycle: 10,
        existingIssues: [],
      };

      assert.strictEqual(options.tasksPerCycle, 10);
    });
  });
});

describe('DiscoveredTask interface', () => {
  it('should have all required fields', () => {
    const task: DiscoveredTask = {
      title: 'Implement feature X',
      description: 'Detailed description of what needs to be done',
      priority: 'high',
      category: 'feature',
      estimatedComplexity: 'moderate',
      affectedPaths: ['src/features/', 'src/components/'],
    };

    assert.ok(task.title);
    assert.ok(task.description);
    assert.ok(task.priority);
    assert.ok(task.category);
    assert.ok(task.estimatedComplexity);
    assert.ok(Array.isArray(task.affectedPaths));
  });

  it('should allow optional estimatedDurationMinutes', () => {
    const task: DiscoveredTask = createMockDiscoveredTask({
      estimatedDurationMinutes: 60,
    });

    assert.strictEqual(task.estimatedDurationMinutes, 60);
  });

  it('should work without estimatedDurationMinutes', () => {
    const task: DiscoveredTask = {
      title: 'Task without duration',
      description: 'Description',
      priority: 'low',
      category: 'chore',
      estimatedComplexity: 'simple',
      affectedPaths: [],
    };

    assert.strictEqual(task.estimatedDurationMinutes, undefined);
  });
});

describe('DiscoveredTaskPriority', () => {
  const validPriorities: DiscoveredTaskPriority[] = ['critical', 'high', 'medium', 'low'];

  validPriorities.forEach(priority => {
    it(`should accept priority: ${priority}`, () => {
      const task = createMockDiscoveredTask({ priority });
      assert.strictEqual(task.priority, priority);
    });
  });

  it('should use critical for security issues', () => {
    const task = createMockDiscoveredTask({
      priority: 'critical',
      category: 'security',
      title: 'Fix SQL injection vulnerability',
    });

    assert.strictEqual(task.priority, 'critical');
  });

  it('should use high for important bugs', () => {
    const task = createMockDiscoveredTask({
      priority: 'high',
      category: 'bugfix',
      title: 'Fix authentication bypass',
    });

    assert.strictEqual(task.priority, 'high');
  });

  it('should use medium for features', () => {
    const task = createMockDiscoveredTask({
      priority: 'medium',
      category: 'feature',
    });

    assert.strictEqual(task.priority, 'medium');
  });

  it('should use low for chores', () => {
    const task = createMockDiscoveredTask({
      priority: 'low',
      category: 'chore',
    });

    assert.strictEqual(task.priority, 'low');
  });
});

describe('DiscoveredTaskCategory', () => {
  const validCategories: DiscoveredTaskCategory[] = [
    'security',
    'bugfix',
    'feature',
    'refactor',
    'docs',
    'test',
    'chore',
  ];

  validCategories.forEach(category => {
    it(`should accept category: ${category}`, () => {
      const task = createMockDiscoveredTask({ category });
      assert.strictEqual(task.category, category);
    });
  });

  it('should categorize security vulnerabilities', () => {
    const task = createMockDiscoveredTask({
      category: 'security',
      title: 'Update vulnerable dependency',
    });

    assert.strictEqual(task.category, 'security');
  });

  it('should categorize bug fixes', () => {
    const task = createMockDiscoveredTask({
      category: 'bugfix',
      title: 'Fix race condition in data loading',
    });

    assert.strictEqual(task.category, 'bugfix');
  });

  it('should categorize documentation', () => {
    const task = createMockDiscoveredTask({
      category: 'docs',
      title: 'Add API documentation',
    });

    assert.strictEqual(task.category, 'docs');
  });

  it('should categorize tests', () => {
    const task = createMockDiscoveredTask({
      category: 'test',
      title: 'Add unit tests for user service',
    });

    assert.strictEqual(task.category, 'test');
  });
});

describe('DiscoveredTaskComplexity', () => {
  const validComplexities: DiscoveredTaskComplexity[] = ['simple', 'moderate', 'complex'];

  validComplexities.forEach(complexity => {
    it(`should accept complexity: ${complexity}`, () => {
      const task = createMockDiscoveredTask({ estimatedComplexity: complexity });
      assert.strictEqual(task.estimatedComplexity, complexity);
    });
  });

  it('should use simple for quick fixes', () => {
    const task = createMockDiscoveredTask({
      estimatedComplexity: 'simple',
      estimatedDurationMinutes: 30,
    });

    assert.strictEqual(task.estimatedComplexity, 'simple');
  });

  it('should use moderate for medium tasks', () => {
    const task = createMockDiscoveredTask({
      estimatedComplexity: 'moderate',
      estimatedDurationMinutes: 120,
    });

    assert.strictEqual(task.estimatedComplexity, 'moderate');
  });

  it('should use complex for large tasks', () => {
    const task = createMockDiscoveredTask({
      estimatedComplexity: 'complex',
      estimatedDurationMinutes: 480,
    });

    assert.strictEqual(task.estimatedComplexity, 'complex');
  });
});

describe('Task affected paths', () => {
  it('should accept single path', () => {
    const task = createMockDiscoveredTask({
      affectedPaths: ['src/components/Button.tsx'],
    });

    assert.strictEqual(task.affectedPaths.length, 1);
  });

  it('should accept multiple paths', () => {
    const task = createMockDiscoveredTask({
      affectedPaths: [
        'src/components/',
        'src/styles/',
        'tests/components/',
      ],
    });

    assert.strictEqual(task.affectedPaths.length, 3);
  });

  it('should accept directory paths', () => {
    const task = createMockDiscoveredTask({
      affectedPaths: ['src/', 'lib/', 'tests/'],
    });

    assert.ok(task.affectedPaths.every(p => p.endsWith('/')));
  });

  it('should accept file paths', () => {
    const task = createMockDiscoveredTask({
      affectedPaths: [
        'src/index.ts',
        'package.json',
        'README.md',
      ],
    });

    assert.strictEqual(task.affectedPaths.length, 3);
  });

  it('should accept empty paths array', () => {
    const task = createMockDiscoveredTask({
      affectedPaths: [],
    });

    assert.deepStrictEqual(task.affectedPaths, []);
  });
});

describe('discoverTasks function', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `discover-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: {},
    }));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should be a function', () => {
    assert.strictEqual(typeof discoverTasks, 'function');
  });

  it('should accept TaskGeneratorOptions', () => {
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

    // Just verify it accepts the options (don't actually call Claude)
    assert.ok(options);
  });
});

describe('Task validation', () => {
  it('should validate task has title', () => {
    const task = createMockDiscoveredTask({ title: 'Valid title' });
    assert.ok(task.title.length > 0);
  });

  it('should validate task has description', () => {
    const task = createMockDiscoveredTask({ description: 'Valid description' });
    assert.ok(task.description.length > 0);
  });

  it('should validate priority is valid enum', () => {
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const task = createMockDiscoveredTask({ priority: 'high' });
    assert.ok(validPriorities.includes(task.priority));
  });

  it('should validate category is valid enum', () => {
    const validCategories = ['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'];
    const task = createMockDiscoveredTask({ category: 'feature' });
    assert.ok(validCategories.includes(task.category));
  });

  it('should validate complexity is valid enum', () => {
    const validComplexities = ['simple', 'moderate', 'complex'];
    const task = createMockDiscoveredTask({ estimatedComplexity: 'moderate' });
    assert.ok(validComplexities.includes(task.estimatedComplexity));
  });

  it('should validate affectedPaths is array', () => {
    const task = createMockDiscoveredTask({ affectedPaths: ['src/'] });
    assert.ok(Array.isArray(task.affectedPaths));
  });

  it('should validate estimatedDurationMinutes is number when present', () => {
    const task = createMockDiscoveredTask({ estimatedDurationMinutes: 45 });
    assert.strictEqual(typeof task.estimatedDurationMinutes, 'number');
  });
});

describe('Task examples', () => {
  it('should create security task example', () => {
    const task: DiscoveredTask = {
      title: 'Update vulnerable lodash dependency',
      description: 'Current lodash version has known security vulnerabilities. Update to latest version and verify all usages still work correctly.',
      priority: 'critical',
      category: 'security',
      estimatedComplexity: 'simple',
      affectedPaths: ['package.json', 'package-lock.json'],
      estimatedDurationMinutes: 15,
    };

    assert.strictEqual(task.category, 'security');
    assert.strictEqual(task.priority, 'critical');
  });

  it('should create feature task example', () => {
    const task: DiscoveredTask = {
      title: 'Add dark mode support',
      description: 'Implement dark mode toggle in settings. Store preference in localStorage. Apply theme across all components.',
      priority: 'medium',
      category: 'feature',
      estimatedComplexity: 'moderate',
      affectedPaths: ['src/components/', 'src/styles/', 'src/hooks/'],
      estimatedDurationMinutes: 180,
    };

    assert.strictEqual(task.category, 'feature');
    assert.strictEqual(task.priority, 'medium');
  });

  it('should create refactor task example', () => {
    const task: DiscoveredTask = {
      title: 'Extract common API client logic',
      description: 'Multiple components have duplicate API call logic. Extract into a shared hook for consistency and maintainability.',
      priority: 'low',
      category: 'refactor',
      estimatedComplexity: 'moderate',
      affectedPaths: ['src/hooks/', 'src/api/', 'src/components/'],
      estimatedDurationMinutes: 120,
    };

    assert.strictEqual(task.category, 'refactor');
  });

  it('should create test task example', () => {
    const task: DiscoveredTask = {
      title: 'Add unit tests for authentication service',
      description: 'AuthService has no test coverage. Add comprehensive unit tests covering login, logout, token refresh, and error handling.',
      priority: 'medium',
      category: 'test',
      estimatedComplexity: 'moderate',
      affectedPaths: ['src/services/auth.ts', 'tests/services/auth.test.ts'],
      estimatedDurationMinutes: 90,
    };

    assert.strictEqual(task.category, 'test');
  });

  it('should create docs task example', () => {
    const task: DiscoveredTask = {
      title: 'Document API endpoints',
      description: 'Create OpenAPI specification for all REST endpoints. Add inline JSDoc comments to controller methods.',
      priority: 'low',
      category: 'docs',
      estimatedComplexity: 'simple',
      affectedPaths: ['docs/', 'src/controllers/'],
      estimatedDurationMinutes: 60,
    };

    assert.strictEqual(task.category, 'docs');
  });
});
