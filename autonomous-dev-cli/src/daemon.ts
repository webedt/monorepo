import { loadConfig, type Config } from './config/index.js';
import { initDatabase, getUserCredentials, updateUserClaudeAuth, closeDatabase, softDeleteSessionsByIssue } from './db/index.js';
import { createGitHub, type GitHub, type Issue, type ServiceHealth } from './github/index.js';
import { formatBuildInfo } from './utils/buildInfo.js';
import { simpleGit } from 'simple-git';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import {
  validateEmail,
  validateWorkDir,
  validateRepoInfo,
  validateEnvironmentVariables,
} from './utils/validation.js';
import {
  discoverTasks,
  createDeduplicator,
  getParallelSafeTasks,
  initPersistentCache,
  getPersistentCache,
  updateStatusFile,
  type DiscoveredTask,
  type DeduplicatedTask,
  type CacheConfig,
} from './discovery/index.js';
import {
  createPreviewSession,
  runInteractivePreview,
  PreviewSessionManager,
  type PreviewTask,
  type PreviewResult,
} from './preview/index.js';
import { createWorkerPool, type WorkerTask, type PoolResult, type WorkerPool } from './executor/index.js';
import { runEvaluation, type EvaluationResult } from './evaluation/index.js';
import { createConflictResolver } from './conflicts/index.js';
import {
  logger,
  generateCorrelationId,
  setCorrelationId,
  clearCorrelationId,
  getCorrelationId,
  setCycleNumber,
  setCorrelationContext,
  getMemoryUsageMB,
  getMemoryStats,
  timeOperation,
  createOperationContext,
  finalizeOperationContext,
  startRequestLifecycle,
  endRequestLifecycle,
  startPhase,
  endPhase,
  initStructuredFileLogging,
  getStructuredFileLogger,
  setDebugMode,
  isDebugModeEnabled,
  type LogFormat,
  type OperationMetadata,
  type CorrelationContext,
  type StructuredFileLogger,
} from './utils/logger.js';
import {
  getProgressManager,
  formatDuration,
  type ProgressManager,
  type CyclePhase,
} from './utils/progress.js';
import { metrics } from './utils/metrics.js';
import { createMonitoringServer, type MonitoringServer } from './utils/monitoring.js';
import {
  createHealthServer,
  type HealthServer,
  type DaemonStateProvider,
  type DaemonStatus,
  type WorkerPoolStatus,
  type ErrorMetrics,
} from './monitoring/index.js';
import {
  StructuredError,
  ErrorCode,
  GitHubError,
  ClaudeError,
  ConfigError,
  wrapError,
  getErrorMessage,
  normalizeError,
  type ErrorContext,
} from './utils/errors.js';
import {
  ClaudeExecutorError,
  isClaudeExecutorError,
  type ClaudeExecutionContext,
} from './errors/executor-errors.js';
import { join } from 'path';
import chalk from 'chalk';
import { refreshClaudeToken, shouldRefreshToken, InvalidRefreshTokenError } from './utils/claudeAuth.js';

/**
 * Aggregated service health for all external dependencies
 */
interface DaemonServiceHealth {
  github: ServiceHealth | null;
  overallStatus: 'healthy' | 'degraded' | 'unavailable';
  lastCheck: Date;
}

export interface DaemonOptions {
  configPath?: string;
  profile?: string;
  dryRun?: boolean;
  verbose?: boolean;
  singleCycle?: boolean;
  logFormat?: LogFormat;
  monitoringPort?: number;
  /** Enable preview mode - tasks require approval before execution */
  previewMode?: boolean;
  /** Auto-approve all discovered tasks (for CI/CD automation) */
  autoApprove?: boolean;
  /** Path to load pre-approved tasks from a batch file */
  approvedTasksFile?: string;
}

export interface CycleResult {
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

export class Daemon implements DaemonStateProvider {
  private config: Config;
  private github: GitHub | null = null;
  private isRunning: boolean = false;
  private cycleCount: number = 0;
  private options: DaemonOptions;
  private userId: string | null = null;
  private enableDatabaseLogging: boolean = false;
  private monitoringServer: MonitoringServer | null = null;
  private healthServer: HealthServer | null = null;
  private repository: string = '';
  private lastKnownIssues: Issue[] = [];  // Cache for graceful degradation
  private serviceHealth: DaemonServiceHealth = {
    github: null,
    overallStatus: 'healthy',
    lastCheck: new Date(),
  };

  // Health monitoring state
  private startTime: Date = new Date();
  private lastCycleTime: Date | null = null;
  private lastCycleSuccess: boolean | null = null;
  private lastCycleDuration: number | null = null;
  private currentWorkerPool: WorkerPool | null = null;
  private totalErrors: number = 0;
  private lastErrorTime: Date | null = null;
  private errorsByType: Record<string, number> = {};
  private recentErrors: { time: Date; type: string }[] = [];
  private daemonStatus: 'running' | 'stopped' | 'starting' | 'stopping' = 'stopped';

  // Structured file logging
  private structuredLogger: StructuredFileLogger | null = null;

  // Progress tracking
  private progressManager: ProgressManager;

  // Graceful shutdown state
  private isShuttingDown: boolean = false;
  private shutdownTimeoutMs: number = 60000; // Default 60 second timeout
  private signalHandlersRegistered: boolean = false;

  // Claude auth state - tracks if refresh token is permanently invalid
  private claudeAuthInvalid: boolean = false;

  constructor(options: DaemonOptions = {}) {
    this.options = options;

    // Load config
    this.config = loadConfig(options.configPath);

    // Initialize progress manager (will be updated with JSON mode after log format is set)
    this.progressManager = getProgressManager(options.logFormat === 'json');

    // Configure logging from config (can be overridden by options)
    if (this.config.logging) {
      logger.setFormat(this.config.logging.format);
      logger.setLevel(this.config.logging.level);
      logger.setIncludeCorrelationId(this.config.logging.includeCorrelationId);
      logger.setIncludeTimestamp(this.config.logging.includeTimestamp);

      // Initialize debug mode from configuration
      // Debug mode can be enabled via config, env vars, or verbose flag
      const debugModeEnabled = this.config.logging.debugMode ||
        process.env.DEBUG_MODE === 'true' ||
        process.env.AUTONOMOUS_DEV_DEBUG === 'true' ||
        options.verbose === true;

      setDebugMode({
        enabled: debugModeEnabled,
        logClaudeInteractions: this.config.logging.logClaudeInteractions || debugModeEnabled,
        logApiDetails: this.config.logging.logApiDetails || debugModeEnabled,
      });

      if (debugModeEnabled) {
        logger.info('Debug mode enabled', {
          debugMode: debugModeEnabled,
          logClaudeInteractions: this.config.logging.logClaudeInteractions || debugModeEnabled,
          logApiDetails: this.config.logging.logApiDetails || debugModeEnabled,
          source: options.verbose ? 'verbose-flag' : (process.env.DEBUG_MODE || process.env.AUTONOMOUS_DEV_DEBUG ? 'environment' : 'config'),
        });
      }

      // Initialize structured file logging if enabled
      if (this.config.logging.enableStructuredFileLogging) {
        this.structuredLogger = initStructuredFileLogging({
          logDir: this.config.logging.structuredLogDir,
          maxFileSizeBytes: this.config.logging.maxLogFileSizeBytes,
          maxFiles: this.config.logging.maxLogFiles,
          includeMetrics: this.config.logging.includeMetrics,
        });
        logger.info('Structured file logging enabled', {
          logDir: this.config.logging.structuredLogDir,
          maxFileSizeBytes: this.config.logging.maxLogFileSizeBytes,
          maxFiles: this.config.logging.maxLogFiles,
        });
      }
    }

    // Override with verbose flag if set (also enables debug mode)
    if (options.verbose) {
      logger.setLevel('debug');
      setDebugMode({ enabled: true, logClaudeInteractions: true, logApiDetails: true });
    }

    // Override log format if explicitly set in options
    if (options.logFormat) {
      logger.setFormat(options.logFormat);
    }
  }

  async start(): Promise<void> {
    logger.header('Autonomous Dev CLI');
    console.log(`Build: ${formatBuildInfo()}`);
    console.log();
    logger.info('Starting daemon...');

    // Register signal handlers for graceful shutdown
    this.registerSignalHandlers();

    this.daemonStatus = 'starting';
    this.startTime = new Date();

    // Log daemon startup to structured file log
    if (this.structuredLogger?.isEnabled()) {
      this.structuredLogger.writeSystemLog('info', 'Daemon starting', {
        startTime: this.startTime.toISOString(),
        repository: `${this.config.repo.owner}/${this.config.repo.name}`,
        config: {
          parallelWorkers: this.config.execution.parallelWorkers,
          timeoutMinutes: this.config.execution.timeoutMinutes,
          tasksPerCycle: this.config.discovery.tasksPerCycle,
          maxOpenIssues: this.config.discovery.maxOpenIssues,
        },
      });
    }

    try {
      // Initialize
      await this.initialize();

      // Start monitoring server if port is configured
      if (this.options.monitoringPort) {
        await this.startMonitoringServer();
        await this.startHealthServer();
      }

      // Update health status
      metrics.updateHealthStatus(true);

      this.isRunning = true;
      this.daemonStatus = 'running';

      // Main loop
      while (this.isRunning) {
        this.cycleCount++;

        // Generate correlation ID for this cycle
        const cycleCorrelationId = generateCorrelationId();

        // Set full correlation context with cycle number
        const correlationContext: CorrelationContext = {
          correlationId: cycleCorrelationId,
          cycleNumber: this.cycleCount,
          component: 'Daemon',
          startTime: Date.now(),
        };
        setCorrelationContext(correlationContext);

        // Start correlation tracking in metrics
        metrics.startCorrelation(cycleCorrelationId);

        // Create operation context for the cycle
        const cycleContext = createOperationContext('Daemon', 'executeCycle', {
          cycleNumber: this.cycleCount,
        });

        const cycleStartMemory = getMemoryUsageMB();

        // Start request lifecycle tracking for the entire cycle
        startRequestLifecycle(cycleCorrelationId);

        logger.header(`Cycle #${this.cycleCount}`);

        // Initialize progress tracking for this cycle
        this.progressManager.startCycle(this.cycleCount, 6);

        logger.info(`Starting cycle`, {
          cycle: this.cycleCount,
          correlationId: cycleCorrelationId,
          memoryUsageMB: cycleStartMemory,
        });

        // Log memory snapshot at cycle start
        logger.memorySnapshot('Daemon', `Cycle #${this.cycleCount} start`);

        const result = await this.runCycle();

        // Update last cycle tracking for health monitoring
        this.lastCycleTime = new Date();
        this.lastCycleSuccess = result.success;
        this.lastCycleDuration = result.duration;

        // Track errors for health monitoring
        if (result.errors.length > 0) {
          this.totalErrors += result.errors.length;
          this.lastErrorTime = new Date();
          for (const error of result.errors) {
            const errorType = this.extractErrorType(error);
            this.errorsByType[errorType] = (this.errorsByType[errorType] || 0) + 1;
            this.recentErrors.push({ time: new Date(), type: errorType });
          }
          // Keep only last 100 recent errors for rate calculation
          if (this.recentErrors.length > 100) {
            this.recentErrors = this.recentErrors.slice(-100);
          }
        }

        // Calculate memory delta for the cycle
        const cycleEndMemory = getMemoryUsageMB();
        const memoryDelta = Math.round((cycleEndMemory - cycleStartMemory) * 100) / 100;

        // Update progress manager with final task counts before ending the cycle
        this.progressManager.updateTaskCounts(
          result.tasksDiscovered,
          result.tasksCompleted,
          result.tasksFailed,
          result.prsMerged
        );

        // Log cycle result (this calls displayCycleSummary internally)
        this.logCycleResult(result);

        // End progress tracking for this cycle
        this.progressManager.endCycle(result.success);

        // Write to structured file log if enabled
        if (this.structuredLogger?.isEnabled()) {
          this.structuredLogger.writeCycleLog(
            this.cycleCount,
            cycleCorrelationId,
            result.success,
            result.tasksDiscovered,
            result.tasksCompleted,
            result.tasksFailed,
            result.prsMerged,
            result.duration,
            result.errors
          );
        }

        // Record cycle metrics
        metrics.recordCycleCompletion(
          result.tasksDiscovered,
          result.tasksCompleted,
          result.tasksFailed,
          result.duration,
          { repository: this.repository }
        );

        // Update memory metrics
        metrics.updateMemoryUsage(cycleEndMemory);

        // End correlation tracking and get summary
        const correlationSummary = metrics.endCorrelation(cycleCorrelationId);

        // Log cycle completion with metrics
        const cycleMetadata = finalizeOperationContext(cycleContext, result.success, {
          tasksDiscovered: result.tasksDiscovered,
          tasksCompleted: result.tasksCompleted,
          tasksFailed: result.tasksFailed,
          prsMerged: result.prsMerged,
          memoryDeltaMB: memoryDelta,
          degraded: result.degraded,
          operationCount: correlationSummary?.operationCount,
          errorCount: correlationSummary?.errorCount,
        });

        logger.operationComplete('Daemon', 'executeCycle', result.success, cycleMetadata);

        // Log memory snapshot at cycle end
        logger.memorySnapshot('Daemon', `Cycle #${this.cycleCount} end`);

        // End request lifecycle tracking with summary
        endRequestLifecycle(cycleCorrelationId, result.success, result.errors.length > 0 ? 'CYCLE_HAD_ERRORS' : undefined);

        // Clear correlation ID after cycle
        clearCorrelationId();

        if (this.options.singleCycle) {
          logger.info('Single cycle mode - exiting');
          break;
        }

        if (!this.isRunning) {
          break;
        }

        // Wait before next cycle
        if (this.config.daemon.pauseBetweenCycles) {
          logger.info(`Waiting ${this.config.daemon.loopIntervalMs / 1000}s before next cycle...`);
          this.progressManager.showWaiting(this.config.daemon.loopIntervalMs);
          await this.sleep(this.config.daemon.loopIntervalMs);
        }
      }
    } catch (error: unknown) {
      const structuredError = this.wrapDaemonError(error);
      logger.structuredError(structuredError, {
        context: this.getErrorContext('start'),
        includeStack: true,
        includeRecovery: true,
      });
      throw structuredError;
    } finally {
      await this.shutdown();
    }
  }

  /**
   * Wrap any error as a StructuredError with daemon-specific context
   */
  private wrapDaemonError(error: unknown, operation?: string): StructuredError {
    return normalizeError(error, ErrorCode.INTERNAL_ERROR, {
      operation: operation ?? 'daemon',
      component: 'Daemon',
    });
  }

  /**
   * Get current error context for debugging
   */
  private getErrorContext(operation: string): ErrorContext {
    return {
      operation,
      component: 'Daemon',
      cycleCount: this.cycleCount,
      isRunning: this.isRunning,
      config: {
        repo: `${this.config.repo.owner}/${this.config.repo.name}`,
        baseBranch: this.config.repo.baseBranch,
        parallelWorkers: this.config.execution.parallelWorkers,
        timeoutMinutes: this.config.execution.timeoutMinutes,
      },
      systemState: {
        userId: this.userId ?? 'not-set',
        databaseLogging: this.enableDatabaseLogging,
        dryRun: this.options.dryRun ?? false,
      },
    };
  }

  async stop(): Promise<void> {
    logger.info('Stop requested...');
    this.daemonStatus = 'stopping';
    this.isRunning = false;
    metrics.updateHealthStatus(false);
  }

  /**
   * Register process signal handlers for graceful shutdown
   */
  private registerSignalHandlers(): void {
    if (this.signalHandlersRegistered) {
      return;
    }

    const handleShutdownSignal = async (signal: string) => {
      if (this.isShuttingDown) {
        logger.warn(`Received ${signal} during shutdown, forcing exit...`);
        process.exit(1);
      }

      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      this.isShuttingDown = true;
      this.isRunning = false;
      this.daemonStatus = 'stopping';

      try {
        await this.gracefulShutdown();
        logger.info('Graceful shutdown completed successfully');
        process.exit(0);
      } catch (error: unknown) {
        logger.error(`Shutdown error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
    process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
    process.on('SIGHUP', () => handleShutdownSignal('SIGHUP'));

    this.signalHandlersRegistered = true;
    logger.debug('Signal handlers registered for graceful shutdown');
  }

  /**
   * Perform graceful shutdown with cleanup of all resources
   * - Cancels running worker tasks gracefully
   * - Cleans up temporary directories in workDir
   * - Ensures database connections are properly closed
   * - Waits for in-progress GitHub operations to complete
   * - Applies shutdown timeout to prevent hanging
   */
  private async gracefulShutdown(): Promise<void> {
    logger.info('Starting graceful shutdown sequence...');

    const shutdownStart = Date.now();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Shutdown timeout exceeded (${this.shutdownTimeoutMs}ms)`));
      }, this.shutdownTimeoutMs);
    });

    try {
      // Run shutdown with timeout
      await Promise.race([
        this.performShutdownSteps(),
        timeoutPromise,
      ]);

      const duration = Date.now() - shutdownStart;
      logger.info(`Graceful shutdown completed in ${duration}ms`);
    } catch (error: unknown) {
      const duration = Date.now() - shutdownStart;
      const errorMsg = getErrorMessage(error);
      if (errorMsg.includes('Shutdown timeout')) {
        logger.error(`Shutdown timeout after ${duration}ms, forcing cleanup...`);
        // Force cleanup even on timeout
        await this.forceCleanup();
      } else {
        logger.error(`Shutdown error after ${duration}ms: ${errorMsg}`);
        throw error;
      }
    }
  }

  /**
   * Execute all shutdown steps in sequence
   */
  private async performShutdownSteps(): Promise<void> {
    // Step 1: Stop worker pool gracefully (wait for active workers)
    if (this.currentWorkerPool) {
      logger.info('Stopping worker pool and waiting for active workers...');
      try {
        const remainingTasks = await this.currentWorkerPool.gracefulShutdown(
          Math.floor(this.shutdownTimeoutMs * 0.7) // Use 70% of timeout for workers
        );
        if (remainingTasks.length > 0) {
          logger.warn(`${remainingTasks.length} tasks were not completed during shutdown`);
        }
        this.currentWorkerPool = null;
        logger.info('Worker pool shutdown complete');
      } catch (error: unknown) {
        logger.error(`Worker pool shutdown error: ${getErrorMessage(error)}`);
        // Continue with other cleanup even if worker pool fails
      }
    }

    // Step 2: Clean up temporary work directories
    await this.cleanupWorkDirectories();

    // Step 3: Run the standard shutdown (monitoring, health server, database)
    await this.shutdown();
  }

  /**
   * Force cleanup when graceful shutdown times out
   */
  private async forceCleanup(): Promise<void> {
    logger.warn('Performing forced cleanup...');

    // Force stop worker pool without waiting
    if (this.currentWorkerPool) {
      this.currentWorkerPool.stop();
      this.currentWorkerPool = null;
    }

    // Clean up work directories
    try {
      await this.cleanupWorkDirectories();
    } catch (error: unknown) {
      logger.error(`Work directory cleanup error: ${getErrorMessage(error)}`);
    }

    // Force close database
    try {
      await closeDatabase();
    } catch (error: unknown) {
      logger.error(`Database close error: ${getErrorMessage(error)}`);
    }

    // Stop servers
    if (this.healthServer) {
      try {
        await this.healthServer.stop();
      } catch (error: unknown) {
        logger.error(`Health server stop error: ${getErrorMessage(error)}`);
      }
    }

    if (this.monitoringServer) {
      try {
        await this.monitoringServer.stop();
      } catch (error: unknown) {
        logger.error(`Monitoring server stop error: ${getErrorMessage(error)}`);
      }
    }

    logger.warn('Forced cleanup completed');
  }

  /**
   * Clean up temporary work directories created during task execution
   */
  private async cleanupWorkDirectories(): Promise<void> {
    const workDir = this.config.execution.workDir;

    if (!existsSync(workDir)) {
      logger.debug('Work directory does not exist, skipping cleanup');
      return;
    }

    logger.info(`Cleaning up temporary directories in ${workDir}...`);

    try {
      const entries = readdirSync(workDir, { withFileTypes: true });
      let cleanedCount = 0;
      let errorCount = 0;

      for (const entry of entries) {
        // Clean up task directories (task-*) and analysis directory
        if (entry.isDirectory() && (entry.name.startsWith('task-') || entry.name === 'analysis')) {
          const dirPath = join(workDir, entry.name);
          try {
            rmSync(dirPath, { recursive: true, force: true });
            cleanedCount++;
            logger.debug(`Cleaned up directory: ${dirPath}`);
          } catch (error: unknown) {
            errorCount++;
            logger.warn(`Failed to clean up directory ${dirPath}: ${getErrorMessage(error)}`);
          }
        }

        // Clean up old queue persistence files
        if (entry.isDirectory() && entry.name === 'queue-persist') {
          const persistDir = join(workDir, entry.name);
          try {
            const persistFiles = readdirSync(persistDir);
            for (const file of persistFiles) {
              if (file.startsWith('queue-') && file.endsWith('.json')) {
                const filePath = join(persistDir, file);
                rmSync(filePath, { force: true });
                logger.debug(`Cleaned up persist file: ${filePath}`);
              }
            }
            cleanedCount++;
          } catch (error: unknown) {
            errorCount++;
            logger.warn(`Failed to clean up persist directory: ${getErrorMessage(error)}`);
          }
        }
      }

      if (cleanedCount > 0 || errorCount > 0) {
        logger.info(`Work directory cleanup: ${cleanedCount} directories cleaned, ${errorCount} errors`);
      }
    } catch (error: unknown) {
      logger.error(`Failed to read work directory for cleanup: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get the current correlation ID from the global context
   */
  private getCurrentCorrelationId(): string {
    return getCorrelationId() || 'unknown';
  }

  /**
   * Update and return the current service health status
   */
  private updateServiceHealth(): DaemonServiceHealth {
    const githubHealth = this.github?.client.getServiceHealth() ?? null;

    let overallStatus: DaemonServiceHealth['overallStatus'] = 'healthy';

    if (githubHealth) {
      if (githubHealth.status === 'unavailable') {
        overallStatus = 'unavailable';
      } else if (githubHealth.status === 'degraded') {
        overallStatus = 'degraded';
      }
    }

    this.serviceHealth = {
      github: githubHealth,
      overallStatus,
      lastCheck: new Date(),
    };

    return this.serviceHealth;
  }

  /**
   * Get the current internal service health status
   */
  getInternalServiceHealth(): DaemonServiceHealth {
    return this.serviceHealth;
  }

  /**
   * Log the current service health status
   */
  private logServiceHealthStatus(): void {
    const health = this.updateServiceHealth();

    if (health.github) {
      logger.serviceStatus('GitHub API', health.github.status, {
        circuitState: health.github.circuitState,
        consecutiveFailures: health.github.consecutiveFailures,
        rateLimitRemaining: health.github.rateLimitRemaining,
      });
    }

    if (health.overallStatus !== 'healthy') {
      logger.degraded(
        'Services',
        `Operating in ${health.overallStatus} mode`,
        { github: health.github?.status }
      );
    }
  }

  /**
   * Start the monitoring server for health checks and metrics
   */
  private async startMonitoringServer(): Promise<void> {
    if (!this.options.monitoringPort) return;

    this.monitoringServer = createMonitoringServer({
      port: this.options.monitoringPort,
      host: '0.0.0.0',
    });

    // Register health checks
    this.monitoringServer.registerHealthCheck(async () => {
      if (!this.github) {
        return {
          name: 'github',
          status: 'fail',
          message: 'GitHub client not initialized',
        };
      }

      const health = this.github.client.getServiceHealth();
      const statusMap: Record<string, 'pass' | 'fail'> = {
        healthy: 'pass',
        degraded: 'pass',  // Still operational, just degraded
        unavailable: 'fail',
      };

      return {
        name: 'github',
        status: statusMap[health.status] ?? 'fail',
        message: `GitHub API ${health.status} (circuit: ${health.circuitState})`,
      };
    });

    this.monitoringServer.registerHealthCheck(async () => ({
      name: 'database',
      status: this.enableDatabaseLogging ? 'pass' : 'pass', // Pass if DB not required
      message: this.enableDatabaseLogging ? 'Database connected' : 'Database logging disabled',
    }));

    this.monitoringServer.registerHealthCheck(async () => ({
      name: 'daemon',
      status: this.isRunning ? 'pass' : 'fail',
      message: this.isRunning ? `Running cycle ${this.cycleCount}` : 'Daemon not running',
    }));

    await this.monitoringServer.start();
  }

  /**
   * Start the health server for external monitoring
   */
  private async startHealthServer(): Promise<void> {
    if (!this.options.monitoringPort) return;

    // Use port + 1 for health server to avoid conflict with monitoring server
    const healthPort = this.options.monitoringPort + 1;

    this.healthServer = createHealthServer({
      port: healthPort,
      host: '0.0.0.0',
    });

    // Set this daemon as the state provider
    this.healthServer.setStateProvider(this);

    // Register health checks
    this.healthServer.registerHealthCheck(async () => {
      if (!this.github) {
        return {
          name: 'github',
          status: 'fail',
          message: 'GitHub client not initialized',
        };
      }

      const health = this.github.client.getServiceHealth();
      const statusMap: Record<string, 'pass' | 'fail' | 'warn'> = {
        healthy: 'pass',
        degraded: 'warn',
        unavailable: 'fail',
      };

      return {
        name: 'github',
        status: statusMap[health.status] ?? 'fail',
        message: `GitHub API ${health.status} (circuit: ${health.circuitState})`,
      };
    });

    this.healthServer.registerHealthCheck(async () => ({
      name: 'database',
      status: this.enableDatabaseLogging ? 'pass' : 'pass',
      message: this.enableDatabaseLogging ? 'Database connected' : 'Database logging disabled',
    }));

    this.healthServer.registerHealthCheck(async () => ({
      name: 'daemon',
      status: this.isRunning ? 'pass' : 'fail',
      message: this.isRunning ? `Running cycle ${this.cycleCount}` : 'Daemon not running',
    }));

    await this.healthServer.start();
  }

  /**
   * DaemonStateProvider implementation: Get current daemon status
   */
  getDaemonStatus(): DaemonStatus {
    return {
      status: this.daemonStatus,
      cycleCount: this.cycleCount,
      lastCycleTime: this.lastCycleTime,
      lastCycleSuccess: this.lastCycleSuccess,
      lastCycleDuration: this.lastCycleDuration,
      startTime: this.startTime,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      version: '0.1.0',
    };
  }

  /**
   * DaemonStateProvider implementation: Get worker pool status
   */
  getWorkerPoolStatus(): WorkerPoolStatus | null {
    if (!this.currentWorkerPool) {
      return {
        activeWorkers: 0,
        queuedTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        maxWorkers: this.config.execution.parallelWorkers,
        isRunning: false,
      };
    }

    const status = this.currentWorkerPool.getStatus();
    return {
      activeWorkers: status.active,
      queuedTasks: status.queued,
      completedTasks: status.succeeded,
      failedTasks: status.failed,
      maxWorkers: this.config.execution.parallelWorkers,
      isRunning: status.active > 0 || status.queued > 0,
    };
  }

  /**
   * DaemonStateProvider implementation: Get error metrics
   */
  getErrorMetrics(): ErrorMetrics {
    // Calculate recent error rate (errors in last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentErrorCount = this.recentErrors.filter(
      (e) => e.time.getTime() > fiveMinutesAgo
    ).length;
    const recentErrorRate = recentErrorCount / 5; // errors per minute

    return {
      totalErrors: this.totalErrors,
      recentErrorRate,
      lastErrorTime: this.lastErrorTime,
      errorsByType: { ...this.errorsByType },
    };
  }

  /**
   * DaemonStateProvider implementation: Get service health
   */
  getServiceHealth(): {
    name: string;
    status: 'available' | 'degraded' | 'unavailable';
    latency?: number;
    details?: Record<string, any>;
  }[] {
    const services: {
      name: string;
      status: 'available' | 'degraded' | 'unavailable';
      latency?: number;
      details?: Record<string, any>;
    }[] = [];

    // GitHub service health
    if (this.github) {
      const health = this.github.client.getServiceHealth();
      const statusMap: Record<string, 'available' | 'degraded' | 'unavailable'> = {
        healthy: 'available',
        degraded: 'degraded',
        unavailable: 'unavailable',
      };

      services.push({
        name: 'github',
        status: statusMap[health.status] ?? 'unavailable',
        details: {
          circuitState: health.circuitState,
          consecutiveFailures: health.consecutiveFailures,
          rateLimitRemaining: health.rateLimitRemaining,
        },
      });
    }

    // Database service (if enabled)
    if (this.enableDatabaseLogging) {
      services.push({
        name: 'database',
        status: 'available',
        details: {
          userId: this.userId,
        },
      });
    }

    return services;
  }

  /**
   * Extract error type from error message for categorization
   */
  private extractErrorType(error: string): string {
    const errorMatch = error.match(/\[([^\]]+)\]/);
    if (errorMatch) {
      return errorMatch[1];
    }
    if (error.toLowerCase().includes('github')) return 'GITHUB_ERROR';
    if (error.toLowerCase().includes('claude')) return 'CLAUDE_ERROR';
    if (error.toLowerCase().includes('timeout')) return 'TIMEOUT_ERROR';
    if (error.toLowerCase().includes('network')) return 'NETWORK_ERROR';
    return 'UNKNOWN_ERROR';
  }

  /**
   * Format Claude execution context for display in logs
   */
  private formatClaudeExecutionContext(ctx: ClaudeExecutionContext): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(chalk.cyan('  === Claude Execution Context ==='));

    if (ctx.taskDescription) {
      lines.push(`    Task: ${ctx.taskDescription}`);
    }

    lines.push(`    Phase: ${chalk.yellow(ctx.executionPhase)}`);
    lines.push(`    Duration: ${formatDuration(ctx.executionDurationMs)}`);
    lines.push(`    Turns: ${ctx.turnsCompleted} | Tools Used: ${ctx.totalToolsUsed}`);

    if (ctx.currentTool) {
      lines.push('');
      lines.push(chalk.cyan('  === Tool at Error ==='));
      lines.push(`    Tool: ${chalk.red(ctx.currentTool)}`);
      if (ctx.currentToolInput) {
        const inputStr = JSON.stringify(ctx.currentToolInput);
        const truncatedInput = inputStr.length > 200 ? inputStr.slice(0, 200) + '...' : inputStr;
        lines.push(`    Input: ${chalk.gray(truncatedInput)}`);
      }
    }

    if (ctx.recentToolCalls.length > 0) {
      lines.push('');
      lines.push(chalk.cyan(`  === Recent Tool Calls (last ${ctx.recentToolCalls.length}) ===`));
      for (const call of ctx.recentToolCalls.slice(-5)) {
        const writeMarker = call.isWriteOperation ? chalk.yellow(' [WRITE]') : '';
        const pathInfo = call.filePath ? chalk.gray(` -> ${call.filePath}`) : '';
        lines.push(`    • ${call.toolName}${writeMarker}${pathInfo}`);
      }
    }

    if (ctx.fileChangesSummary.totalOperations > 0) {
      lines.push('');
      lines.push(chalk.cyan('  === File Changes Summary ==='));
      if (ctx.fileChangesSummary.created.length > 0) {
        lines.push(`    Created (${ctx.fileChangesSummary.created.length}):`);
        ctx.fileChangesSummary.created.slice(0, 5).forEach(f => lines.push(`      ${chalk.green('+')} ${f}`));
        if (ctx.fileChangesSummary.created.length > 5) {
          lines.push(`      ... and ${ctx.fileChangesSummary.created.length - 5} more`);
        }
      }
      if (ctx.fileChangesSummary.modified.length > 0) {
        lines.push(`    Modified (${ctx.fileChangesSummary.modified.length}):`);
        ctx.fileChangesSummary.modified.slice(0, 5).forEach(f => lines.push(`      ${chalk.yellow('~')} ${f}`));
        if (ctx.fileChangesSummary.modified.length > 5) {
          lines.push(`      ... and ${ctx.fileChangesSummary.modified.length - 5} more`);
        }
      }
      if (ctx.fileChangesSummary.deleted.length > 0) {
        lines.push(`    Deleted (${ctx.fileChangesSummary.deleted.length}):`);
        ctx.fileChangesSummary.deleted.slice(0, 5).forEach(f => lines.push(`      ${chalk.red('-')} ${f}`));
        if (ctx.fileChangesSummary.deleted.length > 5) {
          lines.push(`      ... and ${ctx.fileChangesSummary.deleted.length - 5} more`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Log enhanced error context for Claude execution failures
   */
  private logClaudeExecutorError(error: ClaudeExecutorError, issueNumber?: number): void {
    // Log structured error details
    logger.error(`Claude execution failed for issue #${issueNumber}`, {
      errorType: error.claudeErrorType,
      toolsUsed: error.toolsUsed,
      turnsCompleted: error.turnsCompleted,
      hasExecutionContext: !!error.claudeExecutionContext,
    });

    // If we have execution context, display it formatted
    if (error.claudeExecutionContext) {
      console.log(this.formatClaudeExecutionContext(error.claudeExecutionContext));
    }

    // Also log the detailed context summary from the error itself
    if (isDebugModeEnabled()) {
      console.log(chalk.gray('\n  --- Full Error Context Summary ---'));
      console.log(chalk.gray(error.getErrorContextSummary().split('\n').map(l => '  ' + l).join('\n')));
    }
  }

  /**
   * Get the health server port (for CLI status command)
   */
  getHealthServerPort(): number | null {
    return this.healthServer?.getPort() ?? null;
  }

  private async initialize(): Promise<void> {
    logger.info('Initializing...');

    // Validate environment variables at startup
    const envResult = validateEnvironmentVariables();
    if (!envResult.isValid) {
      logger.warn('Environment variable validation found issues:');
      for (const { envVar, error } of envResult.errors) {
        logger.warn(`  ${envVar}: ${error.message}`);
      }
    }
    if (envResult.warnings.length > 0) {
      for (const { envVar, message } of envResult.warnings) {
        logger.warn(`  ${envVar}: ${message}`);
      }
    }

    // Validate repository configuration
    const repoResult = validateRepoInfo(this.config.repo.owner, this.config.repo.name);
    if (!repoResult.valid) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAILED,
        repoResult.error?.message || 'Invalid repository configuration',
        {
          field: 'repo',
          context: this.getErrorContext('initialize'),
          recoveryActions: repoResult.error?.recoveryActions || [],
        }
      );
    }

    // Validate workDir for path traversal
    const workDirResult = validateWorkDir(this.config.execution.workDir);
    if (!workDirResult.valid) {
      throw new ConfigError(
        ErrorCode.CONFIG_VALIDATION_FAILED,
        workDirResult.error?.message || 'Invalid working directory',
        {
          field: 'execution.workDir',
          value: this.config.execution.workDir,
          context: this.getErrorContext('initialize'),
          recoveryActions: workDirResult.error?.recoveryActions || [],
        }
      );
    }

    // Set repository identifier for metrics
    this.repository = `${this.config.repo.owner}/${this.config.repo.name}`;

    // Load credentials from database if configured
    if (this.config.credentials.databaseUrl && this.config.credentials.userEmail) {
      // Validate email format before database query to prevent injection
      const emailResult = validateEmail(this.config.credentials.userEmail);
      if (!emailResult.valid) {
        throw new ConfigError(
          ErrorCode.CONFIG_VALIDATION_FAILED,
          emailResult.error?.message || 'Invalid email format',
          {
            field: 'credentials.userEmail',
            value: this.config.credentials.userEmail,
            context: this.getErrorContext('initialize'),
            recoveryActions: emailResult.error?.recoveryActions || [],
          }
        );
      }

      logger.info('Loading credentials from database...');

      await initDatabase(this.config.credentials.databaseUrl);
      const creds = await getUserCredentials(this.config.credentials.userEmail);

      if (creds) {
        // Store userId for database logging
        this.userId = creds.userId;
        this.enableDatabaseLogging = true;
        logger.info(`Database logging enabled for user: ${this.userId}`);

        if (creds.githubAccessToken) {
          this.config.credentials.githubToken = creds.githubAccessToken;
        }
        if (creds.claudeAuth) {
          this.config.credentials.claudeAuth = {
            accessToken: creds.claudeAuth.accessToken,
            refreshToken: creds.claudeAuth.refreshToken,
            expiresAt: creds.claudeAuth.expiresAt,
          };
        }
      } else {
        throw new ConfigError(
          ErrorCode.DB_USER_NOT_FOUND,
          `User not found in database: ${this.config.credentials.userEmail}`,
          {
            field: 'credentials.userEmail',
            value: this.config.credentials.userEmail,
            context: this.getErrorContext('initialize'),
          }
        );
      }
    }

    // Validate required credentials
    if (!this.config.credentials.githubToken) {
      throw new ConfigError(
        ErrorCode.CONFIG_MISSING_REQUIRED,
        'GitHub token not configured',
        {
          field: 'credentials.githubToken',
          recoveryActions: [
            {
              description: 'Set the GITHUB_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Add githubToken to your config file under credentials',
              automatic: false,
            },
            {
              description: 'Generate a new token at https://github.com/settings/tokens with repo scope',
              automatic: false,
            },
          ],
          context: this.getErrorContext('initialize'),
        }
      );
    }
    if (!this.config.credentials.claudeAuth) {
      throw new ConfigError(
        ErrorCode.CONFIG_MISSING_REQUIRED,
        'Claude authentication not configured',
        {
          field: 'credentials.claudeAuth',
          recoveryActions: [
            {
              description: 'Set the CLAUDE_ACCESS_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Configure Claude credentials in the database if using database authentication',
              automatic: false,
            },
          ],
          context: this.getErrorContext('initialize'),
        }
      );
    }

    // Initialize GitHub client
    this.github = createGitHub({
      token: this.config.credentials.githubToken,
      owner: this.config.repo.owner,
      repo: this.config.repo.name,
    });

    // Verify GitHub connection
    const user = await this.github.client.verifyAuth();
    logger.success(`Authenticated as: ${user.login}`);

    // Verify repository access
    const repo = await this.github.client.getRepo();
    logger.success(`Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`);

    // Create work directory
    if (!existsSync(this.config.execution.workDir)) {
      mkdirSync(this.config.execution.workDir, { recursive: true });
    }

    // Initialize and warm the analysis cache
    await this.initializeAnalysisCache();

    logger.success('Initialization complete');
  }

  /**
   * Initialize the persistent analysis cache with configuration from config file
   * and optionally warm the cache on startup
   */
  private async initializeAnalysisCache(): Promise<void> {
    // Skip if cache is disabled in config
    if (this.config.cache && !this.config.cache.enabled) {
      logger.debug('Analysis cache disabled in configuration');
      return;
    }

    try {
      // Build cache configuration from config schema
      const cacheConfig: Partial<CacheConfig> = {};

      if (this.config.cache) {
        cacheConfig.enabled = this.config.cache.enabled;
        cacheConfig.maxEntries = this.config.cache.maxEntries;
        cacheConfig.ttlMs = this.config.cache.ttlMinutes * 60 * 1000;
        cacheConfig.maxSizeBytes = this.config.cache.maxSizeMB * 1024 * 1024;
        cacheConfig.cacheDir = this.config.cache.cacheDir;
        cacheConfig.persistToDisk = this.config.cache.persistToDisk;
        cacheConfig.useGitInvalidation = this.config.cache.useGitInvalidation;
        cacheConfig.enableIncrementalAnalysis = this.config.cache.enableIncrementalAnalysis;
      }

      // Initialize the persistent cache
      const cache = await initPersistentCache(cacheConfig);

      const stats = cache.getStats();
      logger.info('Persistent analysis cache initialized', {
        entriesLoaded: stats.totalEntries,
        totalSizeBytes: stats.totalSizeBytes,
        config: {
          maxEntries: cacheConfig.maxEntries,
          ttlMinutes: this.config.cache?.ttlMinutes ?? 30,
          persistToDisk: cacheConfig.persistToDisk,
        },
      });

      // Warm the cache if enabled
      if (this.config.cache?.warmOnStartup) {
        await this.warmAnalysisCache(cache);
      }
    } catch (error) {
      // Cache initialization is non-critical, log warning and continue
      logger.warn('Failed to initialize analysis cache, continuing without persistent caching', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Warm the analysis cache by pre-validating cached entries
   */
  private async warmAnalysisCache(cache: ReturnType<typeof getPersistentCache>): Promise<void> {
    const startTime = Date.now();

    try {
      // Warm cache for the current working directory (typical analysis target)
      const repoPath = process.cwd();
      const excludePaths = this.config.discovery.excludePaths;

      await cache.warmCache([repoPath], excludePaths);

      const duration = Date.now() - startTime;
      const stats = cache.getStats();

      logger.info('Analysis cache warmed', {
        duration,
        validEntries: stats.totalEntries,
        hitRate: stats.hitRate,
      });
    } catch (error) {
      logger.warn('Cache warming failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async shutdown(): Promise<void> {
    logger.info('Shutting down...');

    // Log daemon shutdown to structured file log with final metrics summary
    if (this.structuredLogger?.isEnabled()) {
      const uptime = Date.now() - this.startTime.getTime();
      this.structuredLogger.writeSystemLog('info', 'Daemon shutting down', {
        shutdownTime: new Date().toISOString(),
        uptimeMs: uptime,
        totalCycles: this.cycleCount,
        finalMetrics: this.structuredLogger.getMetricsSummary(),
      });
    }

    // Update health status
    metrics.updateHealthStatus(false);
    this.daemonStatus = 'stopped';

    // Stop health server
    if (this.healthServer) {
      try {
        await this.healthServer.stop();
        logger.debug('Health server stopped');
      } catch (error: unknown) {
        logger.warn(`Failed to stop health server: ${getErrorMessage(error)}`);
      }
      this.healthServer = null;
    }

    // Stop monitoring server
    if (this.monitoringServer) {
      try {
        await this.monitoringServer.stop();
        logger.debug('Monitoring server stopped');
      } catch (error: unknown) {
        logger.warn(`Failed to stop monitoring server: ${getErrorMessage(error)}`);
      }
      this.monitoringServer = null;
    }

    // Close database connections with timeout
    try {
      await closeDatabase({
        timeoutMs: 10000, // 10 second timeout for database close
        force: this.isShuttingDown, // Force close during signal-triggered shutdown
      });
    } catch (error: unknown) {
      logger.error(`Failed to close database: ${getErrorMessage(error)}`);
      // Don't throw - we want to complete shutdown even if database close fails
    }

    logger.info('Shutdown complete');
  }

  private async runCycle(): Promise<CycleResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let tasksDiscovered = 0;
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let prsMerged = 0;
    let degraded = false;

    // Update service health at start of cycle
    this.logServiceHealthStatus();

    try {
      if (!this.github || !this.config.credentials.claudeAuth) {
        throw new StructuredError(
          ErrorCode.NOT_INITIALIZED,
          'Daemon not properly initialized: GitHub client or Claude auth is missing',
          {
            severity: 'critical',
            context: this.getErrorContext('runCycle'),
            recoveryActions: [
              {
                description: 'Call initialize() before running cycles',
                automatic: false,
              },
              {
                description: 'Check that credentials are properly configured',
                automatic: false,
              },
            ],
          }
        );
      }

      // Skip Claude token refresh if already marked as invalid
      if (this.claudeAuthInvalid) {
        logger.error('Claude authentication is invalid - daemon cannot continue. Please re-authenticate with Claude.');
        throw new StructuredError(
          ErrorCode.CLAUDE_AUTH_FAILED,
          'Claude authentication is invalid - refresh token expired or revoked. Please re-authenticate.',
          {
            recoveryActions: [
              { description: 'Re-authenticate with Claude through the web interface', automatic: false },
              { description: 'Update Claude credentials in the database', automatic: false },
            ],
          }
        );
      }

      // Proactively refresh Claude token if it's about to expire
      if (this.config.credentials.claudeAuth.expiresAt &&
          shouldRefreshToken(this.config.credentials.claudeAuth.expiresAt)) {
        logger.info('Claude token expiring soon, proactively refreshing');
        try {
          const newAuth = await refreshClaudeToken(this.config.credentials.claudeAuth.refreshToken);
          this.config.credentials.claudeAuth = newAuth;

          // Update database if we have a userId
          if (this.userId) {
            await updateUserClaudeAuth(this.userId, newAuth);
            logger.info('Claude token proactively refreshed and saved to database');
          } else {
            logger.info('Claude token proactively refreshed (no database update - no userId)');
          }
        } catch (refreshError) {
          // Check if this is an unrecoverable error (invalid/expired refresh token)
          if (refreshError instanceof InvalidRefreshTokenError) {
            this.claudeAuthInvalid = true;
            logger.error('Claude refresh token is invalid or expired - daemon cannot continue', {
              error: refreshError.message,
            });
            throw new StructuredError(
              ErrorCode.CLAUDE_AUTH_FAILED,
              'Claude refresh token is invalid or expired. Please re-authenticate.',
              {
                cause: refreshError,
                recoveryActions: [
                  { description: 'Re-authenticate with Claude through the web interface', automatic: false },
                  { description: 'Update Claude credentials in the database', automatic: false },
                ],
              }
            );
          }

          // For other errors, log warning and continue (will retry on demand)
          logger.warn('Failed to proactively refresh Claude token, will retry on demand', {
            error: refreshError instanceof Error ? refreshError.message : String(refreshError),
          });
        }
      }

      // STEP 1: Get existing issues with graceful degradation
      logger.cyclePhase('fetch-issues', 1, 6);
      this.progressManager.setPhase('fetch-issues', 1);
      metrics.recordCorrelationOperation(this.getCurrentCorrelationId(), 'fetch_issues');

      const { result: issueResult, duration: issueFetchDuration } = await timeOperation(
        () => this.github!.issues.listOpenIssuesWithFallback(
          this.config.discovery.issueLabel,
          this.lastKnownIssues  // Use cached issues as fallback
        ),
        'fetchIssues'
      );

      const existingIssues = issueResult.value;
      if (issueResult.degraded) {
        degraded = true;
        metrics.recordCorrelationError(this.getCurrentCorrelationId());
        logger.warn(`Using ${this.lastKnownIssues.length} cached issues due to GitHub API degradation`, {
          fetchDuration: issueFetchDuration,
        });
      } else {
        // Update cache with fresh data
        this.lastKnownIssues = existingIssues;
      }
      logger.info(`Found ${existingIssues.length} existing issues with label '${this.config.discovery.issueLabel}'${issueResult.degraded ? ' (cached)' : ''}`, {
        duration: issueFetchDuration,
        issueCount: existingIssues.length,
      });

      // Check if we have capacity for more issues
      const availableSlots = this.config.discovery.maxOpenIssues - existingIssues.length;

      // STEP 2: Discover new tasks (if we have capacity)
      let newIssues: Issue[] = [];

      if (availableSlots > 0 && !this.options.dryRun) {
        logger.cyclePhase('discover-tasks', 2, 6);
        this.progressManager.setPhase('discover-tasks', 2);

        // Clone target repo for analysis (shallow clone for speed)
        const analysisDir = join(this.config.execution.workDir, 'analysis');
        const repoUrl = `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`;
        // Inject GitHub token for authenticated clone (required for private repos)
        const authRepoUrl = this.config.credentials.githubToken
          ? repoUrl.replace('https://github.com/', `https://${this.config.credentials.githubToken}@github.com/`)
          : repoUrl;
        let repoPath = analysisDir;

        try {
          // Clean up previous analysis directory if it exists
          if (existsSync(analysisDir)) {
            rmSync(analysisDir, { recursive: true, force: true });
          }
          mkdirSync(analysisDir, { recursive: true });

          logger.info('Cloning repository for analysis...', {
            repoUrl, // Log without token for security
            branch: this.config.repo.baseBranch,
            targetDir: analysisDir,
          });

          const git = simpleGit();
          await git.clone(authRepoUrl, analysisDir, [
            '--depth', '1',
            '--branch', this.config.repo.baseBranch,
            '--single-branch',
          ]);

          logger.info('Repository cloned successfully for analysis');
        } catch (cloneError) {
          logger.warn('Failed to clone repository for analysis, falling back to local directory', {
            error: cloneError instanceof Error ? cloneError.message : String(cloneError),
          });
          repoPath = process.cwd();
        }

        try {
          // Create token refresh callback that updates both memory and database
          const onTokenRefresh = async (currentRefreshToken: string) => {
            logger.info('Refreshing Claude tokens via callback');
            const newAuth = await refreshClaudeToken(currentRefreshToken);

            // Update in-memory config
            this.config.credentials.claudeAuth = newAuth;

            // Update database if we have a userId
            if (this.userId) {
              await updateUserClaudeAuth(this.userId, newAuth);
              logger.info('Claude tokens updated in database', { userId: this.userId });
            }

            return newAuth;
          };

          const rawTasks = await discoverTasks({
            claudeAuth: this.config.credentials.claudeAuth,
            repoPath, // Use cloned repo or fallback to cwd
            excludePaths: this.config.discovery.excludePaths,
            tasksPerCycle: Math.min(this.config.discovery.tasksPerCycle, availableSlots),
            existingIssues,
            repoContext: `WebEDT - AI-powered coding assistant platform with React frontend, Express backend, and Claude Agent SDK integration.`,
            onTokenRefresh,
          });

          logger.info(`Discovered ${rawTasks.length} raw tasks, running deduplication...`);

          // Run deduplication and conflict detection
          const deduplicator = createDeduplicator({
            similarityThreshold: 0.7, // Flag tasks with >70% overlap
          });
          const deduplicatedTasks = await deduplicator.deduplicateTasks(rawTasks, existingIssues);

          // Filter out potential duplicates and get conflict-safe tasks
          const nonDuplicateTasks = deduplicator.filterDuplicates(deduplicatedTasks);
          const safeTasks = getParallelSafeTasks(nonDuplicateTasks);

          // Log deduplication results
          const duplicateCount = deduplicatedTasks.filter(t => t.isPotentialDuplicate).length;
          const highRiskCount = deduplicatedTasks.filter(t => t.conflictPrediction.hasHighConflictRisk).length;

          if (duplicateCount > 0) {
            logger.info(`Filtered out ${duplicateCount} potential duplicate tasks`);
          }
          if (highRiskCount > 0) {
            logger.info(`Found ${highRiskCount} tasks with high conflict risk`);
          }

          // Use non-duplicate tasks for issue creation, prioritizing safe tasks
          // Safe tasks (low conflict risk) come first, then higher risk tasks
          const tasks = deduplicator.getConflictSafeOrder(nonDuplicateTasks);

          tasksDiscovered = tasks.length;
          logger.info(`${tasks.length} tasks remaining after deduplication`);

          // Handle preview mode - require approval before creating issues
          let approvedTasks: (DiscoveredTask | DeduplicatedTask)[] = tasks;

          if (this.options.previewMode && tasks.length > 0) {
            logger.info('Preview mode enabled - tasks require approval before execution');

            // Load from batch file if specified
            if (this.options.approvedTasksFile) {
              const batch = PreviewSessionManager.loadFromBatchFile(this.options.approvedTasksFile);
              if (batch && batch.tasks.length > 0) {
                logger.info(`Loaded ${batch.tasks.length} pre-approved tasks from ${this.options.approvedTasksFile}`);
                // Use the pre-approved tasks (convert PreviewTask back to DiscoveredTask format)
                approvedTasks = batch.tasks.map((pt: PreviewTask) => ({
                  title: pt.title,
                  description: pt.description,
                  priority: pt.priority,
                  category: pt.category,
                  estimatedComplexity: pt.estimatedComplexity,
                  affectedPaths: pt.affectedPaths,
                  estimatedDurationMinutes: pt.estimatedDurationMinutes,
                  relatedIssues: pt.relatedIssues,
                } as DiscoveredTask));
              } else {
                logger.warn('Failed to load approved tasks from batch file, using auto-approve');
                approvedTasks = tasks;
              }
            } else if (this.options.autoApprove) {
              // Auto-approve mode for CI/CD
              logger.info('Auto-approve mode enabled - approving all discovered tasks');
              approvedTasks = tasks;
            } else {
              // Interactive preview mode
              const previewSession = createPreviewSession(tasks, process.cwd());

              // Run interactive preview
              const result = await runInteractivePreview(previewSession);

              // Only use approved tasks
              approvedTasks = result.approvedTasks.map((pt: PreviewTask) => ({
                title: pt.title,
                description: pt.description,
                priority: pt.priority,
                category: pt.category,
                estimatedComplexity: pt.estimatedComplexity,
                affectedPaths: pt.affectedPaths,
                estimatedDurationMinutes: pt.estimatedDurationMinutes,
                relatedIssues: pt.relatedIssues,
              } as DiscoveredTask));

              logger.info(`Preview complete: ${result.approvedTasks.length} approved, ${result.rejectedTasks.length} rejected, ${result.deferredTasks.length} deferred`);

              if (approvedTasks.length === 0) {
                logger.info('No tasks approved - skipping issue creation');
              }
            }
          }

          // Create GitHub issues for approved tasks
          // Check if GitHub is available before attempting to create issues
          if (!this.github.client.isAvailable()) {
            degraded = true;
            logger.degraded('GitHub', 'Skipping issue creation due to service degradation', {
              tasksDiscovered: approvedTasks.length,
            });
            errors.push(`[${ErrorCode.GITHUB_SERVICE_DEGRADED}] Issue creation skipped due to GitHub service degradation`);
          } else {
            for (const task of approvedTasks) {
              try {
                const issue = await this.createIssueForTask(task);
                newIssues.push(issue);
                logger.success(`Created issue #${issue.number}: ${issue.title}`);
              } catch (error: unknown) {
                const structuredError = error instanceof StructuredError
                  ? error
                  : new GitHubError(
                      ErrorCode.GITHUB_API_ERROR,
                      `Failed to create issue for "${task.title}": ${getErrorMessage(error)}`,
                      { context: { taskTitle: task.title }, cause: error instanceof Error ? error : undefined }
                    );
                errors.push(`[${structuredError.code}] ${structuredError.message}`);
                logger.structuredError(structuredError, { context: { taskTitle: task.title } });
              }
            }
          }
        } catch (error: unknown) {
          const structuredError = error instanceof StructuredError
            ? error
            : new ClaudeError(
                ErrorCode.CLAUDE_API_ERROR,
                `Task discovery failed: ${getErrorMessage(error)}`,
                { context: this.getErrorContext('discoverTasks'), cause: error instanceof Error ? error : undefined }
              );
          errors.push(`[${structuredError.code}] ${structuredError.message}`);
          logger.structuredError(structuredError, {
            context: this.getErrorContext('discoverTasks'),
            includeRecovery: true,
          });
          // Mark as degraded but continue with existing issues
          degraded = true;
        }
      } else if (availableSlots <= 0) {
        logger.info('Max open issues reached, skipping discovery');
      } else {
        logger.info('Dry run - skipping issue creation');
      }

      // STEP 3: Execute tasks
      logger.cyclePhase('execute-tasks', 3, 6);
      this.progressManager.setPhase('execute-tasks', 3);

      // Get all issues to work on (prioritize user-created, then auto-created)
      const allIssues = [...existingIssues, ...newIssues];
      const issuesToWork = allIssues
        .filter((i) => !i.labels.includes('in-progress'))
        .slice(0, this.config.execution.parallelWorkers);

      if (issuesToWork.length === 0) {
        logger.info('No issues to work on');
      } else if (this.options.dryRun) {
        logger.info(`Dry run - would execute ${issuesToWork.length} tasks`);
      } else {
        // Mark issues as in-progress with graceful degradation
        for (const issue of issuesToWork) {
          const labelResult = await this.github.issues.addLabelsWithFallback(issue.number, ['in-progress']);
          if (labelResult.degraded) {
            degraded = true;
          }
        }

        // Create token refresh callback for workers
        const workerTokenRefresh = async (currentRefreshToken: string) => {
          logger.info('Refreshing Claude tokens via worker callback');
          const newAuth = await refreshClaudeToken(currentRefreshToken);

          // Update in-memory config so subsequent workers get fresh tokens
          this.config.credentials.claudeAuth = newAuth;

          // Update database if we have a userId
          if (this.userId) {
            await updateUserClaudeAuth(this.userId, newAuth);
            logger.info('Claude tokens updated in database via worker refresh', { userId: this.userId });
          }

          return newAuth;
        };

        // Create worker pool and execute
        // NOTE: Workers load spec context (SPEC.md/STATUS.md) from the cloned repo
        this.currentWorkerPool = createWorkerPool({
          maxWorkers: this.config.execution.parallelWorkers,
          workDir: this.config.execution.workDir,
          repoUrl: `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`,
          baseBranch: this.config.repo.baseBranch,
          githubToken: this.config.credentials.githubToken!,
          claudeAuth: this.config.credentials.claudeAuth,
          timeoutMinutes: this.config.execution.timeoutMinutes,
          // Database logging options
          userId: this.userId || undefined,
          repoOwner: this.config.repo.owner,
          repoName: this.config.repo.name,
          enableDatabaseLogging: this.enableDatabaseLogging,
          // Correlation context for request tracing
          cycleCorrelationId: this.getCurrentCorrelationId(),
          cycleNumber: this.cycleCount,
          // Merge configuration for auto-PR and auto-merge after task completion
          mergeConfig: {
            autoMerge: this.config.merge.autoMerge,
            maxRetries: this.config.merge.maxRetries,
            conflictStrategy: this.config.merge.conflictStrategy,
            mergeMethod: this.config.merge.mergeMethod,
          },
          // Token refresh callback for workers to refresh tokens before execution
          onTokenRefresh: workerTokenRefresh,
        });

        const workerTasks: WorkerTask[] = issuesToWork.map((issue) => ({
          issue,
          branchName: this.generateBranchName(issue),
        }));

        const results = await this.currentWorkerPool.executeTasks(workerTasks);

        // Clear worker pool reference after execution
        this.currentWorkerPool = null;

        tasksCompleted = results.filter((r) => r.success).length;
        tasksFailed = results.filter((r) => !r.success).length;

        // STEP 4: Run evaluation pipeline on successful tasks
        logger.cyclePhase('evaluate', 4, 6);
        this.progressManager.setPhase('evaluate', 4);

        // Track which results pass evaluation (for merge step)
        const evaluationResults: Map<string, EvaluationResult> = new Map();
        const evaluationPassed: Set<string> = new Set();

        // Check if any evaluation is required
        const evaluationRequired = this.config.evaluation.requireBuild ||
          this.config.evaluation.requireTests ||
          this.config.evaluation.requireHealthCheck;

        for (const result of results) {
          if (!result.success) {
            // Handle failed task execution
            await this.github.issues.removeLabel(result.issue.number, 'in-progress');
            const labelResult = await this.github.issues.addLabelsWithFallback(result.issue.number, ['needs-review']);
            if (labelResult.degraded) {
              degraded = true;
            }
            const commentResult = await this.github.issues.addCommentWithFallback(
              result.issue.number,
              `⚠️ Autonomous implementation failed:\n\n\`\`\`\n${result.error}\n\`\`\``
            );
            if (commentResult.degraded) {
              degraded = true;
            }
            continue;
          }

          // Run evaluation pipeline if any evaluation is required
          if (evaluationRequired) {
            try {
              const evalResult = await runEvaluation({
                repoPath: join(this.config.execution.workDir, result.branchName),
                branchName: result.branchName,
                config: {
                  requireBuild: this.config.evaluation.requireBuild,
                  requireTests: this.config.evaluation.requireTests,
                  requireHealthCheck: this.config.evaluation.requireHealthCheck,
                  healthCheckUrls: this.config.evaluation.healthCheckUrls,
                  previewUrlPattern: this.config.evaluation.previewUrlPattern,
                },
                repoInfo: {
                  owner: this.config.repo.owner,
                  repo: this.config.repo.name,
                },
              });

              evaluationResults.set(result.branchName, evalResult);

              if (evalResult.success) {
                evaluationPassed.add(result.branchName);
                logger.success(`Evaluation passed for issue #${result.issue.number}`, {
                  issueNumber: result.issue.number,
                  branchName: result.branchName,
                  duration: evalResult.duration,
                });
              } else {
                // Evaluation failed - mark issue as needs-review
                logger.warn(`Evaluation failed for issue #${result.issue.number}`, {
                  issueNumber: result.issue.number,
                  branchName: result.branchName,
                  summary: evalResult.summary,
                });

                await this.github.issues.removeLabel(result.issue.number, 'in-progress');
                const labelResult = await this.github.issues.addLabelsWithFallback(
                  result.issue.number,
                  ['needs-review', 'evaluation-failed']
                );
                if (labelResult.degraded) {
                  degraded = true;
                }

                // Add evaluation results as comment on the issue
                const commentResult = await this.github.issues.addCommentWithFallback(
                  result.issue.number,
                  `⚠️ **Evaluation Failed**\n\nThe automated quality checks did not pass:\n\n${evalResult.summary}\n\n---\n*Duration: ${evalResult.duration}ms*`
                );
                if (commentResult.degraded) {
                  degraded = true;
                }

                errors.push(`[EVALUATION_FAILED] Evaluation failed for issue #${result.issue.number}: ${evalResult.summary.split('\n')[0]}`);
                tasksFailed++;
                tasksCompleted--;
              }
            } catch (evalError: any) {
              // Handle evaluation errors gracefully
              logger.error(`Evaluation error for issue #${result.issue.number}`, {
                error: evalError.message,
                issueNumber: result.issue.number,
                branchName: result.branchName,
              });

              // Mark as needs-review but don't block if evaluation itself fails
              await this.github.issues.removeLabel(result.issue.number, 'in-progress');
              await this.github.issues.addLabelsWithFallback(result.issue.number, ['needs-review', 'evaluation-error']);
              await this.github.issues.addCommentWithFallback(
                result.issue.number,
                `⚠️ **Evaluation Error**\n\nAn error occurred during evaluation:\n\n\`\`\`\n${evalError.message}\n\`\`\`\n\nPlease review manually.`
              );

              errors.push(`[EVALUATION_ERROR] Evaluation error for issue #${result.issue.number}: ${evalError.message}`);
            }
          } else {
            // No evaluation required - all successful tasks pass
            evaluationPassed.add(result.branchName);
          }
        }

        // STEP 5: Create PRs for tasks that passed evaluation
        logger.cyclePhase('create-prs', 5, 6);
        this.progressManager.setPhase('create-prs', 5);

        // Track created PRs for the merge step
        const createdPRs: Map<string, { prNumber: number; issueNumber: number }> = new Map();

        for (const result of results) {
          if (!result.success) {
            continue;
          }

          // Skip PR creation if evaluation failed
          if (!evaluationPassed.has(result.branchName)) {
            logger.info(`Skipping PR creation for issue #${result.issue.number} - evaluation did not pass`, {
              issueNumber: result.issue.number,
              branchName: result.branchName,
            });
            continue;
          }

          // Create PR with graceful degradation
          metrics.githubApiCallsTotal.inc({ repository: this.repository });

          const prResult = await this.github.pulls.createPRWithFallback({
            title: result.issue.title,
            body: this.generatePRBody(result.issue, evaluationResults.get(result.branchName)),
            head: result.branchName,
            base: this.config.repo.baseBranch,
          });

          if (prResult.degraded) {
            degraded = true;
            metrics.githubApiErrorsTotal.inc({ repository: this.repository });
            metrics.recordError({
              repository: this.repository,
              component: 'Daemon',
              operation: 'createPR',
              errorCode: ErrorCode.GITHUB_SERVICE_DEGRADED,
              severity: 'transient',
              issueNumber: result.issue.number,
              branchName: result.branchName,
            });

            logger.warn(`PR creation skipped for issue #${result.issue.number} due to service degradation`, {
              issueNumber: result.issue.number,
              branchName: result.branchName,
            });

            await this.github.issues.addLabelsWithFallback(result.issue.number, ['pr-pending']);
            errors.push(`[${ErrorCode.GITHUB_SERVICE_DEGRADED}] PR creation skipped for issue #${result.issue.number}`);
          } else if (prResult.value) {
            const pr = prResult.value;
            metrics.prsCreatedTotal.inc({ repository: this.repository });

            logger.success(`Created PR #${pr.number} for issue #${result.issue.number}`);
            createdPRs.set(result.branchName, { prNumber: pr.number, issueNumber: result.issue.number });

            // Build PR comment with evaluation results
            let prComment = `🔗 PR created: #${pr.number}`;
            const evalResult = evaluationResults.get(result.branchName);
            if (evalResult) {
              prComment += `\n\n**Evaluation Results:**\n${evalResult.summary}`;
            }

            const commentResult = await this.github.issues.addCommentWithFallback(
              result.issue.number,
              prComment
            );
            if (commentResult.degraded) {
              degraded = true;
            }

            // Also add evaluation results as PR comment if available
            if (evalResult) {
              await this.github.issues.addCommentWithFallback(
                pr.number,
                `## Evaluation Results\n\n${evalResult.summary}\n\n---\n*Evaluation completed in ${evalResult.duration}ms*`
              );
            }
          }
        }

        // STEP 6: Merge successful PRs
        if (this.config.merge.autoMerge) {
          logger.cyclePhase('merge-prs', 6, 6);
          this.progressManager.setPhase('merge-prs', 6);

          const resolver = createConflictResolver({
            prManager: this.github.pulls,
            branchManager: this.github.branches,
            maxRetries: this.config.merge.maxRetries,
            strategy: this.config.merge.conflictStrategy,
            mergeMethod: this.config.merge.mergeMethod,
            owner: this.config.repo.owner,
            repo: this.config.repo.name,
            baseBranch: this.config.repo.baseBranch,
          });

          // Get branches to merge - only include those that passed evaluation
          // When requireAllChecks is true, evaluation must pass for auto-merge
          const branchesToMerge = results
            .filter((r) => r.success)
            .filter((r) => {
              // If requireAllChecks is true and evaluation was run, check if it passed
              if (this.config.merge.requireAllChecks && evaluationRequired) {
                const passed = evaluationPassed.has(r.branchName);
                if (!passed) {
                  logger.info(`Skipping auto-merge for ${r.branchName} - evaluation did not pass and requireAllChecks is enabled`);
                }
                return passed;
              }
              // Otherwise just check if evaluation passed (if it was run)
              return evaluationPassed.has(r.branchName);
            })
            .map((r) => ({ branchName: r.branchName }));

          const mergeResults = await resolver.mergeSequentially(branchesToMerge);

          for (const [branch, mergeResult] of mergeResults) {
            if (mergeResult.merged) {
              prsMerged++;

              // Track PR merge
              metrics.prsMergedTotal.inc({ repository: this.repository });

              // Find and close the corresponding issue
              const result = results.find((r) => r.branchName === branch);
              if (result) {
                await this.github.issues.closeIssue(
                  result.issue.number,
                  `✅ Automatically implemented and merged via PR #${mergeResult.pr?.number}`
                );

                // Soft-delete associated chat sessions to free up storage
                try {
                  const deletedCount = await softDeleteSessionsByIssue(
                    result.issue.number,
                    this.config.repo.owner,
                    this.config.repo.name
                  );
                  if (deletedCount > 0) {
                    logger.info(`Soft-deleted ${deletedCount} session(s) for issue #${result.issue.number}`);
                  }
                } catch (sessionError) {
                  // Don't fail the cycle if session cleanup fails
                  logger.warn(`Failed to delete sessions for issue #${result.issue.number}: ${getErrorMessage(sessionError)}`);
                }

                // Update STATUS.md with changelog entry for completed task
                try {
                  const today = new Date().toISOString().split('T')[0];
                  updateStatusFile(process.cwd(), {
                    changelogEntry: `- Completed: ${result.issue.title} (PR #${mergeResult.pr?.number}, Issue #${result.issue.number})`,
                  });
                  logger.info(`Updated STATUS.md changelog for completed issue #${result.issue.number}`);
                } catch (statusError) {
                  // Don't fail the cycle if STATUS.md update fails
                  logger.warn(`Failed to update STATUS.md: ${getErrorMessage(statusError)}`);
                }
              }
            } else {
              errors.push(`Failed to merge ${branch}: ${mergeResult.error}`);
            }
          }
        }
      }

      // Update service health at end of cycle
      const finalHealth = this.updateServiceHealth();

      return {
        success: errors.length === 0,
        tasksDiscovered,
        tasksCompleted,
        tasksFailed,
        prsMerged,
        duration: Date.now() - startTime,
        errors,
        degraded,
        serviceHealth: finalHealth,
      };
    } catch (error: unknown) {
      errors.push(getErrorMessage(error));
      const finalHealth = this.updateServiceHealth();

      return {
        success: false,
        tasksDiscovered,
        tasksCompleted,
        tasksFailed,
        prsMerged,
        duration: Date.now() - startTime,
        errors,
        degraded: true,
        serviceHealth: finalHealth,
      };
    }
  }

  private async createIssueForTask(task: DiscoveredTask | DeduplicatedTask): Promise<Issue> {
    if (!this.github) {
      throw new Error('GitHub client not initialized');
    }

    const labels = [
      this.config.discovery.issueLabel,
      `priority:${task.priority}`,
      `type:${task.category}`,
      `complexity:${task.estimatedComplexity}`,
    ];

    // Build related issues section if available
    const relatedIssues = 'relatedIssues' in task && task.relatedIssues && task.relatedIssues.length > 0
      ? task.relatedIssues
      : task.relatedIssues ?? [];

    const relatedIssuesSection = relatedIssues.length > 0
      ? `\n## Related Issues\n\n${relatedIssues.map((n) => `- #${n}`).join('\n')}\n`
      : '';

    // Build conflict warning if this is a deduplicated task with high risk
    const conflictWarning = 'conflictPrediction' in task && task.conflictPrediction?.hasHighConflictRisk
      ? `\n> ⚠️ **Note:** This task has been flagged with potential conflict risk. Consider reviewing related issues before implementation.\n`
      : '';

    const body = `## Description

${task.description}
${conflictWarning}
## Affected Paths

${task.affectedPaths.map((p) => `- \`${p}\``).join('\n')}
${relatedIssuesSection}
---

*🤖 This issue was automatically created by Autonomous Dev CLI*
`;

    return this.github.issues.createIssue({
      title: task.title,
      body,
      labels,
    });
  }

  private generateBranchName(issue: Issue): string {
    // Convert title to slug
    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    return `auto/${issue.number}-${slug}`;
  }

  private generatePRBody(issue: Issue, evaluationResult?: EvaluationResult): string {
    const evaluationSection = evaluationResult
      ? `\n## Evaluation Results\n\n${evaluationResult.summary}\n\n*Evaluation completed in ${evaluationResult.duration}ms*\n`
      : '';

    return `## Summary

Implements #${issue.number}

${issue.body || ''}

## Changes

*Changes were implemented autonomously by Claude.*
${evaluationSection}
---

🤖 Generated by [Autonomous Dev CLI](https://github.com/webedt/monorepo/tree/main/autonomous-dev-cli)
`;
  }

  private logCycleResult(result: CycleResult): void {
    // First display the progress manager's cycle summary with timing breakdown
    this.progressManager.displayCycleSummary(result.success);

    // Additional status information
    console.log(chalk.bold('  Service Health:'));

    // Show service health status with color coding
    if (result.degraded) {
      console.log(`    Status:        ${chalk.yellow('⚡')} ${chalk.yellow('DEGRADED')}`);
    } else {
      console.log(`    Status:        ${chalk.green('✓')} ${chalk.green('Healthy')}`);
    }

    // Show GitHub service health details if available
    if (result.serviceHealth.github) {
      const gh = result.serviceHealth.github;
      const statusColor = gh.status === 'healthy' ? chalk.green :
                          gh.status === 'degraded' ? chalk.yellow : chalk.red;
      const statusIcon = gh.status === 'healthy' ? '🟢' :
                         gh.status === 'degraded' ? '🟡' : '🔴';
      console.log(`    GitHub:        ${statusIcon} ${statusColor(gh.status)} ${chalk.gray(`(circuit: ${gh.circuitState})`)}`);
      if (gh.consecutiveFailures > 0) {
        console.log(`    Failures:      ${chalk.red(gh.consecutiveFailures.toString())}`);
      }
      if (gh.rateLimitRemaining !== undefined) {
        const rateColor = gh.rateLimitRemaining > 100 ? chalk.green :
                          gh.rateLimitRemaining > 20 ? chalk.yellow : chalk.red;
        console.log(`    Rate Limit:    ${rateColor(gh.rateLimitRemaining.toString())} remaining`);
      }
    }
    console.log();

    // Show errors with improved formatting
    if (result.errors.length > 0) {
      console.log(chalk.bold.red('  Errors:'));
      for (const error of result.errors) {
        // Extract error code if present
        const codeMatch = error.match(/\[([^\]]+)\]/);
        if (codeMatch) {
          const code = codeMatch[1];
          const message = error.replace(`[${code}]`, '').trim();
          console.log(`    ${chalk.red('✗')} ${chalk.yellow(`[${code}]`)} ${message}`);
        } else {
          console.log(`    ${chalk.red('✗')} ${error}`);
        }
      }
      console.log();
    }

    logger.divider();

    // Output JSON summary if in JSON mode
    if (this.options.logFormat === 'json') {
      const cycleSummary = {
        type: 'cycle_result',
        cycleNumber: this.cycleCount,
        success: result.success,
        tasksDiscovered: result.tasksDiscovered,
        tasksCompleted: result.tasksCompleted,
        tasksFailed: result.tasksFailed,
        prsMerged: result.prsMerged,
        duration: result.duration,
        degraded: result.degraded,
        serviceHealth: {
          overall: result.serviceHealth.overallStatus,
          github: result.serviceHealth.github ? {
            status: result.serviceHealth.github.status,
            circuitState: result.serviceHealth.github.circuitState,
            rateLimitRemaining: result.serviceHealth.github.rateLimitRemaining,
          } : null,
        },
        errors: result.errors,
        timestamp: new Date().toISOString(),
      };
      console.log(JSON.stringify(cycleSummary));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);

      // Allow interruption
      const checkInterval = setInterval(() => {
        if (!this.isRunning) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }
}

export function createDaemon(options: DaemonOptions = {}): Daemon {
  return new Daemon(options);
}
