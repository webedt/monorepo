import { loadConfig } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase } from './db/index.js';
import { createGitHub } from './github/index.js';
import { discoverTasks, createDeduplicator, getParallelSafeTasks, } from './discovery/index.js';
import { createWorkerPool } from './executor/index.js';
import { createConflictResolver } from './conflicts/index.js';
import { logger, generateCorrelationId, clearCorrelationId, getCorrelationId, setCorrelationContext, getMemoryUsageMB, timeOperation, createOperationContext, finalizeOperationContext, startRequestLifecycle, endRequestLifecycle, } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { createMonitoringServer } from './utils/monitoring.js';
import { StructuredError, ErrorCode, GitHubError, ClaudeError, ConfigError, wrapError, } from './utils/errors.js';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
export class Daemon {
    config;
    github = null;
    isRunning = false;
    cycleCount = 0;
    options;
    userId = null;
    enableDatabaseLogging = false;
    monitoringServer = null;
    repository = '';
    lastKnownIssues = []; // Cache for graceful degradation
    serviceHealth = {
        github: null,
        overallStatus: 'healthy',
        lastCheck: new Date(),
    };
    constructor(options = {}) {
        this.options = options;
        this.config = loadConfig(options.configPath);
        // Configure logging from config (can be overridden by options)
        if (this.config.logging) {
            logger.setFormat(this.config.logging.format);
            logger.setLevel(this.config.logging.level);
            logger.setIncludeCorrelationId(this.config.logging.includeCorrelationId);
            logger.setIncludeTimestamp(this.config.logging.includeTimestamp);
        }
        // Override with verbose flag if set
        if (options.verbose) {
            logger.setLevel('debug');
        }
        // Override log format if explicitly set in options
        if (options.logFormat) {
            logger.setFormat(options.logFormat);
        }
    }
    async start() {
        logger.header('Autonomous Dev CLI');
        logger.info('Starting daemon...');
        try {
            // Initialize
            await this.initialize();
            // Start monitoring server if port is configured
            if (this.options.monitoringPort) {
                await this.startMonitoringServer();
            }
            // Update health status
            metrics.updateHealthStatus(true);
            this.isRunning = true;
            // Main loop
            while (this.isRunning) {
                this.cycleCount++;
                // Generate correlation ID for this cycle
                const cycleCorrelationId = generateCorrelationId();
                // Set full correlation context with cycle number
                const correlationContext = {
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
                logger.info(`Starting cycle`, {
                    cycle: this.cycleCount,
                    correlationId: cycleCorrelationId,
                    memoryUsageMB: cycleStartMemory,
                });
                // Log memory snapshot at cycle start
                logger.memorySnapshot('Daemon', `Cycle #${this.cycleCount} start`);
                const result = await this.runCycle();
                // Calculate memory delta for the cycle
                const cycleEndMemory = getMemoryUsageMB();
                const memoryDelta = Math.round((cycleEndMemory - cycleStartMemory) * 100) / 100;
                this.logCycleResult(result);
                // Record cycle metrics
                metrics.recordCycleCompletion(result.tasksDiscovered, result.tasksCompleted, result.tasksFailed, result.duration, { repository: this.repository });
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
                    await this.sleep(this.config.daemon.loopIntervalMs);
                }
            }
        }
        catch (error) {
            const structuredError = this.wrapDaemonError(error);
            logger.structuredError(structuredError, {
                context: this.getErrorContext('start'),
                includeStack: true,
                includeRecovery: true,
            });
            throw structuredError;
        }
        finally {
            await this.shutdown();
        }
    }
    /**
     * Wrap any error as a StructuredError with daemon-specific context
     */
    wrapDaemonError(error, operation) {
        if (error instanceof StructuredError) {
            return error;
        }
        return wrapError(error, ErrorCode.INTERNAL_ERROR, {
            operation: operation ?? 'daemon',
            component: 'Daemon',
        });
    }
    /**
     * Get current error context for debugging
     */
    getErrorContext(operation) {
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
    async stop() {
        logger.info('Stop requested...');
        this.isRunning = false;
        metrics.updateHealthStatus(false);
    }
    /**
     * Get the current correlation ID from the global context
     */
    getCurrentCorrelationId() {
        return getCorrelationId() || 'unknown';
    }
    /**
     * Update and return the current service health status
     */
    updateServiceHealth() {
        const githubHealth = this.github?.client.getServiceHealth() ?? null;
        let overallStatus = 'healthy';
        if (githubHealth) {
            if (githubHealth.status === 'unavailable') {
                overallStatus = 'unavailable';
            }
            else if (githubHealth.status === 'degraded') {
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
     * Get the current service health status
     */
    getServiceHealth() {
        return this.serviceHealth;
    }
    /**
     * Log the current service health status
     */
    logServiceHealthStatus() {
        const health = this.updateServiceHealth();
        if (health.github) {
            logger.serviceStatus('GitHub API', health.github.status, {
                circuitState: health.github.circuitState,
                consecutiveFailures: health.github.consecutiveFailures,
                rateLimitRemaining: health.github.rateLimitRemaining,
            });
        }
        if (health.overallStatus !== 'healthy') {
            logger.degraded('Services', `Operating in ${health.overallStatus} mode`, { github: health.github?.status });
        }
    }
    /**
     * Start the monitoring server for health checks and metrics
     */
    async startMonitoringServer() {
        if (!this.options.monitoringPort)
            return;
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
            const statusMap = {
                healthy: 'pass',
                degraded: 'pass', // Still operational, just degraded
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
    async initialize() {
        logger.info('Initializing...');
        // Set repository identifier for metrics
        this.repository = `${this.config.repo.owner}/${this.config.repo.name}`;
        // Load credentials from database if configured
        if (this.config.credentials.databaseUrl && this.config.credentials.userEmail) {
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
            }
            else {
                throw new ConfigError(ErrorCode.DB_USER_NOT_FOUND, `User not found in database: ${this.config.credentials.userEmail}`, {
                    field: 'credentials.userEmail',
                    value: this.config.credentials.userEmail,
                    context: this.getErrorContext('initialize'),
                });
            }
        }
        // Validate required credentials
        if (!this.config.credentials.githubToken) {
            throw new ConfigError(ErrorCode.CONFIG_MISSING_REQUIRED, 'GitHub token not configured', {
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
            });
        }
        if (!this.config.credentials.claudeAuth) {
            throw new ConfigError(ErrorCode.CONFIG_MISSING_REQUIRED, 'Claude authentication not configured', {
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
            });
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
        logger.success('Initialization complete');
    }
    async shutdown() {
        logger.info('Shutting down...');
        // Update health status
        metrics.updateHealthStatus(false);
        // Stop monitoring server
        if (this.monitoringServer) {
            await this.monitoringServer.stop();
        }
        await closeDatabase();
        logger.info('Shutdown complete');
    }
    async runCycle() {
        const startTime = Date.now();
        const errors = [];
        let tasksDiscovered = 0;
        let tasksCompleted = 0;
        let tasksFailed = 0;
        let prsMerged = 0;
        let degraded = false;
        // Update service health at start of cycle
        this.logServiceHealthStatus();
        try {
            if (!this.github || !this.config.credentials.claudeAuth) {
                throw new StructuredError(ErrorCode.NOT_INITIALIZED, 'Daemon not properly initialized: GitHub client or Claude auth is missing', {
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
                });
            }
            // STEP 1: Get existing issues with graceful degradation
            logger.step(1, 5, 'Fetching existing issues');
            metrics.recordCorrelationOperation(this.getCurrentCorrelationId(), 'fetch_issues');
            const { result: issueResult, duration: issueFetchDuration } = await timeOperation(() => this.github.issues.listOpenIssuesWithFallback(this.config.discovery.issueLabel, this.lastKnownIssues // Use cached issues as fallback
            ), 'fetchIssues');
            const existingIssues = issueResult.value;
            if (issueResult.degraded) {
                degraded = true;
                metrics.recordCorrelationError(this.getCurrentCorrelationId());
                logger.warn(`Using ${this.lastKnownIssues.length} cached issues due to GitHub API degradation`, {
                    fetchDuration: issueFetchDuration,
                });
            }
            else {
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
            let newIssues = [];
            if (availableSlots > 0 && !this.options.dryRun) {
                logger.step(2, 5, 'Discovering new tasks');
                // Clone repo for analysis
                const analysisDir = join(this.config.execution.workDir, 'analysis');
                // For now, we'll analyze the current directory if it's the target repo
                // In production, this would clone the repo first
                try {
                    const rawTasks = await discoverTasks({
                        claudeAuth: this.config.credentials.claudeAuth,
                        repoPath: process.cwd(), // Analyze current directory
                        excludePaths: this.config.discovery.excludePaths,
                        tasksPerCycle: Math.min(this.config.discovery.tasksPerCycle, availableSlots),
                        existingIssues,
                        repoContext: `WebEDT - AI-powered coding assistant platform with React frontend, Express backend, and Claude Agent SDK integration.`,
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
                    // Create GitHub issues for new tasks
                    // Check if GitHub is available before attempting to create issues
                    if (!this.github.client.isAvailable()) {
                        degraded = true;
                        logger.degraded('GitHub', 'Skipping issue creation due to service degradation', {
                            tasksDiscovered: tasks.length,
                        });
                        errors.push(`[${ErrorCode.GITHUB_SERVICE_DEGRADED}] Issue creation skipped due to GitHub service degradation`);
                    }
                    else {
                        for (const task of tasks) {
                            try {
                                const issue = await this.createIssueForTask(task);
                                newIssues.push(issue);
                                logger.success(`Created issue #${issue.number}: ${issue.title}`);
                            }
                            catch (error) {
                                const structuredError = error instanceof StructuredError
                                    ? error
                                    : new GitHubError(ErrorCode.GITHUB_API_ERROR, `Failed to create issue for "${task.title}": ${error.message}`, { context: { taskTitle: task.title }, cause: error });
                                errors.push(`[${structuredError.code}] ${structuredError.message}`);
                                logger.structuredError(structuredError, { context: { taskTitle: task.title } });
                            }
                        }
                    }
                }
                catch (error) {
                    const structuredError = error instanceof StructuredError
                        ? error
                        : new ClaudeError(ErrorCode.CLAUDE_API_ERROR, `Task discovery failed: ${error.message}`, { context: this.getErrorContext('discoverTasks'), cause: error });
                    errors.push(`[${structuredError.code}] ${structuredError.message}`);
                    logger.structuredError(structuredError, {
                        context: this.getErrorContext('discoverTasks'),
                        includeRecovery: true,
                    });
                    // Mark as degraded but continue with existing issues
                    degraded = true;
                }
            }
            else if (availableSlots <= 0) {
                logger.info('Max open issues reached, skipping discovery');
            }
            else {
                logger.info('Dry run - skipping issue creation');
            }
            // STEP 3: Execute tasks
            logger.step(3, 5, 'Executing tasks');
            // Get all issues to work on (prioritize user-created, then auto-created)
            const allIssues = [...existingIssues, ...newIssues];
            const issuesToWork = allIssues
                .filter((i) => !i.labels.includes('in-progress'))
                .slice(0, this.config.execution.parallelWorkers);
            if (issuesToWork.length === 0) {
                logger.info('No issues to work on');
            }
            else if (this.options.dryRun) {
                logger.info(`Dry run - would execute ${issuesToWork.length} tasks`);
            }
            else {
                // Mark issues as in-progress with graceful degradation
                for (const issue of issuesToWork) {
                    const labelResult = await this.github.issues.addLabelsWithFallback(issue.number, ['in-progress']);
                    if (labelResult.degraded) {
                        degraded = true;
                    }
                }
                // Create worker pool and execute
                const workerPool = createWorkerPool({
                    maxWorkers: this.config.execution.parallelWorkers,
                    workDir: this.config.execution.workDir,
                    repoUrl: `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`,
                    baseBranch: this.config.repo.baseBranch,
                    githubToken: this.config.credentials.githubToken,
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
                });
                const workerTasks = issuesToWork.map((issue) => ({
                    issue,
                    branchName: this.generateBranchName(issue),
                }));
                const results = await workerPool.executeTasks(workerTasks);
                tasksCompleted = results.filter((r) => r.success).length;
                tasksFailed = results.filter((r) => !r.success).length;
                // STEP 4: Create PRs and evaluate
                logger.step(4, 5, 'Creating PRs and evaluating');
                for (const result of results) {
                    if (!result.success) {
                        // Remove in-progress label, add failed label with graceful degradation
                        await this.github.issues.removeLabel(result.issue.number, 'in-progress');
                        const labelResult = await this.github.issues.addLabelsWithFallback(result.issue.number, ['needs-review']);
                        if (labelResult.degraded) {
                            degraded = true;
                        }
                        const commentResult = await this.github.issues.addCommentWithFallback(result.issue.number, `⚠️ Autonomous implementation failed:\n\n\`\`\`\n${result.error}\n\`\`\``);
                        if (commentResult.degraded) {
                            degraded = true;
                        }
                        continue;
                    }
                    // Create PR with graceful degradation
                    metrics.githubApiCallsTotal.inc({ repository: this.repository });
                    const prResult = await this.github.pulls.createPRWithFallback({
                        title: result.issue.title,
                        body: this.generatePRBody(result.issue),
                        head: result.branchName,
                        base: this.config.repo.baseBranch,
                    });
                    if (prResult.degraded) {
                        degraded = true;
                        // Track GitHub API error for degraded PR creation
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
                        // Add a label to indicate PR creation was skipped
                        await this.github.issues.addLabelsWithFallback(result.issue.number, ['pr-pending']);
                        errors.push(`[${ErrorCode.GITHUB_SERVICE_DEGRADED}] PR creation skipped for issue #${result.issue.number}`);
                    }
                    else if (prResult.value) {
                        const pr = prResult.value;
                        // Track PR creation
                        metrics.prsCreatedTotal.inc({ repository: this.repository });
                        logger.success(`Created PR #${pr.number} for issue #${result.issue.number}`);
                        // Link PR to issue with graceful degradation
                        const commentResult = await this.github.issues.addCommentWithFallback(result.issue.number, `🔗 PR created: #${pr.number}`);
                        if (commentResult.degraded) {
                            degraded = true;
                        }
                    }
                }
                // STEP 5: Merge successful PRs
                if (this.config.merge.autoMerge) {
                    logger.step(5, 5, 'Merging PRs');
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
                    // Get branches to merge
                    const branchesToMerge = results
                        .filter((r) => r.success)
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
                                await this.github.issues.closeIssue(result.issue.number, `✅ Automatically implemented and merged via PR #${mergeResult.pr?.number}`);
                            }
                        }
                        else {
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
        }
        catch (error) {
            errors.push(error.message);
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
    async createIssueForTask(task) {
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
    generateBranchName(issue) {
        // Convert title to slug
        const slug = issue.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40);
        return `auto/${issue.number}-${slug}`;
    }
    generatePRBody(issue) {
        return `## Summary

Implements #${issue.number}

${issue.body || ''}

## Changes

*Changes were implemented autonomously by Claude.*

---

🤖 Generated by [Autonomous Dev CLI](https://github.com/webedt/monorepo/tree/main/autonomous-dev-cli)
`;
    }
    logCycleResult(result) {
        logger.divider();
        logger.header('Cycle Summary');
        console.log(`  Tasks discovered: ${result.tasksDiscovered}`);
        console.log(`  Tasks completed:  ${result.tasksCompleted}`);
        console.log(`  Tasks failed:     ${result.tasksFailed}`);
        console.log(`  PRs merged:       ${result.prsMerged}`);
        console.log(`  Duration:         ${(result.duration / 1000).toFixed(1)}s`);
        // Show service health status
        if (result.degraded) {
            console.log(`\n  ⚡ Service Status: DEGRADED`);
        }
        else {
            console.log(`\n  ✓ Service Status: Healthy`);
        }
        // Show GitHub service health details if available
        if (result.serviceHealth.github) {
            const gh = result.serviceHealth.github;
            console.log(`    GitHub: ${gh.status} (circuit: ${gh.circuitState})`);
            if (gh.consecutiveFailures > 0) {
                console.log(`    Consecutive failures: ${gh.consecutiveFailures}`);
            }
            if (gh.rateLimitRemaining !== undefined) {
                console.log(`    Rate limit remaining: ${gh.rateLimitRemaining}`);
            }
        }
        if (result.errors.length > 0) {
            console.log(`\n  Errors:`);
            for (const error of result.errors) {
                console.log(`    - ${error}`);
            }
        }
        logger.divider();
    }
    sleep(ms) {
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
export function createDaemon(options = {}) {
    return new Daemon(options);
}
//# sourceMappingURL=daemon.js.map