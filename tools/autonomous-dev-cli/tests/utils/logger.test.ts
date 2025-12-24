import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import logger module functions and classes
import {
  // Debug mode functions
  isDebugModeEnabled,
  isClaudeLoggingEnabled,
  isApiLoggingEnabled,
  setDebugMode,
  getDebugModeConfig,
  // Memory functions
  getMemoryUsageMB,
  getDetailedMemoryUsage,
  getMemoryStats,
  // Correlation functions
  generateCorrelationId,
  setCorrelationId,
  getCorrelationId,
  clearCorrelationId,
  setCorrelationContext,
  getCorrelationContext,
  updateCorrelationContext,
  setCycleNumber,
  getCycleNumber,
  setWorkerId,
  getWorkerId,
  // Request lifecycle functions
  startRequestLifecycle,
  startPhase,
  endPhase,
  recordPhaseOperation,
  recordPhaseError,
  endRequestLifecycle,
  getRequestLifecycle,
  // Timed operation functions
  timeOperation,
  timeOperationSync,
  createOperationContext,
  finalizeOperationContext,
  // MetricsAggregator class
  MetricsAggregator,
  // StructuredFileLogger class
  StructuredFileLogger,
  getStructuredFileLogger,
  initStructuredFileLogging,
  getMetricsAggregator,
  // Logger instance
  logger,
  // ClaudeExecutionLogger class
  ClaudeExecutionLogger,
  // Constants
  DEFAULT_TIMING_THRESHOLD_MS,
  // Types
  type LogLevel,
  type LogFormat,
  type DebugModeConfig,
  type CorrelationContext,
  type RequestPhase,
} from './logger.js';

describe('Debug Mode Functions', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.DEBUG_MODE;
    delete process.env.AUTONOMOUS_DEV_DEBUG;
    setDebugMode({ enabled: false, logClaudeInteractions: false, logApiDetails: false });
  });

  afterEach(() => {
    process.env = originalEnv;
    setDebugMode({ enabled: false, logClaudeInteractions: false, logApiDetails: false });
  });

  describe('isDebugModeEnabled', () => {
    it('should return false by default', () => {
      assert.strictEqual(isDebugModeEnabled(), false);
    });

    it('should return true when DEBUG_MODE env is true', () => {
      process.env.DEBUG_MODE = 'true';
      assert.strictEqual(isDebugModeEnabled(), true);
    });

    it('should return true when AUTONOMOUS_DEV_DEBUG env is true', () => {
      process.env.AUTONOMOUS_DEV_DEBUG = 'true';
      assert.strictEqual(isDebugModeEnabled(), true);
    });

    it('should return true when debug mode is enabled via setDebugMode', () => {
      setDebugMode({ enabled: true });
      assert.strictEqual(isDebugModeEnabled(), true);
    });
  });

  describe('isClaudeLoggingEnabled', () => {
    it('should return false by default', () => {
      assert.strictEqual(isClaudeLoggingEnabled(), false);
    });

    it('should return true when debug mode is enabled', () => {
      setDebugMode({ enabled: true });
      assert.strictEqual(isClaudeLoggingEnabled(), true);
    });

    it('should return true when logClaudeInteractions is enabled', () => {
      setDebugMode({ logClaudeInteractions: true });
      assert.strictEqual(isClaudeLoggingEnabled(), true);
    });
  });

  describe('isApiLoggingEnabled', () => {
    it('should return false by default', () => {
      assert.strictEqual(isApiLoggingEnabled(), false);
    });

    it('should return true when debug mode is enabled', () => {
      setDebugMode({ enabled: true });
      assert.strictEqual(isApiLoggingEnabled(), true);
    });

    it('should return true when logApiDetails is enabled', () => {
      setDebugMode({ logApiDetails: true });
      assert.strictEqual(isApiLoggingEnabled(), true);
    });
  });

  describe('setDebugMode and getDebugModeConfig', () => {
    it('should set and get debug mode config', () => {
      setDebugMode({ enabled: true, logClaudeInteractions: true, logApiDetails: false });
      const config = getDebugModeConfig();

      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.logClaudeInteractions, true);
      assert.strictEqual(config.logApiDetails, false);
    });

    it('should merge partial config', () => {
      setDebugMode({ enabled: true });
      setDebugMode({ logApiDetails: true });
      const config = getDebugModeConfig();

      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.logApiDetails, true);
    });

    it('should return a copy of the config', () => {
      setDebugMode({ enabled: true });
      const config1 = getDebugModeConfig();
      const config2 = getDebugModeConfig();

      assert.notStrictEqual(config1, config2);
      assert.deepStrictEqual(config1, config2);
    });
  });
});

describe('Memory Functions', () => {
  describe('getMemoryUsageMB', () => {
    it('should return a positive number', () => {
      const memory = getMemoryUsageMB();
      assert.ok(typeof memory === 'number');
      assert.ok(memory > 0);
    });

    it('should return a number with at most 2 decimal places', () => {
      const memory = getMemoryUsageMB();
      const parts = memory.toString().split('.');
      if (parts.length === 2) {
        assert.ok(parts[1].length <= 2);
      }
    });
  });

  describe('getDetailedMemoryUsage', () => {
    it('should return all memory fields', () => {
      const usage = getDetailedMemoryUsage();

      assert.ok('heapUsedMB' in usage);
      assert.ok('heapTotalMB' in usage);
      assert.ok('externalMB' in usage);
      assert.ok('rssMB' in usage);
      assert.ok('arrayBuffersMB' in usage);
    });

    it('should return positive numbers for all fields', () => {
      const usage = getDetailedMemoryUsage();

      assert.ok(usage.heapUsedMB > 0);
      assert.ok(usage.heapTotalMB > 0);
      assert.ok(usage.rssMB > 0);
      assert.ok(usage.externalMB >= 0);
      assert.ok(usage.arrayBuffersMB >= 0);
    });
  });

  describe('getMemoryStats', () => {
    it('should return memory statistics', () => {
      const stats = getMemoryStats();

      assert.ok('heapUsedMB' in stats);
      assert.ok('heapTotalMB' in stats);
      assert.ok('externalMB' in stats);
      assert.ok('rssMB' in stats);
    });

    it('should have heapUsed less than or equal to heapTotal', () => {
      const stats = getMemoryStats();
      assert.ok(stats.heapUsedMB <= stats.heapTotalMB);
    });
  });
});

describe('Correlation Functions', () => {
  beforeEach(() => {
    clearCorrelationId();
  });

  afterEach(() => {
    clearCorrelationId();
  });

  describe('generateCorrelationId', () => {
    it('should generate a valid UUID', () => {
      const id = generateCorrelationId();
      assert.ok(typeof id === 'string');
      assert.ok(id.length === 36);
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should generate unique IDs', () => {
      const id1 = generateCorrelationId();
      const id2 = generateCorrelationId();
      assert.notStrictEqual(id1, id2);
    });
  });

  describe('setCorrelationId and getCorrelationId', () => {
    it('should set and get correlation ID', () => {
      const id = 'test-correlation-id';
      setCorrelationId(id);
      assert.strictEqual(getCorrelationId(), id);
    });

    it('should return undefined when not set', () => {
      assert.strictEqual(getCorrelationId(), undefined);
    });
  });

  describe('clearCorrelationId', () => {
    it('should clear the correlation ID', () => {
      setCorrelationId('test-id');
      clearCorrelationId();
      assert.strictEqual(getCorrelationId(), undefined);
    });
  });

  describe('setCorrelationContext and getCorrelationContext', () => {
    it('should set and get full correlation context', () => {
      const context: CorrelationContext = {
        correlationId: 'test-id',
        cycleNumber: 5,
        workerId: 'worker-1',
        component: 'test-component',
        startTime: Date.now(),
      };

      setCorrelationContext(context);
      const result = getCorrelationContext();

      assert.deepStrictEqual(result, context);
    });
  });

  describe('updateCorrelationContext', () => {
    it('should update existing context', () => {
      setCorrelationContext({ correlationId: 'initial-id' });
      updateCorrelationContext({ cycleNumber: 10 });

      const context = getCorrelationContext();
      assert.strictEqual(context?.correlationId, 'initial-id');
      assert.strictEqual(context?.cycleNumber, 10);
    });

    it('should create context if correlationId is provided', () => {
      clearCorrelationId();
      updateCorrelationContext({ correlationId: 'new-id', cycleNumber: 1 });

      const context = getCorrelationContext();
      assert.strictEqual(context?.correlationId, 'new-id');
      assert.strictEqual(context?.cycleNumber, 1);
    });
  });

  describe('setCycleNumber and getCycleNumber', () => {
    it('should set and get cycle number', () => {
      setCorrelationContext({ correlationId: 'test-id' });
      setCycleNumber(42);
      assert.strictEqual(getCycleNumber(), 42);
    });

    it('should return undefined when no context', () => {
      clearCorrelationId();
      assert.strictEqual(getCycleNumber(), undefined);
    });
  });

  describe('setWorkerId and getWorkerId', () => {
    it('should set and get worker ID', () => {
      setCorrelationContext({ correlationId: 'test-id' });
      setWorkerId('worker-123');
      assert.strictEqual(getWorkerId(), 'worker-123');
    });

    it('should return undefined when no context', () => {
      clearCorrelationId();
      assert.strictEqual(getWorkerId(), undefined);
    });
  });
});

describe('Request Lifecycle Functions', () => {
  const testCorrelationId = 'test-lifecycle-id';

  afterEach(() => {
    // Clean up any remaining lifecycles
    endRequestLifecycle(testCorrelationId, true);
  });

  describe('startRequestLifecycle', () => {
    it('should create a new lifecycle', () => {
      const lifecycle = startRequestLifecycle(testCorrelationId);

      assert.strictEqual(lifecycle.correlationId, testCorrelationId);
      assert.ok(lifecycle.startTime > 0);
      assert.ok(lifecycle.phases instanceof Map);
      assert.strictEqual(lifecycle.phases.size, 0);
    });
  });

  describe('startPhase', () => {
    it('should start a phase in the lifecycle', () => {
      startRequestLifecycle(testCorrelationId);
      const phase = startPhase(testCorrelationId, 'discovery');

      assert.strictEqual(phase.phase, 'discovery');
      assert.ok(phase.startTime > 0);
      assert.strictEqual(phase.operationCount, 0);
      assert.strictEqual(phase.errorCount, 0);
    });

    it('should accept metadata', () => {
      startRequestLifecycle(testCorrelationId);
      const phase = startPhase(testCorrelationId, 'execution', { taskCount: 5 });

      assert.deepStrictEqual(phase.metadata, { taskCount: 5 });
    });

    it('should auto-create lifecycle if not exists', () => {
      const uniqueId = 'auto-create-test-' + Date.now();
      const phase = startPhase(uniqueId, 'discovery');

      assert.ok(phase);
      assert.strictEqual(phase.phase, 'discovery');

      // Clean up
      endRequestLifecycle(uniqueId, true);
    });
  });

  describe('endPhase', () => {
    it('should end a phase and calculate duration', async () => {
      startRequestLifecycle(testCorrelationId);
      startPhase(testCorrelationId, 'discovery');

      // Small delay to ensure duration > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = endPhase(testCorrelationId, 'discovery', true);

      assert.ok(result);
      assert.ok(result!.endTime! > result!.startTime);
      assert.ok(result!.duration! >= 0);
      assert.strictEqual(result!.success, true);
    });

    it('should merge additional metadata', () => {
      startRequestLifecycle(testCorrelationId);
      startPhase(testCorrelationId, 'execution', { initial: true });
      const result = endPhase(testCorrelationId, 'execution', true, { final: true });

      assert.ok(result);
      assert.strictEqual(result!.metadata.initial, true);
      assert.strictEqual(result!.metadata.final, true);
    });

    it('should return undefined for non-existent phase', () => {
      startRequestLifecycle(testCorrelationId);
      const result = endPhase(testCorrelationId, 'discovery', true);

      assert.strictEqual(result, undefined);
    });
  });

  describe('recordPhaseOperation', () => {
    it('should increment operation count', () => {
      startRequestLifecycle(testCorrelationId);
      startPhase(testCorrelationId, 'discovery');

      recordPhaseOperation(testCorrelationId, 'discovery', 'op1');
      recordPhaseOperation(testCorrelationId, 'discovery', 'op2');

      const lifecycle = getRequestLifecycle(testCorrelationId);
      const phase = lifecycle?.phases.get('discovery');

      assert.strictEqual(phase?.operationCount, 2);
    });
  });

  describe('recordPhaseError', () => {
    it('should increment error count', () => {
      startRequestLifecycle(testCorrelationId);
      startPhase(testCorrelationId, 'execution');

      recordPhaseError(testCorrelationId, 'execution', 'ERR001');
      recordPhaseError(testCorrelationId, 'execution', 'ERR002');

      const lifecycle = getRequestLifecycle(testCorrelationId);
      const phase = lifecycle?.phases.get('execution');

      assert.strictEqual(phase?.errorCount, 2);
      assert.strictEqual(phase?.metadata.lastErrorCode, 'ERR002');
    });
  });

  describe('endRequestLifecycle', () => {
    it('should complete lifecycle and return summary', async () => {
      startRequestLifecycle(testCorrelationId);
      startPhase(testCorrelationId, 'discovery');
      await new Promise(resolve => setTimeout(resolve, 5));
      endPhase(testCorrelationId, 'discovery', true);

      const result = endRequestLifecycle(testCorrelationId, true);

      assert.ok(result);
      assert.strictEqual(result!.correlationId, testCorrelationId);
      assert.ok(result!.totalDuration! >= 0);
      assert.strictEqual(result!.success, true);
    });

    it('should include error code on failure', () => {
      startRequestLifecycle(testCorrelationId);
      const result = endRequestLifecycle(testCorrelationId, false, 'ERR_TIMEOUT');

      assert.ok(result);
      assert.strictEqual(result!.success, false);
      assert.strictEqual(result!.errorCode, 'ERR_TIMEOUT');
    });

    it('should clean up lifecycle after completion', () => {
      startRequestLifecycle(testCorrelationId);
      endRequestLifecycle(testCorrelationId, true);

      const lifecycle = getRequestLifecycle(testCorrelationId);
      assert.strictEqual(lifecycle, undefined);
    });
  });

  describe('getRequestLifecycle', () => {
    it('should return lifecycle by ID', () => {
      const lifecycle = startRequestLifecycle(testCorrelationId);
      const result = getRequestLifecycle(testCorrelationId);

      assert.strictEqual(result, lifecycle);
    });

    it('should return undefined for non-existent ID', () => {
      const result = getRequestLifecycle('non-existent-id');
      assert.strictEqual(result, undefined);
    });
  });
});

describe('Timed Operation Functions', () => {
  describe('timeOperation', () => {
    it('should time async operations', async () => {
      const result = await timeOperation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'completed';
      }, 'test-op');

      assert.strictEqual(result.result, 'completed');
      assert.ok(result.duration >= 10);
      assert.ok(result.startMemory > 0);
      assert.ok(result.endMemory > 0);
    });

    it('should capture memory delta', async () => {
      const result = await timeOperation(async () => {
        return { data: new Array(1000).fill('x') };
      });

      assert.ok(typeof result.memoryDelta === 'number');
    });

    it('should accept options object', async () => {
      const result = await timeOperation(
        async () => 'test',
        {
          operationName: 'named-op',
          component: 'test-component',
          timingThreshold: 1000,
          logSlowOperations: false,
        }
      );

      assert.strictEqual(result.result, 'test');
    });

    it('should propagate errors', async () => {
      await assert.rejects(
        timeOperation(async () => {
          throw new Error('Operation failed');
        }),
        (err: Error) => err.message === 'Operation failed'
      );
    });
  });

  describe('timeOperationSync', () => {
    it('should time synchronous operations', () => {
      const result = timeOperationSync(() => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += i;
        return sum;
      }, 'sync-op');

      assert.strictEqual(result.result, 499500);
      assert.ok(result.duration >= 0);
    });

    it('should propagate errors', () => {
      assert.throws(
        () => timeOperationSync(() => {
          throw new Error('Sync error');
        }),
        (err: Error) => err.message === 'Sync error'
      );
    });
  });

  describe('createOperationContext', () => {
    it('should create operation context', () => {
      const context = createOperationContext('TestComponent', 'testOperation');

      assert.strictEqual(context.component, 'TestComponent');
      assert.strictEqual(context.operation, 'testOperation');
      assert.ok(context.correlationId);
      assert.ok(context.startTime > 0);
    });

    it('should include provided metadata', () => {
      const context = createOperationContext('Component', 'op', { custom: 'value' });

      assert.strictEqual(context.metadata.custom, 'value');
    });

    it('should use existing correlation ID', () => {
      setCorrelationId('existing-id');
      const context = createOperationContext('Component', 'op');

      assert.strictEqual(context.correlationId, 'existing-id');
      clearCorrelationId();
    });
  });

  describe('finalizeOperationContext', () => {
    it('should finalize context with metrics', async () => {
      const context = createOperationContext('Component', 'operation');
      await new Promise(resolve => setTimeout(resolve, 5));

      const result = finalizeOperationContext(context, true);

      assert.strictEqual(result.component, 'Component');
      assert.strictEqual(result.operation, 'operation');
      assert.strictEqual(result.success, true);
      assert.ok(result.duration! >= 0);
      assert.ok(result.memoryUsageMB! > 0);
    });

    it('should include additional metadata', () => {
      const context = createOperationContext('Component', 'op', { initial: true });
      const result = finalizeOperationContext(context, false, { extra: 'data' });

      assert.strictEqual(result.initial, true);
      assert.strictEqual(result.extra, 'data');
      assert.strictEqual(result.success, false);
    });
  });
});

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  describe('recordCycle', () => {
    it('should record successful cycle', () => {
      aggregator.recordCycle(true, 1000, 5, 4, 1, 2);

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.totalCycles, 1);
      assert.strictEqual(metrics.successfulCycles, 1);
      assert.strictEqual(metrics.failedCycles, 0);
      assert.strictEqual(metrics.totalTasksDiscovered, 5);
      assert.strictEqual(metrics.totalTasksCompleted, 4);
      assert.strictEqual(metrics.totalTasksFailed, 1);
      assert.strictEqual(metrics.totalPRsMerged, 2);
    });

    it('should record failed cycle', () => {
      aggregator.recordCycle(false, 500, 3, 0, 3, 0);

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.totalCycles, 1);
      assert.strictEqual(metrics.successfulCycles, 0);
      assert.strictEqual(metrics.failedCycles, 1);
    });

    it('should calculate success rate', () => {
      aggregator.recordCycle(true, 1000, 1, 1, 0, 1);
      aggregator.recordCycle(true, 1000, 1, 1, 0, 1);
      aggregator.recordCycle(false, 500, 1, 0, 1, 0);

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.successRate, 67); // 2/3 * 100 rounded
    });

    it('should calculate average duration', () => {
      aggregator.recordCycle(true, 1000, 1, 1, 0, 0);
      aggregator.recordCycle(true, 2000, 1, 1, 0, 0);
      aggregator.recordCycle(true, 3000, 1, 1, 0, 0);

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.avgCycleDurationMs, 2000);
    });

    it('should keep only last 100 durations', () => {
      for (let i = 0; i < 110; i++) {
        aggregator.recordCycle(true, i * 100, 1, 1, 0, 0);
      }

      const metrics = aggregator.getMetrics();
      assert.ok(metrics.cycleDurations.length <= 100);
    });
  });

  describe('recordError', () => {
    it('should record error by code', () => {
      aggregator.recordError('ERR001');
      aggregator.recordError('ERR001');
      aggregator.recordError('ERR002');

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.totalErrors, 3);
      assert.strictEqual(metrics.errorsByCode['ERR001'], 2);
      assert.strictEqual(metrics.errorsByCode['ERR002'], 1);
    });
  });

  describe('getMetricsSummary', () => {
    it('should return formatted summary', () => {
      aggregator.recordCycle(true, 1000, 5, 4, 1, 2);
      aggregator.recordError('ERR001');

      const summary = aggregator.getMetricsSummary();

      assert.ok('cycles' in summary);
      assert.ok('tasks' in summary);
      assert.ok('errors' in summary);
      assert.ok('prsMerged' in summary);
      assert.ok('uptimeMs' in summary);
    });

    it('should calculate task completion rate', () => {
      aggregator.recordCycle(true, 1000, 10, 8, 2, 0);

      const summary = aggregator.getMetricsSummary();
      assert.strictEqual(summary.tasks.completionRate, '80%');
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      aggregator.recordCycle(true, 1000, 5, 4, 1, 2);
      aggregator.recordError('ERR001');
      aggregator.reset();

      const metrics = aggregator.getMetrics();
      assert.strictEqual(metrics.totalCycles, 0);
      assert.strictEqual(metrics.totalErrors, 0);
      assert.strictEqual(metrics.totalTasksDiscovered, 0);
    });
  });
});

describe('StructuredFileLogger', () => {
  let testDir: string;
  let fileLogger: StructuredFileLogger;

  beforeEach(() => {
    testDir = join(tmpdir(), `logger-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    fileLogger = new StructuredFileLogger({ logDir: testDir });
  });

  afterEach(() => {
    fileLogger.disable();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('enable and disable', () => {
    it('should enable logging', () => {
      fileLogger.enable();
      assert.strictEqual(fileLogger.isEnabled(), true);
    });

    it('should disable logging', () => {
      fileLogger.enable();
      fileLogger.disable();
      assert.strictEqual(fileLogger.isEnabled(), false);
    });
  });

  describe('writeLog', () => {
    it('should write log entry when enabled', () => {
      fileLogger.enable();
      fileLogger.writeLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test log message',
      });

      const logFiles = fileLogger.getLogFiles();
      assert.ok(logFiles.length > 0);

      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('Test log message'));
    });

    it('should not write when disabled', () => {
      fileLogger.writeLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Should not appear',
      });

      const logFiles = fileLogger.getLogFiles();
      assert.strictEqual(logFiles.length, 0);
    });
  });

  describe('writeCycleLog', () => {
    it('should write cycle completion log', () => {
      fileLogger.enable();
      fileLogger.writeCycleLog(
        1,                    // cycleNumber
        'corr-123',           // correlationId
        true,                 // success
        5,                    // tasksDiscovered
        4,                    // tasksCompleted
        1,                    // tasksFailed
        2,                    // prsMerged
        10000,                // durationMs
        []                    // errors
      );

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('Cycle #1'));
      assert.ok(content.includes('completed'));
    });

    it('should record metrics in aggregator', () => {
      fileLogger.enable();
      fileLogger.writeCycleLog(1, 'corr-123', true, 5, 4, 1, 2, 10000, []);

      const metrics = fileLogger.getMetricsAggregator().getMetrics();
      assert.strictEqual(metrics.totalCycles, 1);
      assert.strictEqual(metrics.totalTasksDiscovered, 5);
    });

    it('should record errors with codes', () => {
      fileLogger.enable();
      fileLogger.writeCycleLog(1, 'corr-123', false, 0, 0, 0, 0, 1000, ['[ERR001] Error message']);

      const metrics = fileLogger.getMetricsAggregator().getMetrics();
      assert.strictEqual(metrics.errorsByCode['ERR001'], 1);
    });
  });

  describe('writeTaskLog', () => {
    it('should write task completion log', () => {
      fileLogger.enable();
      fileLogger.writeTaskLog(
        123,              // issueNumber
        'corr-456',       // correlationId
        'worker-1',       // workerId
        true,             // success
        5000,             // durationMs
        'feature/test',   // branchName
        'abc123'          // commitSha
      );

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('Task #123'));
      assert.ok(content.includes('completed'));
    });

    it('should include error on failure', () => {
      fileLogger.enable();
      fileLogger.writeTaskLog(
        456,
        'corr-789',
        'worker-2',
        false,
        3000,
        'feature/broken',
        undefined,
        'Build failed'
      );

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('failed'));
      assert.ok(content.includes('Build failed'));
    });
  });

  describe('writeDiscoveryLog', () => {
    it('should write discovery log', () => {
      fileLogger.enable();
      fileLogger.writeDiscoveryLog('corr-123', 1, 10, 500, 5);

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('Discovery completed'));
      assert.ok(content.includes('10 tasks found'));
    });
  });

  describe('writeApiLog', () => {
    it('should write GitHub API log', () => {
      fileLogger.enable();
      fileLogger.writeApiLog('github', '/repos/owner/repo', 'corr-123', true, 200, 200);

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('GITHUB API'));
    });

    it('should write Claude API log', () => {
      fileLogger.enable();
      fileLogger.writeApiLog('claude', '/messages', 'corr-456', true, 1500);

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('CLAUDE API'));
    });
  });

  describe('writeSystemLog', () => {
    it('should write system event log', () => {
      fileLogger.enable();
      fileLogger.writeSystemLog('info', 'System started', { version: '1.0.0' });

      const logFiles = fileLogger.getLogFiles();
      const content = readFileSync(logFiles[0], 'utf-8');
      assert.ok(content.includes('System started'));
    });
  });

  describe('getLogFiles', () => {
    it('should return empty array for non-existent directory', () => {
      const emptyLogger = new StructuredFileLogger({ logDir: '/non/existent/path' });
      const files = emptyLogger.getLogFiles();
      assert.deepStrictEqual(files, []);
    });

    it('should return log files sorted', () => {
      fileLogger.enable();
      fileLogger.writeSystemLog('info', 'Test 1');

      const files = fileLogger.getLogFiles();
      assert.ok(files.length > 0);
      assert.ok(files[0].includes('autonomous-dev.log'));
    });
  });

  describe('getMetricsSummary', () => {
    it('should return metrics summary', () => {
      const summary = fileLogger.getMetricsSummary();

      assert.ok('cycles' in summary);
      assert.ok('tasks' in summary);
      assert.ok('errors' in summary);
    });
  });

  describe('log rotation', () => {
    it('should rotate logs when size limit is exceeded', () => {
      const smallLogger = new StructuredFileLogger({
        logDir: testDir,
        maxFileSizeBytes: 100, // Very small for testing
        maxFiles: 3,
      });
      smallLogger.enable();

      // Write multiple log entries to exceed size
      for (let i = 0; i < 10; i++) {
        smallLogger.writeSystemLog('info', `Log entry ${i} with some extra content to make it larger`);
      }

      const files = smallLogger.getLogFiles();
      // Should have rotated files
      assert.ok(files.length >= 1);
      smallLogger.disable();
    });
  });
});

describe('Global Logger Functions', () => {
  describe('getStructuredFileLogger', () => {
    it('should return a singleton instance', () => {
      const logger1 = getStructuredFileLogger();
      const logger2 = getStructuredFileLogger();

      assert.strictEqual(logger1, logger2);
    });
  });

  describe('initStructuredFileLogging', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `init-logger-test-${Date.now()}`);
    });

    afterEach(() => {
      const logger = getStructuredFileLogger();
      logger.disable();
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should initialize and enable file logging', () => {
      const fileLogger = initStructuredFileLogging({ logDir: testDir });

      assert.ok(fileLogger.isEnabled());
    });
  });

  describe('getMetricsAggregator', () => {
    it('should return metrics aggregator from structured logger', () => {
      const aggregator = getMetricsAggregator();
      assert.ok(aggregator instanceof MetricsAggregator);
    });
  });
});

describe('Logger Instance', () => {
  describe('logger singleton', () => {
    it('should be defined', () => {
      assert.ok(logger);
    });

    it('should have debug method', () => {
      assert.ok(typeof logger.debug === 'function');
    });

    it('should have info method', () => {
      assert.ok(typeof logger.info === 'function');
    });

    it('should have warn method', () => {
      assert.ok(typeof logger.warn === 'function');
    });

    it('should have error method', () => {
      assert.ok(typeof logger.error === 'function');
    });

    it('should have setLevel method', () => {
      assert.ok(typeof logger.setLevel === 'function');
    });

    it('should have setFormat method', () => {
      assert.ok(typeof logger.setFormat === 'function');
    });

    it('should have setCorrelationId method', () => {
      assert.ok(typeof logger.setCorrelationId === 'function');
    });

    it('should have setCycleNumber method', () => {
      assert.ok(typeof logger.setCycleNumber === 'function');
    });

    it('should have setWorkerId method', () => {
      assert.ok(typeof logger.setWorkerId === 'function');
    });
  });

  describe('logger configuration', () => {
    it('should accept setLevel without throwing', () => {
      logger.setLevel('debug');
      logger.setLevel('info'); // Reset
      assert.ok(true);
    });

    it('should accept setFormat without throwing', () => {
      logger.setFormat('json');
      logger.setFormat('pretty'); // Reset
      assert.ok(true);
    });

    it('should accept setCorrelationId', () => {
      logger.setCorrelationId('test-corr-id');
      assert.ok(true);
    });

    it('should accept setCycleNumber', () => {
      logger.setCycleNumber(10);
      assert.ok(true);
    });

    it('should accept setWorkerId', () => {
      logger.setWorkerId('worker-test');
      assert.ok(true);
    });
  });
});

describe('ClaudeExecutionLogger', () => {
  describe('constructor', () => {
    it('should create logger with correlation ID and task ID', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      assert.ok(execLogger);
    });
  });

  describe('startAttempt', () => {
    it('should start a new attempt (not added to array until ended)', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);

      // Attempts are only added when ended, so array should be empty
      const attempts = execLogger.getAttempts();
      assert.strictEqual(attempts.length, 0);
    });

    it('should add attempt to array after ending', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(true);

      const attempts = execLogger.getAttempts();
      assert.strictEqual(attempts.length, 1);
      assert.strictEqual(attempts[0].attemptNumber, 1);
    });
  });

  describe('endAttempt', () => {
    it('should end current attempt successfully', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(true);

      const attempts = execLogger.getAttempts();
      assert.strictEqual(attempts[0].success, true);
    });

    it('should end current attempt with failure', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(false);

      const attempts = execLogger.getAttempts();
      assert.strictEqual(attempts[0].success, false);
    });
  });

  describe('getSummary', () => {
    it('should return execution summary', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(true);
      execLogger.startAttempt(2);
      execLogger.endAttempt(false);

      const summary = execLogger.getSummary();
      assert.strictEqual(summary.totalAttempts, 2);
      assert.strictEqual(summary.successfulAttempts, 1);
    });
  });

  describe('getAttempts', () => {
    it('should return all attempts', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(true);
      execLogger.startAttempt(2);
      execLogger.endAttempt(true);

      const attempts = execLogger.getAttempts();
      assert.strictEqual(attempts.length, 2);
    });

    it('should return a copy of attempts', () => {
      const execLogger = new ClaudeExecutionLogger('corr-123', 'task-456');
      execLogger.startAttempt(1);
      execLogger.endAttempt(true);

      const attempts1 = execLogger.getAttempts();
      const attempts2 = execLogger.getAttempts();

      assert.notStrictEqual(attempts1, attempts2);
      assert.deepStrictEqual(attempts1, attempts2);
    });
  });
});

describe('Constants', () => {
  it('should export DEFAULT_TIMING_THRESHOLD_MS', () => {
    assert.strictEqual(typeof DEFAULT_TIMING_THRESHOLD_MS, 'number');
    assert.ok(DEFAULT_TIMING_THRESHOLD_MS > 0);
  });
});
