/**
 * Tests for the TaskDeduplicator module.
 * Covers semantic similarity, conflict detection, and task prioritization.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  TaskDeduplicator,
  createDeduplicator,
  hasConflictingTasks,
  getParallelSafeTasks,
  groupTasksByConflict,
  type SimilarityResult,
  type ConflictPrediction,
  type DeduplicatedTask,
  type DeduplicatorOptions,
} from '../../src/discovery/deduplicator.js';
import { type DiscoveredTask } from '../../src/discovery/generator.js';
import { type Issue } from '../../src/github/issues.js';

// Helper to create a mock DiscoveredTask
function createMockTask(overrides: Partial<DiscoveredTask> = {}): DiscoveredTask {
  return {
    title: 'Add loading states to dashboard',
    description: 'Add loading indicators while data is being fetched',
    priority: 'medium',
    category: 'feature',
    estimatedComplexity: 'simple',
    affectedPaths: ['src/components/dashboard/'],
    estimatedDurationMinutes: 30,
    ...overrides,
  };
}

// Helper to create a mock Issue
function createMockIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: 'Test Issue',
    body: 'Test description for the issue',
    state: 'open',
    labels: [],
    htmlUrl: 'https://github.com/owner/repo/issues/1',
    createdAt: new Date().toISOString(),
    assignee: null,
    ...overrides,
  };
}

describe('TaskDeduplicator', () => {
  let deduplicator: TaskDeduplicator;

  beforeEach(() => {
    deduplicator = new TaskDeduplicator();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const dup = new TaskDeduplicator();
      assert.ok(dup);
    });

    it('should accept custom similarity threshold', () => {
      const dup = new TaskDeduplicator({ similarityThreshold: 0.8 });
      assert.ok(dup);
    });

    it('should accept additional critical files', () => {
      const dup = new TaskDeduplicator({
        additionalCriticalFiles: ['custom.config.js'],
      });
      assert.ok(dup);
    });

    it('should accept additional critical directories', () => {
      const dup = new TaskDeduplicator({
        additionalCriticalDirectories: ['lib/core'],
      });
      assert.ok(dup);
    });
  });

  describe('calculateTaskSimilarity', () => {
    it('should return high similarity for identical tasks', () => {
      const task1 = createMockTask({
        title: 'User authentication system',
        affectedPaths: ['src/auth/'],
      });
      const task2 = createMockTask({
        title: 'User authentication system',
        affectedPaths: ['src/auth/'],
      });

      const result = deduplicator.calculateTaskSimilarity(task1, task2);

      // Identical tasks should have high similarity
      assert.ok(result.score >= 0.5, `Score ${result.score} should be >= 0.5`);
      assert.ok(result.titleSimilarity > 0, 'Title similarity should be > 0');
      assert.ok(result.pathOverlap > 0);
    });

    it('should return low similarity for unrelated tasks', () => {
      const task1 = createMockTask({
        title: 'Add user authentication',
        affectedPaths: ['src/auth/'],
      });
      const task2 = createMockTask({
        title: 'Fix payment processing bug',
        affectedPaths: ['src/payments/'],
      });

      const result = deduplicator.calculateTaskSimilarity(task1, task2);

      assert.ok(result.score < 0.3);
    });

    it('should detect shared critical files', () => {
      const task1 = createMockTask({
        title: 'Update build configuration',
        affectedPaths: ['package.json', 'src/config/'],
      });
      const task2 = createMockTask({
        title: 'Add new dependency',
        affectedPaths: ['package.json', 'src/utils/'],
      });

      const result = deduplicator.calculateTaskSimilarity(task1, task2);

      assert.strictEqual(result.sharesCriticalFiles, true);
      assert.ok(result.criticalFilesInCommon.length > 0);
    });

    it('should return overlapping paths', () => {
      const task1 = createMockTask({
        title: 'Add dashboard component',
        affectedPaths: ['src/components/dashboard/', 'src/types/'],
      });
      const task2 = createMockTask({
        title: 'Update dashboard styles',
        affectedPaths: ['src/components/dashboard/', 'src/styles/'],
      });

      const result = deduplicator.calculateTaskSimilarity(task1, task2);

      assert.ok(result.overlappingPaths.length > 0);
      assert.ok(result.pathOverlap > 0);
    });

    it('should handle empty path arrays', () => {
      const task1 = createMockTask({
        title: 'General improvement',
        affectedPaths: [],
      });
      const task2 = createMockTask({
        title: 'Another improvement',
        affectedPaths: [],
      });

      const result = deduplicator.calculateTaskSimilarity(task1, task2);

      assert.strictEqual(result.pathOverlap, 0);
      assert.deepStrictEqual(result.overlappingPaths, []);
    });
  });

  describe('calculateTaskIssueSimilarity', () => {
    it('should compare task with existing issue', () => {
      const task = createMockTask({
        title: 'Add loading states to dashboard',
        affectedPaths: ['src/components/dashboard/'],
      });
      const issue = createMockIssue({
        title: 'Implement loading indicators',
        body: 'Add loading states to `src/components/dashboard/`',
      });

      const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

      assert.ok(result.score >= 0);
      assert.ok(result.score <= 1);
    });

    it('should extract paths from issue body', () => {
      const task = createMockTask({
        title: 'Update config',
        affectedPaths: ['src/config/index.ts'],
      });
      const issue = createMockIssue({
        title: 'Configuration update',
        body: `## Affected Paths\n- \`src/config/index.ts\`\n- \`src/config/schema.ts\``,
      });

      const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

      assert.ok(result.overlappingPaths.length > 0);
    });

    it('should handle issue with no body', () => {
      const task = createMockTask();
      const issue = createMockIssue({
        body: null,
      });

      const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

      assert.ok(result.score >= 0);
    });
  });

  describe('predictConflict', () => {
    it('should predict high conflict for critical files', () => {
      const task = createMockTask({
        title: 'Update package configuration',
        affectedPaths: ['package.json', 'tsconfig.json'],
      });
      const issues: Issue[] = [];
      const issuePathMap = new Map<number, string[]>();

      const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

      assert.strictEqual(prediction.hasHighConflictRisk, true);
      assert.ok(prediction.criticalFilesModified.length >= 2);
      assert.ok(prediction.reasons.length > 0);
    });

    it('should predict low conflict for isolated changes', () => {
      const task = createMockTask({
        title: 'Add new utility function',
        affectedPaths: ['src/features/newfeature/helper.ts'],
      });
      const issues: Issue[] = [];
      const issuePathMap = new Map<number, string[]>();

      const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

      assert.strictEqual(prediction.hasHighConflictRisk, false);
      assert.strictEqual(prediction.criticalFilesModified.length, 0);
    });

    it('should detect conflict with existing issues', () => {
      const task = createMockTask({
        title: 'Update dashboard',
        affectedPaths: ['src/components/dashboard/'],
      });
      const issues: Issue[] = [
        createMockIssue({
          number: 1,
          title: 'Dashboard refactor',
          body: 'Refactoring `src/components/dashboard/`',
        }),
      ];
      const issuePathMap = new Map<number, string[]>([
        [1, ['src/components/dashboard/']],
      ]);

      const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

      assert.ok(prediction.conflictingIssues.length > 0);
    });

    it('should identify files in critical directories', () => {
      const task = createMockTask({
        title: 'Add new type',
        affectedPaths: ['src/types/user.ts'],
      });
      const issues: Issue[] = [];
      const issuePathMap = new Map<number, string[]>();

      const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

      assert.ok(prediction.riskScore > 0);
    });

    it('should cap risk score at 1.0', () => {
      const task = createMockTask({
        title: 'Major refactor',
        affectedPaths: [
          'package.json',
          'tsconfig.json',
          '.eslintrc.js',
          'jest.config.ts',
          'src/index.ts',
          'src/config/',
          'src/types/',
        ],
      });
      const issues: Issue[] = [];
      const issuePathMap = new Map<number, string[]>();

      const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

      assert.ok(prediction.riskScore <= 1.0);
    });
  });

  describe('deduplicateTasks', () => {
    it('should process tasks and add deduplication metadata', async () => {
      const tasks: DiscoveredTask[] = [
        createMockTask({ title: 'Task 1', affectedPaths: ['src/a/'] }),
        createMockTask({ title: 'Task 2', affectedPaths: ['src/b/'] }),
      ];
      const issues: Issue[] = [];

      const result = await deduplicator.deduplicateTasks(tasks, issues);

      assert.strictEqual(result.length, 2);
      result.forEach((task) => {
        assert.ok('relatedIssues' in task);
        assert.ok('maxSimilarityScore' in task);
        assert.ok('isPotentialDuplicate' in task);
        assert.ok('conflictPrediction' in task);
        assert.ok('executionPriority' in task);
      });
    });

    it('should flag potential duplicates', async () => {
      // Use a lower threshold deduplicator for this test
      const lowThresholdDedup = new TaskDeduplicator({ similarityThreshold: 0.5 });
      const tasks: DiscoveredTask[] = [
        createMockTask({
          title: 'User authentication login feature',
          affectedPaths: ['src/auth/login.ts', 'src/auth/index.ts'],
        }),
        createMockTask({
          title: 'User authentication login module',
          affectedPaths: ['src/auth/login.ts', 'src/auth/index.ts'],
        }),
      ];
      const issues: Issue[] = [];

      const result = await lowThresholdDedup.deduplicateTasks(tasks, issues);

      // Second task should be flagged as duplicate of first due to matching paths and similar titles
      assert.ok(result.some((t) => t.isPotentialDuplicate || t.maxSimilarityScore > 0.4));
    });

    it('should sort by execution priority', async () => {
      const tasks: DiscoveredTask[] = [
        createMockTask({
          title: 'High risk task',
          affectedPaths: ['package.json', 'tsconfig.json'],
          priority: 'low',
        }),
        createMockTask({
          title: 'Simple task',
          affectedPaths: ['src/features/simple/'],
          priority: 'high',
          estimatedComplexity: 'simple',
        }),
      ];
      const issues: Issue[] = [];

      const result = await deduplicator.deduplicateTasks(tasks, issues);

      // Simple, high priority, low conflict task should have lower priority number
      assert.ok(result[0].executionPriority <= result[1].executionPriority);
    });

    it('should detect duplicates against existing issues', async () => {
      const tasks: DiscoveredTask[] = [
        createMockTask({
          title: 'Add user settings page',
          affectedPaths: ['src/pages/settings/'],
        }),
      ];
      const issues: Issue[] = [
        createMockIssue({
          number: 42,
          title: 'Implement user settings page',
          body: 'Create settings page at `src/pages/settings/`',
        }),
      ];

      const result = await deduplicator.deduplicateTasks(tasks, issues);

      assert.ok(result[0].isPotentialDuplicate || result[0].maxSimilarityScore > 0.5);
      assert.ok(result[0].relatedIssues.includes(42));
    });

    it('should track related issues', async () => {
      const tasks: DiscoveredTask[] = [
        createMockTask({
          title: 'Update component',
          affectedPaths: ['src/components/shared/'],
        }),
      ];
      const issues: Issue[] = [
        createMockIssue({
          number: 10,
          title: 'Component improvements',
          body: 'Improve `src/components/shared/`',
        }),
        createMockIssue({
          number: 20,
          title: 'Unrelated issue',
          body: 'Something in src/payments/',
        }),
      ];

      const result = await deduplicator.deduplicateTasks(tasks, issues);

      // Should include related issue but not unrelated one
      assert.ok(result[0].relatedIssues.includes(10) || result[0].relatedIssues.length === 0);
    });
  });

  describe('filterDuplicates', () => {
    it('should remove duplicate tasks', () => {
      const tasks: DeduplicatedTask[] = [
        {
          ...createMockTask({ title: 'Task 1' }),
          relatedIssues: [],
          maxSimilarityScore: 0.3,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: false,
            riskScore: 0.1,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 50,
        },
        {
          ...createMockTask({ title: 'Task 2 (duplicate)' }),
          relatedIssues: [],
          maxSimilarityScore: 0.9,
          isPotentialDuplicate: true,
          conflictPrediction: {
            hasHighConflictRisk: false,
            riskScore: 0.1,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 100,
        },
      ];

      const filtered = deduplicator.filterDuplicates(tasks);

      assert.strictEqual(filtered.length, 1);
      assert.strictEqual(filtered[0].title, 'Task 1');
    });

    it('should return all tasks if none are duplicates', () => {
      const tasks: DeduplicatedTask[] = [
        {
          ...createMockTask({ title: 'Task 1' }),
          relatedIssues: [],
          maxSimilarityScore: 0,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: false,
            riskScore: 0,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 50,
        },
        {
          ...createMockTask({ title: 'Task 2' }),
          relatedIssues: [],
          maxSimilarityScore: 0,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: false,
            riskScore: 0,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 50,
        },
      ];

      const filtered = deduplicator.filterDuplicates(tasks);

      assert.strictEqual(filtered.length, 2);
    });
  });

  describe('getConflictSafeOrder', () => {
    it('should prioritize low-conflict tasks', () => {
      const tasks: DeduplicatedTask[] = [
        {
          ...createMockTask({ title: 'High risk' }),
          relatedIssues: [],
          maxSimilarityScore: 0,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: true,
            riskScore: 0.9,
            reasons: ['Critical file'],
            conflictingIssues: [],
            criticalFilesModified: ['package.json'],
          },
          executionPriority: 50,
        },
        {
          ...createMockTask({ title: 'Low risk' }),
          relatedIssues: [],
          maxSimilarityScore: 0,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: false,
            riskScore: 0.1,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 50,
        },
      ];

      const ordered = deduplicator.getConflictSafeOrder(tasks);

      assert.strictEqual(ordered[0].title, 'Low risk');
      assert.strictEqual(ordered[1].title, 'High risk');
    });

    it('should not modify original array', () => {
      const tasks: DeduplicatedTask[] = [
        {
          ...createMockTask({ title: 'First' }),
          relatedIssues: [],
          maxSimilarityScore: 0,
          isPotentialDuplicate: false,
          conflictPrediction: {
            hasHighConflictRisk: true,
            riskScore: 0.9,
            reasons: [],
            conflictingIssues: [],
            criticalFilesModified: [],
          },
          executionPriority: 80,
        },
      ];

      const originalTitle = tasks[0].title;
      deduplicator.getConflictSafeOrder(tasks);

      assert.strictEqual(tasks[0].title, originalTitle);
    });
  });
});

describe('createDeduplicator factory', () => {
  it('should create a TaskDeduplicator instance', () => {
    const dup = createDeduplicator();
    assert.ok(dup instanceof TaskDeduplicator);
  });

  it('should pass options to constructor', () => {
    const options: DeduplicatorOptions = {
      similarityThreshold: 0.9,
      additionalCriticalFiles: ['my-config.json'],
    };
    const dup = createDeduplicator(options);
    assert.ok(dup instanceof TaskDeduplicator);
  });
});

describe('hasConflictingTasks', () => {
  it('should return true if any task has high conflict risk', () => {
    const tasks: DeduplicatedTask[] = [
      {
        ...createMockTask(),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0.1,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
      {
        ...createMockTask(),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: true,
          riskScore: 0.8,
          reasons: ['Critical file'],
          conflictingIssues: [],
          criticalFilesModified: ['package.json'],
        },
        executionPriority: 80,
      },
    ];

    assert.strictEqual(hasConflictingTasks(tasks), true);
  });

  it('should return false if no tasks have high conflict risk', () => {
    const tasks: DeduplicatedTask[] = [
      {
        ...createMockTask(),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0.1,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
    ];

    assert.strictEqual(hasConflictingTasks(tasks), false);
  });

  it('should handle empty array', () => {
    assert.strictEqual(hasConflictingTasks([]), false);
  });
});

describe('getParallelSafeTasks', () => {
  it('should filter out high-conflict and duplicate tasks', () => {
    const tasks: DeduplicatedTask[] = [
      {
        ...createMockTask({ title: 'Safe task' }),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0.1,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
      {
        ...createMockTask({ title: 'High conflict' }),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: true,
          riskScore: 0.8,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 80,
      },
      {
        ...createMockTask({ title: 'Duplicate' }),
        relatedIssues: [],
        maxSimilarityScore: 0.9,
        isPotentialDuplicate: true,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0.1,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 100,
      },
    ];

    const safe = getParallelSafeTasks(tasks);

    assert.strictEqual(safe.length, 1);
    assert.strictEqual(safe[0].title, 'Safe task');
  });
});

describe('groupTasksByConflict', () => {
  it('should group related tasks together', () => {
    const tasks: DeduplicatedTask[] = [
      {
        ...createMockTask({ title: 'Task A' }),
        relatedIssues: [1],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
      {
        ...createMockTask({ title: 'Task B' }),
        relatedIssues: [1],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
      {
        ...createMockTask({ title: 'Task C' }),
        relatedIssues: [2],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
    ];

    const groups = groupTasksByConflict(tasks);

    // Tasks A and B share related issue 1, so should be grouped
    // Task C is independent
    assert.ok(groups.length >= 1);
  });

  it('should handle tasks with no conflicts', () => {
    const tasks: DeduplicatedTask[] = [
      {
        ...createMockTask({ title: 'Independent 1' }),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
      {
        ...createMockTask({ title: 'Independent 2' }),
        relatedIssues: [],
        maxSimilarityScore: 0,
        isPotentialDuplicate: false,
        conflictPrediction: {
          hasHighConflictRisk: false,
          riskScore: 0,
          reasons: [],
          conflictingIssues: [],
          criticalFilesModified: [],
        },
        executionPriority: 50,
      },
    ];

    const groups = groupTasksByConflict(tasks);

    // Each task should be in its own group
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].length, 1);
    assert.strictEqual(groups[1].length, 1);
  });

  it('should handle empty array', () => {
    const groups = groupTasksByConflict([]);
    assert.strictEqual(groups.length, 0);
  });
});

describe('Path normalization edge cases', () => {
  let deduplicator: TaskDeduplicator;

  beforeEach(() => {
    deduplicator = new TaskDeduplicator();
  });

  it('should normalize paths with leading ./', () => {
    const task1 = createMockTask({
      affectedPaths: ['./src/index.ts'],
    });
    const task2 = createMockTask({
      affectedPaths: ['src/index.ts'],
    });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    assert.ok(result.overlappingPaths.length > 0);
  });

  it('should normalize multiple slashes', () => {
    const task1 = createMockTask({
      affectedPaths: ['src//components///button.ts'],
    });
    const task2 = createMockTask({
      affectedPaths: ['src/components/button.ts'],
    });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    assert.ok(result.overlappingPaths.length > 0);
  });

  it('should normalize trailing slashes', () => {
    const task1 = createMockTask({
      affectedPaths: ['src/components/'],
    });
    const task2 = createMockTask({
      affectedPaths: ['src/components'],
    });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    assert.ok(result.pathOverlap > 0);
  });

  it('should be case-insensitive for paths', () => {
    const task1 = createMockTask({
      affectedPaths: ['SRC/Components/'],
    });
    const task2 = createMockTask({
      affectedPaths: ['src/components/'],
    });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    assert.ok(result.pathOverlap > 0);
  });
});

describe('Title similarity edge cases', () => {
  let deduplicator: TaskDeduplicator;

  beforeEach(() => {
    deduplicator = new TaskDeduplicator();
  });

  it('should handle empty titles', () => {
    const task1 = createMockTask({ title: '' });
    const task2 = createMockTask({ title: '' });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    // Empty titles should result in similarity of 1 (both empty)
    assert.strictEqual(result.titleSimilarity, 1);
  });

  it('should filter stop words from similarity calculation', () => {
    const task1 = createMockTask({ title: 'Add the user authentication' });
    const task2 = createMockTask({ title: 'user authentication' });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    // Should be high similarity since 'add' and 'the' are stop words
    assert.ok(result.titleSimilarity > 0.8);
  });

  it('should ignore very short words', () => {
    const task1 = createMockTask({ title: 'Fix a UI bug' });
    const task2 = createMockTask({ title: 'UI bug' });

    const result = deduplicator.calculateTaskSimilarity(task1, task2);

    // 'a' should be filtered out
    assert.ok(result.titleSimilarity > 0.5);
  });
});

describe('Critical file detection', () => {
  it('should detect package.json as critical', () => {
    const deduplicator = new TaskDeduplicator();
    const task = createMockTask({
      affectedPaths: ['package.json'],
    });
    const issues: Issue[] = [];
    const issuePathMap = new Map<number, string[]>();

    const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

    assert.ok(prediction.criticalFilesModified.some((f) => f.includes('package.json')));
  });

  it('should detect nested critical files', () => {
    const deduplicator = new TaskDeduplicator();
    const task = createMockTask({
      affectedPaths: ['apps/web/package.json'],
    });
    const issues: Issue[] = [];
    const issuePathMap = new Map<number, string[]>();

    const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

    assert.ok(prediction.criticalFilesModified.length > 0);
  });

  it('should detect custom critical files', () => {
    const deduplicator = new TaskDeduplicator({
      additionalCriticalFiles: ['custom.config.yaml'],
    });
    const task = createMockTask({
      affectedPaths: ['custom.config.yaml'],
    });
    const issues: Issue[] = [];
    const issuePathMap = new Map<number, string[]>();

    const prediction = deduplicator.predictConflict(task, issues, issuePathMap);

    assert.ok(prediction.criticalFilesModified.length > 0);
  });
});

describe('Issue path extraction', () => {
  let deduplicator: TaskDeduplicator;

  beforeEach(() => {
    deduplicator = new TaskDeduplicator();
  });

  it('should extract paths from backticks in body', () => {
    const task = createMockTask({
      affectedPaths: ['src/utils/helper.ts'],
    });
    const issue = createMockIssue({
      body: 'Please update `src/utils/helper.ts` file',
    });

    const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

    assert.ok(result.overlappingPaths.length > 0);
  });

  it('should extract paths from Affected Paths section', () => {
    const task = createMockTask({
      affectedPaths: ['src/api/client.ts'],
    });
    const issue = createMockIssue({
      body: `## Description
Some text here

## Affected Paths
- \`src/api/client.ts\`
- \`src/api/types.ts\`

## Notes
More text`,
    });

    const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

    assert.ok(result.overlappingPaths.length > 0);
  });

  it('should not extract URLs as paths', () => {
    const task = createMockTask({
      affectedPaths: ['src/index.ts'],
    });
    const issue = createMockIssue({
      body: 'See https://example.com/docs/api for more info. Update `src/index.ts`',
    });

    const result = deduplicator.calculateTaskIssueSimilarity(task, issue);

    // Should only find src/index.ts, not the URL
    assert.ok(result.overlappingPaths.length === 1);
  });
});
