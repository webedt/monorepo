/**
 * Dead Letter Queue (DLQ) implementation for tasks that fail after max retries.
 * Provides persistent storage and detailed error context for failed tasks.
 */

import { logger } from './logger.js';
import { type ErrorContext, type ErrorCode } from './errors.js';
import { metrics } from './metrics.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  attemptNumber: number;
  timestamp: string;
  errorCode?: ErrorCode | string;
  errorMessage: string;
  delayMs: number;
  duration?: number;
  context?: Record<string, unknown>;
}

/**
 * Dead letter entry with full error context
 */
export interface DeadLetterEntry {
  id: string;
  taskId: string;
  taskType: 'issue' | 'pr' | 'evaluation' | 'merge';
  createdAt: string;
  lastAttemptAt: string;
  totalAttempts: number;
  maxRetries: number;

  // Task details
  issueNumber?: number;
  branchName?: string;
  repository: string;

  // Error details
  finalError: {
    code: ErrorCode | string;
    message: string;
    severity: string;
    isRetryable: boolean;
    stack?: string;
  };

  // All retry attempts with context
  retryHistory: RetryAttempt[];

  // Additional context for debugging
  context: {
    workerId?: string;
    correlationId?: string;
    originalTimeout?: number;
    systemState?: Record<string, unknown>;
    [key: string]: unknown;
  };

  // Reprocessing metadata
  canReprocess: boolean;
  reprocessAfter?: string;
  reprocessAttempts: number;
}

/**
 * DLQ statistics
 */
export interface DLQStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  entriesByErrorCode: Record<string, number>;
  oldestEntry?: string;
  newestEntry?: string;
  reprocessableCount: number;
}

/**
 * DLQ configuration
 */
export interface DLQConfig {
  maxEntries: number;
  retentionDays: number;
  persistPath?: string;
  enablePersistence: boolean;
  reprocessDelayMs: number;
  maxReprocessAttempts: number;
}

const DEFAULT_DLQ_CONFIG: DLQConfig = {
  maxEntries: 1000,
  retentionDays: 30,
  enablePersistence: true,
  reprocessDelayMs: 300000, // 5 minutes
  maxReprocessAttempts: 3,
};

/**
 * Dead Letter Queue for failed tasks
 */
export class DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private config: DLQConfig;
  private persistPath: string;
  private log = logger.child('DLQ');

  constructor(config: Partial<DLQConfig> = {}, workDir: string = '/tmp/autonomous-dev') {
    this.config = { ...DEFAULT_DLQ_CONFIG, ...config };
    this.persistPath = config.persistPath || join(workDir, 'dlq');

    if (this.config.enablePersistence) {
      this.loadFromDisk();
    }
  }

  /**
   * Add a failed task to the dead letter queue
   */
  addEntry(entry: Omit<DeadLetterEntry, 'id' | 'createdAt' | 'reprocessAttempts'>): string {
    const id = this.generateId();
    const now = new Date().toISOString();

    const fullEntry: DeadLetterEntry = {
      ...entry,
      id,
      createdAt: now,
      reprocessAttempts: 0,
    };

    // Enforce max entries limit
    if (this.entries.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(id, fullEntry);

    // Log the DLQ entry
    this.log.warn(`Task added to dead letter queue`, {
      dlqId: id,
      taskId: entry.taskId,
      taskType: entry.taskType,
      issueNumber: entry.issueNumber,
      totalAttempts: entry.totalAttempts,
      errorCode: entry.finalError.code,
      errorMessage: entry.finalError.message,
      canReprocess: entry.canReprocess,
    });

    // Record metrics
    metrics.errorsTotal.inc({
      repository: entry.repository,
      error_code: String(entry.finalError.code),
      severity: 'dead_letter',
      component: 'DLQ',
      is_retryable: String(entry.canReprocess),
    });

    // Persist if enabled
    if (this.config.enablePersistence) {
      this.persistToDisk();
    }

    return id;
  }

  /**
   * Create a DLQ entry from retry context
   */
  createEntryFromRetryContext(
    taskId: string,
    taskType: DeadLetterEntry['taskType'],
    repository: string,
    retryHistory: RetryAttempt[],
    finalError: DeadLetterEntry['finalError'],
    context: DeadLetterEntry['context'],
    options?: {
      issueNumber?: number;
      branchName?: string;
      maxRetries?: number;
    }
  ): string {
    const lastAttempt = retryHistory[retryHistory.length - 1];

    return this.addEntry({
      taskId,
      taskType,
      lastAttemptAt: lastAttempt?.timestamp || new Date().toISOString(),
      totalAttempts: retryHistory.length,
      maxRetries: options?.maxRetries || 3,
      issueNumber: options?.issueNumber,
      branchName: options?.branchName,
      repository,
      finalError,
      retryHistory,
      context,
      canReprocess: finalError.isRetryable,
      reprocessAfter: finalError.isRetryable
        ? new Date(Date.now() + this.config.reprocessDelayMs).toISOString()
        : undefined,
    });
  }

  /**
   * Get an entry by ID
   */
  getEntry(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get all entries
   */
  getAllEntries(): DeadLetterEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get entries ready for reprocessing
   */
  getReprocessableEntries(): DeadLetterEntry[] {
    const now = new Date();
    return this.getAllEntries().filter(entry => {
      if (!entry.canReprocess) return false;
      if (entry.reprocessAttempts >= this.config.maxReprocessAttempts) return false;
      if (entry.reprocessAfter && new Date(entry.reprocessAfter) > now) return false;
      return true;
    });
  }

  /**
   * Mark an entry as being reprocessed
   */
  markReprocessing(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || !entry.canReprocess) return false;

    entry.reprocessAttempts++;
    entry.reprocessAfter = new Date(
      Date.now() + this.config.reprocessDelayMs * Math.pow(2, entry.reprocessAttempts)
    ).toISOString();

    this.log.info(`DLQ entry marked for reprocessing`, {
      dlqId: id,
      reprocessAttempts: entry.reprocessAttempts,
      nextReprocessAfter: entry.reprocessAfter,
    });

    if (this.config.enablePersistence) {
      this.persistToDisk();
    }

    return true;
  }

  /**
   * Remove an entry from the queue (after successful reprocessing)
   */
  removeEntry(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) {
      this.log.info(`DLQ entry removed after successful reprocessing`, { dlqId: id });
      if (this.config.enablePersistence) {
        this.persistToDisk();
      }
    }
    return removed;
  }

  /**
   * Get queue statistics
   */
  getStats(): DLQStats {
    const entries = this.getAllEntries();
    const entriesByType: Record<string, number> = {};
    const entriesByErrorCode: Record<string, number> = {};
    let reprocessableCount = 0;

    for (const entry of entries) {
      // Count by type
      entriesByType[entry.taskType] = (entriesByType[entry.taskType] || 0) + 1;

      // Count by error code
      const code = String(entry.finalError.code);
      entriesByErrorCode[code] = (entriesByErrorCode[code] || 0) + 1;

      // Count reprocessable
      if (entry.canReprocess && entry.reprocessAttempts < this.config.maxReprocessAttempts) {
        reprocessableCount++;
      }
    }

    // Sort by creation date
    const sorted = entries.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return {
      totalEntries: entries.length,
      entriesByType,
      entriesByErrorCode,
      oldestEntry: sorted[0]?.createdAt,
      newestEntry: sorted[sorted.length - 1]?.createdAt,
      reprocessableCount,
    };
  }

  /**
   * Get entries by task type
   */
  getEntriesByType(taskType: DeadLetterEntry['taskType']): DeadLetterEntry[] {
    return this.getAllEntries().filter(e => e.taskType === taskType);
  }

  /**
   * Get entries by error code
   */
  getEntriesByErrorCode(errorCode: string): DeadLetterEntry[] {
    return this.getAllEntries().filter(e => String(e.finalError.code) === errorCode);
  }

  /**
   * Clean up old entries based on retention policy
   */
  cleanupExpired(): number {
    const cutoff = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
    let removed = 0;

    for (const [id, entry] of this.entries) {
      if (new Date(entry.createdAt).getTime() < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      this.log.info(`Cleaned up ${removed} expired DLQ entries`);
      if (this.config.enablePersistence) {
        this.persistToDisk();
      }
    }

    return removed;
  }

  /**
   * Generate a unique ID for DLQ entries
   */
  private generateId(): string {
    return `dlq-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Evict the oldest entry when at capacity
   */
  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Infinity;

    for (const [id, entry] of this.entries) {
      const time = new Date(entry.createdAt).getTime();
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.entries.delete(oldestId);
      this.log.debug(`Evicted oldest DLQ entry due to capacity limit`, { dlqId: oldestId });
    }
  }

  /**
   * Load entries from disk
   */
  private loadFromDisk(): void {
    try {
      const filePath = join(this.persistPath, 'dlq.json');
      if (!existsSync(filePath)) return;

      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data)) {
        for (const entry of data) {
          this.entries.set(entry.id, entry);
        }
        this.log.debug(`Loaded ${this.entries.size} DLQ entries from disk`);
      }
    } catch (error) {
      this.log.warn('Failed to load DLQ from disk', { error: (error as Error).message });
    }
  }

  /**
   * Persist entries to disk
   */
  private persistToDisk(): void {
    try {
      if (!existsSync(this.persistPath)) {
        mkdirSync(this.persistPath, { recursive: true });
      }

      const filePath = join(this.persistPath, 'dlq.json');
      const data = JSON.stringify(this.getAllEntries(), null, 2);
      writeFileSync(filePath, data);
      this.log.debug(`Persisted ${this.entries.size} DLQ entries to disk`);
    } catch (error) {
      this.log.warn('Failed to persist DLQ to disk', { error: (error as Error).message });
    }
  }
}

// Singleton instance
let dlqInstance: DeadLetterQueue | undefined;

/**
 * Get or create the dead letter queue instance
 */
export function getDeadLetterQueue(
  config?: Partial<DLQConfig>,
  workDir?: string
): DeadLetterQueue {
  if (!dlqInstance) {
    dlqInstance = new DeadLetterQueue(config, workDir);
  }
  return dlqInstance;
}

/**
 * Reset the DLQ instance (for testing)
 */
export function resetDeadLetterQueue(): void {
  dlqInstance = undefined;
}
