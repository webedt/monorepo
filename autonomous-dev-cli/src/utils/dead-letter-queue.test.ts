import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  DeadLetterQueue,
  getDeadLetterQueue,
  resetDeadLetterQueue,
  type DeadLetterEntry,
  type RetryAttempt,
  type DLQConfig,
} from './dead-letter-queue.js';
import { ErrorCode } from './errors.js';

describe('DeadLetterQueue', () => {
  let testDir: string;
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    testDir = join(tmpdir(), `dlq-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    resetDeadLetterQueue();
    dlq = new DeadLetterQueue({ enablePersistence: false }, testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    resetDeadLetterQueue();
  });

  describe('constructor', () => {
    it('should create DLQ with default config', () => {
      const queue = new DeadLetterQueue({}, testDir);
      const stats = queue.getStats();
      assert.strictEqual(stats.totalEntries, 0);
    });

    it('should use custom config', () => {
      const customConfig: Partial<DLQConfig> = {
        maxEntries: 50,
        retentionDays: 7,
        enablePersistence: false,
      };
      const queue = new DeadLetterQueue(customConfig, testDir);
      assert.ok(queue);
    });

    it('should load from disk when persistence is enabled', () => {
      const persistDir = join(testDir, 'persist-test');
      mkdirSync(persistDir, { recursive: true });
      mkdirSync(join(persistDir, 'dlq'), { recursive: true });

      // Create a mock entry file
      const mockEntry: DeadLetterEntry = {
        id: 'dlq-test-123',
        taskId: 'task-1',
        taskType: 'issue',
        createdAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        totalAttempts: 3,
        maxRetries: 3,
        repository: 'owner/repo',
        finalError: {
          code: ErrorCode.EXEC_FAILED,
          message: 'Test error',
          severity: 'error',
          isRetryable: false,
        },
        retryHistory: [],
        context: {},
        canReprocess: false,
        reprocessAttempts: 0,
      };

      const fs = require('fs');
      fs.writeFileSync(
        join(persistDir, 'dlq', 'dlq.json'),
        JSON.stringify([mockEntry])
      );

      const queue = new DeadLetterQueue({ enablePersistence: true }, persistDir);
      const entry = queue.getEntry('dlq-test-123');
      assert.ok(entry);
      assert.strictEqual(entry.taskId, 'task-1');
    });
  });

  describe('addEntry', () => {
    it('should add entry with generated id and timestamp', () => {
      const entryData = createMockEntryData();
      const id = dlq.addEntry(entryData);

      assert.ok(id.startsWith('dlq-'));
      const entry = dlq.getEntry(id);
      assert.ok(entry);
      assert.strictEqual(entry.taskId, entryData.taskId);
      assert.ok(entry.createdAt);
    });

    it('should enforce max entries limit', () => {
      const smallQueue = new DeadLetterQueue({ maxEntries: 3, enablePersistence: false }, testDir);

      smallQueue.addEntry(createMockEntryData({ taskId: 'task-1' }));
      smallQueue.addEntry(createMockEntryData({ taskId: 'task-2' }));
      smallQueue.addEntry(createMockEntryData({ taskId: 'task-3' }));
      smallQueue.addEntry(createMockEntryData({ taskId: 'task-4' }));

      const stats = smallQueue.getStats();
      assert.strictEqual(stats.totalEntries, 3);
    });

    it('should persist to disk when enabled', () => {
      const persistDir = join(testDir, 'persist-add');
      mkdirSync(persistDir, { recursive: true });

      const persistQueue = new DeadLetterQueue({ enablePersistence: true }, persistDir);
      persistQueue.addEntry(createMockEntryData({ taskId: 'task-persist' }));

      const filePath = join(persistDir, 'dlq', 'dlq.json');
      assert.ok(existsSync(filePath));

      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.strictEqual(data.length, 1);
      assert.strictEqual(data[0].taskId, 'task-persist');
    });
  });

  describe('createEntryFromRetryContext', () => {
    it('should create entry from retry context', () => {
      const retryHistory: RetryAttempt[] = [
        { attemptNumber: 1, timestamp: new Date().toISOString(), errorMessage: 'Error 1', delayMs: 1000 },
        { attemptNumber: 2, timestamp: new Date().toISOString(), errorMessage: 'Error 2', delayMs: 2000 },
        { attemptNumber: 3, timestamp: new Date().toISOString(), errorMessage: 'Error 3', delayMs: 4000 },
      ];

      const id = dlq.createEntryFromRetryContext(
        'task-123',
        'issue',
        'owner/repo',
        retryHistory,
        {
          code: ErrorCode.EXEC_FAILED,
          message: 'Final error',
          severity: 'error',
          isRetryable: true,
        },
        { workerId: 'worker-1' },
        { issueNumber: 42, branchName: 'auto/42-feature' }
      );

      const entry = dlq.getEntry(id);
      assert.ok(entry);
      assert.strictEqual(entry.taskId, 'task-123');
      assert.strictEqual(entry.taskType, 'issue');
      assert.strictEqual(entry.totalAttempts, 3);
      assert.strictEqual(entry.issueNumber, 42);
      assert.strictEqual(entry.branchName, 'auto/42-feature');
      assert.strictEqual(entry.canReprocess, true);
      assert.ok(entry.reprocessAfter);
    });

    it('should set canReprocess based on isRetryable', () => {
      const id = dlq.createEntryFromRetryContext(
        'task-456',
        'pr',
        'owner/repo',
        [{ attemptNumber: 1, timestamp: new Date().toISOString(), errorMessage: 'Error', delayMs: 1000 }],
        {
          code: ErrorCode.AUTH_FAILED,
          message: 'Auth failed',
          severity: 'critical',
          isRetryable: false,
        },
        {}
      );

      const entry = dlq.getEntry(id);
      assert.ok(entry);
      assert.strictEqual(entry.canReprocess, false);
      assert.strictEqual(entry.reprocessAfter, undefined);
    });
  });

  describe('getEntry', () => {
    it('should return entry by id', () => {
      const id = dlq.addEntry(createMockEntryData({ taskId: 'get-test' }));
      const entry = dlq.getEntry(id);
      assert.ok(entry);
      assert.strictEqual(entry.taskId, 'get-test');
    });

    it('should return undefined for non-existent id', () => {
      const entry = dlq.getEntry('non-existent-id');
      assert.strictEqual(entry, undefined);
    });
  });

  describe('getAllEntries', () => {
    it('should return all entries', () => {
      dlq.addEntry(createMockEntryData({ taskId: 'task-1' }));
      dlq.addEntry(createMockEntryData({ taskId: 'task-2' }));
      dlq.addEntry(createMockEntryData({ taskId: 'task-3' }));

      const entries = dlq.getAllEntries();
      assert.strictEqual(entries.length, 3);
    });

    it('should return empty array when no entries', () => {
      const entries = dlq.getAllEntries();
      assert.strictEqual(entries.length, 0);
    });
  });

  describe('getReprocessableEntries', () => {
    it('should return only reprocessable entries', () => {
      // Reprocessable entry
      dlq.addEntry(createMockEntryData({
        taskId: 'reprocessable',
        canReprocess: true,
        reprocessAfter: new Date(Date.now() - 1000).toISOString(),
      }));

      // Not reprocessable
      dlq.addEntry(createMockEntryData({
        taskId: 'not-reprocessable',
        canReprocess: false,
      }));

      const reprocessable = dlq.getReprocessableEntries();
      assert.strictEqual(reprocessable.length, 1);
      assert.strictEqual(reprocessable[0].taskId, 'reprocessable');
    });

    it('should not include entries with future reprocessAfter', () => {
      dlq.addEntry(createMockEntryData({
        taskId: 'future',
        canReprocess: true,
        reprocessAfter: new Date(Date.now() + 60000).toISOString(),
      }));

      const reprocessable = dlq.getReprocessableEntries();
      assert.strictEqual(reprocessable.length, 0);
    });

    it('should not include entries exceeding max reprocess attempts', () => {
      const queue = new DeadLetterQueue({
        enablePersistence: false,
        maxReprocessAttempts: 2,
      }, testDir);

      // Create entry with reprocessAttempts already at max
      const id = queue.addEntry(createMockEntryData({
        taskId: 'max-attempts',
        canReprocess: true,
      }));

      // Manually increment to max
      queue.markReprocessing(id);
      queue.markReprocessing(id);

      const reprocessable = queue.getReprocessableEntries();
      assert.strictEqual(reprocessable.length, 0);
    });
  });

  describe('markReprocessing', () => {
    it('should increment reprocess attempts', () => {
      const id = dlq.addEntry(createMockEntryData({ canReprocess: true }));

      const result = dlq.markReprocessing(id);
      assert.strictEqual(result, true);

      const entry = dlq.getEntry(id);
      assert.ok(entry);
      assert.strictEqual(entry.reprocessAttempts, 1);
    });

    it('should update reprocessAfter with exponential backoff', () => {
      const id = dlq.addEntry(createMockEntryData({ canReprocess: true }));

      dlq.markReprocessing(id);
      const entry1 = dlq.getEntry(id);
      const time1 = new Date(entry1!.reprocessAfter!).getTime();

      dlq.markReprocessing(id);
      const entry2 = dlq.getEntry(id);
      const time2 = new Date(entry2!.reprocessAfter!).getTime();

      // Second delay should be longer due to exponential backoff
      assert.ok(time2 > time1);
    });

    it('should return false for non-reprocessable entry', () => {
      const id = dlq.addEntry(createMockEntryData({ canReprocess: false }));
      const result = dlq.markReprocessing(id);
      assert.strictEqual(result, false);
    });

    it('should return false for non-existent entry', () => {
      const result = dlq.markReprocessing('non-existent');
      assert.strictEqual(result, false);
    });
  });

  describe('removeEntry', () => {
    it('should remove existing entry', () => {
      const id = dlq.addEntry(createMockEntryData());
      const result = dlq.removeEntry(id);

      assert.strictEqual(result, true);
      assert.strictEqual(dlq.getEntry(id), undefined);
    });

    it('should return false for non-existent entry', () => {
      const result = dlq.removeEntry('non-existent');
      assert.strictEqual(result, false);
    });

    it('should persist deletion when enabled', () => {
      const persistDir = join(testDir, 'persist-remove');
      mkdirSync(persistDir, { recursive: true });

      const persistQueue = new DeadLetterQueue({ enablePersistence: true }, persistDir);
      const id = persistQueue.addEntry(createMockEntryData());
      persistQueue.removeEntry(id);

      const filePath = join(persistDir, 'dlq', 'dlq.json');
      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      assert.strictEqual(data.length, 0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      dlq.addEntry(createMockEntryData({ taskType: 'issue', finalError: { code: 'ERR1', message: '', severity: 'error', isRetryable: false } }));
      dlq.addEntry(createMockEntryData({ taskType: 'issue', finalError: { code: 'ERR1', message: '', severity: 'error', isRetryable: false } }));
      dlq.addEntry(createMockEntryData({ taskType: 'pr', finalError: { code: 'ERR2', message: '', severity: 'error', isRetryable: true }, canReprocess: true }));

      const stats = dlq.getStats();

      assert.strictEqual(stats.totalEntries, 3);
      assert.strictEqual(stats.entriesByType['issue'], 2);
      assert.strictEqual(stats.entriesByType['pr'], 1);
      assert.strictEqual(stats.entriesByErrorCode['ERR1'], 2);
      assert.strictEqual(stats.entriesByErrorCode['ERR2'], 1);
      assert.strictEqual(stats.reprocessableCount, 1);
      assert.ok(stats.oldestEntry);
      assert.ok(stats.newestEntry);
    });

    it('should return empty stats for empty queue', () => {
      const stats = dlq.getStats();
      assert.strictEqual(stats.totalEntries, 0);
      assert.strictEqual(Object.keys(stats.entriesByType).length, 0);
      assert.strictEqual(stats.reprocessableCount, 0);
    });
  });

  describe('getEntriesByType', () => {
    it('should return entries filtered by type', () => {
      dlq.addEntry(createMockEntryData({ taskType: 'issue' }));
      dlq.addEntry(createMockEntryData({ taskType: 'pr' }));
      dlq.addEntry(createMockEntryData({ taskType: 'issue' }));

      const issues = dlq.getEntriesByType('issue');
      assert.strictEqual(issues.length, 2);

      const prs = dlq.getEntriesByType('pr');
      assert.strictEqual(prs.length, 1);
    });
  });

  describe('getEntriesByErrorCode', () => {
    it('should return entries filtered by error code', () => {
      dlq.addEntry(createMockEntryData({ finalError: { code: 'ERR_A', message: '', severity: 'error', isRetryable: false } }));
      dlq.addEntry(createMockEntryData({ finalError: { code: 'ERR_B', message: '', severity: 'error', isRetryable: false } }));
      dlq.addEntry(createMockEntryData({ finalError: { code: 'ERR_A', message: '', severity: 'error', isRetryable: false } }));

      const errA = dlq.getEntriesByErrorCode('ERR_A');
      assert.strictEqual(errA.length, 2);

      const errB = dlq.getEntriesByErrorCode('ERR_B');
      assert.strictEqual(errB.length, 1);
    });
  });

  describe('cleanupExpired', () => {
    it('should remove entries older than retention period', () => {
      const queue = new DeadLetterQueue({
        enablePersistence: false,
        retentionDays: 0, // Immediate expiration for testing
      }, testDir);

      // Add entry with old timestamp
      const oldEntry = createMockEntryData({ taskId: 'old' });
      queue.addEntry(oldEntry);

      // Wait a bit then cleanup
      const removed = queue.cleanupExpired();
      assert.strictEqual(removed, 1);
      assert.strictEqual(queue.getStats().totalEntries, 0);
    });

    it('should keep entries within retention period', () => {
      const queue = new DeadLetterQueue({
        enablePersistence: false,
        retentionDays: 30,
      }, testDir);

      queue.addEntry(createMockEntryData());

      const removed = queue.cleanupExpired();
      assert.strictEqual(removed, 0);
      assert.strictEqual(queue.getStats().totalEntries, 1);
    });
  });

  describe('getDeadLetterQueue', () => {
    it('should return singleton instance', () => {
      resetDeadLetterQueue();
      const queue1 = getDeadLetterQueue({}, testDir);
      const queue2 = getDeadLetterQueue({}, testDir);
      assert.strictEqual(queue1, queue2);
    });
  });

  describe('resetDeadLetterQueue', () => {
    it('should reset the singleton instance', () => {
      const queue1 = getDeadLetterQueue({ enablePersistence: false }, testDir);
      queue1.addEntry(createMockEntryData());

      resetDeadLetterQueue();

      const queue2 = getDeadLetterQueue({ enablePersistence: false }, testDir);
      assert.notStrictEqual(queue1, queue2);
      assert.strictEqual(queue2.getStats().totalEntries, 0);
    });
  });
});

function createMockEntryData(overrides: Partial<Omit<DeadLetterEntry, 'id' | 'createdAt' | 'reprocessAttempts'>> = {}): Omit<DeadLetterEntry, 'id' | 'createdAt' | 'reprocessAttempts'> {
  return {
    taskId: 'task-123',
    taskType: 'issue',
    lastAttemptAt: new Date().toISOString(),
    totalAttempts: 3,
    maxRetries: 3,
    repository: 'owner/repo',
    finalError: {
      code: ErrorCode.EXEC_FAILED,
      message: 'Task execution failed',
      severity: 'error',
      isRetryable: false,
    },
    retryHistory: [
      { attemptNumber: 1, timestamp: new Date().toISOString(), errorMessage: 'Error 1', delayMs: 1000 },
      { attemptNumber: 2, timestamp: new Date().toISOString(), errorMessage: 'Error 2', delayMs: 2000 },
      { attemptNumber: 3, timestamp: new Date().toISOString(), errorMessage: 'Error 3', delayMs: 4000 },
    ],
    context: { workerId: 'worker-1' },
    canReprocess: false,
    ...overrides,
  };
}
