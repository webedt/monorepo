#!/usr/bin/env node
import { Command } from 'commander';
import { createDaemon } from './daemon.js';
import { loadConfig, getConfigHelp, upgradeConfig, formatMigrationSummary, CURRENT_CONFIG_VERSION, } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase } from './db/index.js';
import { createGitHub } from './github/index.js';
import { discoverTasks } from './discovery/index.js';
import { logger } from './utils/logger.js';
import { validateConfigPath, validateNumericParam, validatePort, validateHost, validateRepoInfo, validateEmail, displayValidationError, createMissingCredentialMessage, NUMERIC_RANGES, } from './utils/validation.js';
import { StructuredError } from './utils/errors.js';
import chalk from 'chalk';
import { runConfigWizard, validateConfiguration, displayValidationResults, generateExampleConfig, } from './utils/configWizard.js';
const program = new Command();
/**
 * Global error handler for CLI commands
 * Provides user-friendly error messages with actionable suggestions
 */
function handleCommandError(error, commandName) {
    console.error();
    if (error instanceof StructuredError) {
        // Use the structured error logging
        logger.structuredError(error, { includeRecovery: true });
    }
    else if (error instanceof Error) {
        // Handle standard errors with helpful formatting
        console.error(chalk.red.bold('Error:'), error.message);
        console.error();
        // Provide context-specific suggestions based on error message
        const suggestions = getErrorSuggestions(error, commandName);
        if (suggestions.length > 0) {
            console.error(chalk.yellow.bold('Suggestions:'));
            suggestions.forEach(s => console.error(`  • ${s}`));
            console.error();
        }
        // Show stack trace in verbose mode
        if (process.env.DEBUG || process.argv.includes('--verbose') || process.argv.includes('-v')) {
            console.error(chalk.gray('Stack trace:'));
            console.error(chalk.gray(error.stack || 'No stack trace available'));
            console.error();
        }
    }
    else {
        console.error(chalk.red.bold('Unknown error:'), String(error));
    }
    console.error(chalk.gray(`For more help, run: autonomous-dev ${commandName} --help`));
    console.error();
    process.exit(1);
}
/**
 * Get contextual error suggestions based on error message and command
 */
function getErrorSuggestions(error, commandName) {
    const suggestions = [];
    const message = error.message.toLowerCase();
    // Network-related errors
    if (message.includes('enotfound') || message.includes('network') || message.includes('etimedout')) {
        suggestions.push('Check your internet connection');
        suggestions.push('Verify firewall settings allow outbound connections');
    }
    // Authentication errors
    if (message.includes('auth') || message.includes('401') || message.includes('403') || message.includes('token')) {
        suggestions.push('Check that your credentials are set correctly');
        suggestions.push('Run "autonomous-dev config" to verify credential status');
        suggestions.push('Ensure tokens have not expired');
    }
    // Configuration errors
    if (message.includes('config') || message.includes('json') || message.includes('parse')) {
        suggestions.push('Run "autonomous-dev init" to create a new configuration');
        suggestions.push('Verify your config file is valid JSON');
        suggestions.push('Run "autonomous-dev help-config" for configuration reference');
    }
    // Rate limiting
    if (message.includes('rate') || message.includes('429') || message.includes('quota')) {
        suggestions.push('Wait a few minutes before retrying');
        suggestions.push('Consider reducing the number of parallel workers');
    }
    // Repository errors
    if (message.includes('repository') || message.includes('repo') || message.includes('404')) {
        suggestions.push('Verify repository owner and name are correct');
        suggestions.push('Check that your token has access to the repository');
    }
    // Add command-specific suggestions
    if (commandName === 'start' || commandName === 'run') {
        if (suggestions.length === 0) {
            suggestions.push('Try running with --verbose for more details');
            suggestions.push('Check your configuration with "autonomous-dev config"');
        }
    }
    else if (commandName === 'discover') {
        suggestions.push('Ensure Claude credentials are configured');
        suggestions.push('Verify the repository is accessible');
    }
    else if (commandName === 'status') {
        suggestions.push('Ensure GitHub token is configured');
        suggestions.push('Check repository settings in your config');
    }
    return suggestions;
}
/**
 * Validate common command options and exit if invalid
 */
function validateCommonOptions(options, commandName) {
    // Validate config path if provided
    if (options.config) {
        const configResult = validateConfigPath(options.config);
        if (!configResult.valid) {
            displayValidationError(configResult);
            console.error(chalk.gray(`For more help, run: autonomous-dev ${commandName} --help`));
            process.exit(1);
        }
    }
    // Validate count if provided
    if (options.count) {
        const countResult = validateNumericParam(options.count, 'count', NUMERIC_RANGES.taskCount);
        if (!countResult.valid) {
            displayValidationError(countResult);
            process.exit(1);
        }
    }
    // Validate port if provided
    if (options.port) {
        const portResult = validatePort(options.port);
        if (!portResult.valid) {
            displayValidationError(portResult);
            process.exit(1);
        }
    }
    // Validate host if provided
    if (options.host) {
        const hostResult = validateHost(options.host);
        if (!hostResult.valid) {
            displayValidationError(hostResult);
            process.exit(1);
        }
    }
}
/**
 * Validate credentials are present and show helpful message if missing
 */
function validateCredentials(config, requirements) {
    let valid = true;
    if (requirements.github && !config.credentials.githubToken) {
        console.error(createMissingCredentialMessage('github'));
        valid = false;
    }
    if (requirements.claude && !config.credentials.claudeAuth) {
        console.error(createMissingCredentialMessage('claude'));
        valid = false;
    }
    return valid;
}
// Helper to format examples section
function formatExamples(examples) {
    return '\n\nExamples:\n' + examples.map(ex => `  $ ${ex}`).join('\n');
}
// Helper to format additional info
function formatAdditionalInfo(info) {
    return '\n\n' + info;
}
program
    .name('autonomous-dev')
    .description('Autonomous development CLI for continuous website improvement.\n\n' +
    'This tool automates the discovery, implementation, and deployment of\n' +
    'development tasks using AI-powered analysis and GitHub integration.\n\n' +
    'Quick Start:\n' +
    '  1. Run "autonomous-dev init" to create a configuration file\n' +
    '  2. Set up credentials (GitHub token, Claude auth)\n' +
    '  3. Run "autonomous-dev discover" to find tasks\n' +
    '  4. Run "autonomous-dev start" to begin autonomous development\n\n' +
    'For more information on a specific command, run:\n' +
    '  autonomous-dev <command> --help')
    .version('0.1.0');
// Start command - run continuous daemon
program
    .command('start')
    .description('Start the autonomous development daemon in continuous mode.\n\n' +
    'The daemon will continuously:\n' +
    '  1. Discover new development tasks using AI analysis\n' +
    '  2. Create GitHub issues for discovered tasks\n' +
    '  3. Implement tasks in isolated branches\n' +
    '  4. Run build, tests, and health checks\n' +
    '  5. Create and auto-merge pull requests\n\n' +
    'The loop interval and behavior can be configured via config file.' +
    formatExamples([
        'autonomous-dev start',
        'autonomous-dev start --verbose',
        'autonomous-dev start --config ./my-config.json',
        'autonomous-dev start --dry-run  # Preview without making changes',
    ]) +
    formatAdditionalInfo('Environment Variables:\n' +
        '  GITHUB_TOKEN         GitHub personal access token\n' +
        '  CLAUDE_ACCESS_TOKEN  Claude API access token\n' +
        '  DATABASE_URL         Database connection URL (optional)\n\n' +
        'Signals:\n' +
        '  SIGINT (Ctrl+C)      Graceful shutdown after current cycle\n' +
        '  SIGTERM              Graceful shutdown after current cycle'))
    .option('-c, --config <path>', 'Path to configuration file (JSON format)')
    .option('-v, --verbose', 'Enable verbose/debug logging output')
    .option('--dry-run', 'Discover tasks but do not execute or create issues (safe preview mode)')
    .action(async (options) => {
    // Validate options before proceeding
    validateCommonOptions({ config: options.config }, 'start');
    try {
        const daemon = createDaemon({
            configPath: options.config,
            verbose: options.verbose,
            dryRun: options.dryRun,
            singleCycle: false,
        });
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            console.log('\n');
            logger.info('Received SIGINT, stopping...');
            await daemon.stop();
        });
        process.on('SIGTERM', async () => {
            logger.info('Received SIGTERM, stopping...');
            await daemon.stop();
        });
        await daemon.start();
    }
    catch (error) {
        handleCommandError(error, 'start');
    }
});
// Run command - run single cycle
program
    .command('run')
    .description('Run a single development cycle and exit.\n\n' +
    'Unlike "start", this command runs exactly one cycle and exits.\n' +
    'Useful for CI/CD pipelines, cron jobs, or manual one-off runs.\n\n' +
    'Each cycle performs:\n' +
    '  1. Task discovery (if below max open issues)\n' +
    '  2. Issue creation on GitHub\n' +
    '  3. Task implementation\n' +
    '  4. Build and test validation\n' +
    '  5. Pull request creation' +
    formatExamples([
        'autonomous-dev run',
        'autonomous-dev run --verbose',
        'autonomous-dev run --dry-run  # Safe preview mode',
        'autonomous-dev run -c production.json',
    ]) +
    formatAdditionalInfo('Use Cases:\n' +
        '  • Scheduled runs via cron: 0 */4 * * * autonomous-dev run\n' +
        '  • CI/CD integration for nightly improvements\n' +
        '  • Manual triggering for controlled development\n\n' +
        'Exit Codes:\n' +
        '  0  Cycle completed successfully\n' +
        '  1  Cycle failed (check logs for details)'))
    .option('-c, --config <path>', 'Path to configuration file (JSON format)')
    .option('-v, --verbose', 'Enable verbose/debug logging output')
    .option('--dry-run', 'Discover tasks but do not execute or create issues (safe preview mode)')
    .action(async (options) => {
    // Validate options before proceeding
    validateCommonOptions({ config: options.config }, 'run');
    try {
        const daemon = createDaemon({
            configPath: options.config,
            verbose: options.verbose,
            dryRun: options.dryRun,
            singleCycle: true,
        });
        await daemon.start();
    }
    catch (error) {
        handleCommandError(error, 'run');
    }
});
// Discover command - only discover tasks
program
    .command('discover')
    .description('Discover development tasks without executing them.\n\n' +
    'Uses AI-powered analysis to identify potential improvements,\n' +
    'bug fixes, and feature enhancements in your codebase.\n\n' +
    'Task categories include:\n' +
    '  • bug-fix      - Bug fixes and error corrections\n' +
    '  • feature      - New feature implementations\n' +
    '  • enhancement  - Improvements to existing features\n' +
    '  • refactor     - Code quality improvements\n' +
    '  • docs         - Documentation updates\n' +
    '  • test         - Test coverage improvements' +
    formatExamples([
        'autonomous-dev discover',
        'autonomous-dev discover -n 10  # Find 10 tasks',
        'autonomous-dev discover --create-issues  # Create GitHub issues',
        'autonomous-dev discover -v --count 3',
    ]) +
    formatAdditionalInfo('Output Information:\n' +
        '  Each task displays:\n' +
        '  • Title and description\n' +
        '  • Priority level (high/medium/low)\n' +
        '  • Category (bug-fix, feature, etc.)\n' +
        '  • Estimated complexity\n' +
        '  • Affected file paths\n\n' +
        'Issue Labels (when --create-issues is used):\n' +
        '  • autonomous-dev (or custom label from config)\n' +
        '  • priority:<level>\n' +
        '  • type:<category>'))
    .option('-c, --config <path>', 'Path to configuration file (JSON format)')
    .option('-v, --verbose', 'Enable verbose/debug logging output')
    .option('-n, --count <number>', 'Number of tasks to discover (default: 5, max: 10)', '5')
    .option('--create-issues', 'Create GitHub issues for discovered tasks automatically')
    .action(async (options) => {
    // Validate options before proceeding
    validateCommonOptions({ config: options.config, count: options.count }, 'discover');
    // Validate count parameter specifically
    const countResult = validateNumericParam(options.count, 'count', NUMERIC_RANGES.taskCount);
    if (!countResult.valid) {
        displayValidationError(countResult);
        process.exit(1);
    }
    const taskCount = countResult.parsedValue || NUMERIC_RANGES.taskCount.default;
    if (options.verbose) {
        logger.setLevel('debug');
    }
    try {
        const config = loadConfig(options.config);
        // Load credentials from database if configured
        if (config.credentials.databaseUrl && config.credentials.userEmail) {
            // Validate email format before database query to prevent injection
            const emailResult = validateEmail(config.credentials.userEmail);
            if (!emailResult.valid) {
                displayValidationError(emailResult);
                process.exit(1);
            }
            await initDatabase(config.credentials.databaseUrl);
            const creds = await getUserCredentials(config.credentials.userEmail);
            if (creds) {
                if (creds.githubAccessToken) {
                    config.credentials.githubToken = creds.githubAccessToken;
                }
                if (creds.claudeAuth) {
                    config.credentials.claudeAuth = {
                        accessToken: creds.claudeAuth.accessToken,
                        refreshToken: creds.claudeAuth.refreshToken,
                        expiresAt: creds.claudeAuth.expiresAt,
                    };
                }
            }
        }
        // Validate Claude auth with helpful message
        if (!validateCredentials(config, { claude: true })) {
            process.exit(1);
        }
        // Get existing issues if creating issues
        let existingIssues = [];
        let github;
        if (options.createIssues && config.credentials.githubToken) {
            github = createGitHub({
                token: config.credentials.githubToken,
                owner: config.repo.owner,
                repo: config.repo.name,
            });
            existingIssues = await github.issues.listOpenIssues(config.discovery.issueLabel);
        }
        // Discover tasks
        logger.info('Discovering tasks...');
        const tasks = await discoverTasks({
            claudeAuth: config.credentials.claudeAuth, // Validated above
            repoPath: process.cwd(),
            excludePaths: config.discovery.excludePaths,
            tasksPerCycle: taskCount,
            existingIssues,
            repoContext: 'WebEDT - AI-powered coding assistant platform',
        });
        // Display tasks
        console.log('\n');
        logger.header('Discovered Tasks');
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const priorityColor = task.priority === 'high' ? chalk.red : task.priority === 'medium' ? chalk.yellow : chalk.gray;
            console.log(chalk.bold(`${i + 1}. ${task.title}`));
            console.log(`   ${priorityColor(`[${task.priority}]`)} ${chalk.cyan(`[${task.category}]`)} ${chalk.gray(`[${task.estimatedComplexity}]`)}`);
            console.log(`   ${chalk.gray(task.description.slice(0, 100))}...`);
            console.log(`   ${chalk.gray('Paths:')} ${task.affectedPaths.join(', ')}`);
            console.log();
        }
        // Create issues if requested
        if (options.createIssues && github) {
            logger.info('Creating GitHub issues...');
            for (const task of tasks) {
                const labels = [
                    config.discovery.issueLabel,
                    `priority:${task.priority}`,
                    `type:${task.category}`,
                ];
                const body = `## Description\n\n${task.description}\n\n## Affected Paths\n\n${task.affectedPaths.map((p) => `- \`${p}\``).join('\n')}\n\n---\n*🤖 This issue was automatically created by Autonomous Dev CLI*`;
                const issue = await github.issues.createIssue({
                    title: task.title,
                    body,
                    labels,
                });
                logger.success(`Created issue #${issue.number}: ${task.title}`);
            }
        }
        await closeDatabase();
    }
    catch (error) {
        await closeDatabase();
        handleCommandError(error, 'discover');
    }
});
// Status command - show current status
program
    .command('status')
    .description('Show current status of autonomous development.\n\n' +
    'Displays a summary of the current state including:\n' +
    '  • Repository information\n' +
    '  • Open issues count and status\n' +
    '  • Active pull requests\n' +
    '  • Pending tasks ready for implementation\n' +
    '  • Running daemon status (with --daemon flag)' +
    formatExamples([
        'autonomous-dev status',
        'autonomous-dev status -c ./production.json',
        'autonomous-dev status --daemon --port 9091',
    ]) +
    formatAdditionalInfo('Status Indicators:\n' +
        '  ✓ (green)   PR is mergeable / daemon healthy\n' +
        '  ✗ (red)     PR has conflicts or daemon unhealthy\n' +
        '  ? (yellow)  Merge status pending/unknown\n\n' +
        'Issue Categories:\n' +
        '  • Total open    - All issues with autonomous-dev label\n' +
        '  • In progress   - Issues currently being worked on\n' +
        '  • Pending       - Issues awaiting implementation\n\n' +
        'Daemon Status (--daemon):\n' +
        '  Connect to running daemon health endpoint to check:\n' +
        '  • Daemon uptime and cycle count\n' +
        '  • Worker pool status\n' +
        '  • Last cycle execution time\n' +
        '  • Service health (GitHub, database)'))
    .option('-c, --config <path>', 'Path to configuration file (JSON format)')
    .option('--daemon', 'Check running daemon status via health endpoint')
    .option('-p, --port <port>', 'Daemon health server port (default: 9091)', '9091')
    .option('-H, --host <host>', 'Daemon health server host (default: localhost)', 'localhost')
    .action(async (options) => {
    // Validate options before proceeding
    validateCommonOptions({
        config: options.config,
        port: options.port,
        host: options.host,
    }, 'status');
    // Validate port with detailed error message
    const portResult = validatePort(options.port);
    if (!portResult.valid) {
        displayValidationError(portResult);
        process.exit(1);
    }
    const port = portResult.parsedValue || NUMERIC_RANGES.port.default;
    try {
        // If daemon flag is set, check daemon status
        if (options.daemon) {
            await checkDaemonStatus(options.host, port);
            return;
        }
        const config = loadConfig(options.config);
        // Validate repository configuration
        const repoResult = validateRepoInfo(config.repo.owner, config.repo.name);
        if (!repoResult.valid) {
            displayValidationError(repoResult);
            process.exit(1);
        }
        // Load credentials from database if configured
        if (config.credentials.databaseUrl && config.credentials.userEmail) {
            // Validate email format before database query to prevent injection
            const emailResult = validateEmail(config.credentials.userEmail);
            if (!emailResult.valid) {
                displayValidationError(emailResult);
                process.exit(1);
            }
            await initDatabase(config.credentials.databaseUrl);
            const creds = await getUserCredentials(config.credentials.userEmail);
            if (creds?.githubAccessToken) {
                config.credentials.githubToken = creds.githubAccessToken;
            }
        }
        // Validate GitHub token with helpful message
        if (!validateCredentials(config, { github: true })) {
            process.exit(1);
        }
        const github = createGitHub({
            token: config.credentials.githubToken, // Validated above
            owner: config.repo.owner,
            repo: config.repo.name,
        });
        // Get issues
        const openIssues = await github.issues.listOpenIssues(config.discovery.issueLabel);
        const inProgress = openIssues.filter((i) => i.labels.includes('in-progress'));
        const pending = openIssues.filter((i) => !i.labels.includes('in-progress'));
        // Get open PRs
        const openPRs = await github.pulls.listOpenPRs();
        const autoPRs = openPRs.filter((pr) => pr.head.ref.startsWith('auto/'));
        // Display status
        logger.header('Autonomous Dev Status');
        console.log(chalk.bold('Repository:'), `${config.repo.owner}/${config.repo.name}`);
        console.log(chalk.bold('Base Branch:'), config.repo.baseBranch);
        console.log();
        console.log(chalk.bold('Issues:'));
        console.log(`  Total open:   ${openIssues.length}`);
        console.log(`  In progress:  ${inProgress.length}`);
        console.log(`  Pending:      ${pending.length}`);
        console.log();
        console.log(chalk.bold('Pull Requests:'));
        console.log(`  Auto PRs:     ${autoPRs.length}`);
        console.log();
        if (pending.length > 0) {
            console.log(chalk.bold('Pending Issues:'));
            for (const issue of pending.slice(0, 5)) {
                console.log(`  #${issue.number}: ${issue.title}`);
            }
            if (pending.length > 5) {
                console.log(`  ... and ${pending.length - 5} more`);
            }
            console.log();
        }
        if (autoPRs.length > 0) {
            console.log(chalk.bold('Open Auto PRs:'));
            for (const pr of autoPRs) {
                const status = pr.mergeable === true ? chalk.green('✓') : pr.mergeable === false ? chalk.red('✗') : chalk.yellow('?');
                console.log(`  ${status} #${pr.number}: ${pr.title}`);
            }
            console.log();
        }
        await closeDatabase();
    }
    catch (error) {
        await closeDatabase();
        handleCommandError(error, 'status');
    }
});
/**
 * Check daemon status by connecting to its health endpoint
 */
async function checkDaemonStatus(host, port) {
    const http = await import('http');
    logger.header('Daemon Status Check');
    console.log(chalk.gray(`Connecting to http://${host}:${port}/health...`));
    console.log();
    return new Promise((resolve) => {
        const startTime = Date.now();
        const req = http.request({
            hostname: host,
            port: port,
            path: '/health',
            method: 'GET',
            timeout: 5000,
        }, (res) => {
            const responseTime = Date.now() - startTime;
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const health = JSON.parse(data);
                    displayDaemonHealth(health, responseTime);
                    resolve();
                }
                catch (error) {
                    logger.error('Failed to parse health response', { data });
                    process.exit(1);
                }
            });
        });
        req.on('error', (error) => {
            if (error.code === 'ECONNREFUSED') {
                console.log(chalk.red('✗ Daemon not running'));
                console.log(chalk.gray(`  No daemon found at http://${host}:${port}`));
                console.log();
                console.log(chalk.bold('To start the daemon:'));
                console.log(chalk.gray(`  autonomous-dev start --monitoring-port ${port - 1}`));
            }
            else {
                logger.error('Failed to connect to daemon', { error: error.message });
            }
            process.exit(1);
        });
        req.on('timeout', () => {
            req.destroy();
            logger.error('Connection to daemon timed out');
            process.exit(1);
        });
        req.end();
    });
}
/**
 * Display daemon health information
 */
function displayDaemonHealth(health, responseTime) {
    const statusIcon = health.status === 'healthy'
        ? chalk.green('✓')
        : health.status === 'degraded'
            ? chalk.yellow('⚠')
            : chalk.red('✗');
    console.log(chalk.bold('Daemon Status:'));
    console.log(`  ${statusIcon} ${health.status.toUpperCase()} (${responseTime}ms response)`);
    console.log();
    // Daemon info
    if (health.daemon) {
        console.log(chalk.bold('Daemon Info:'));
        console.log(`  Status:      ${health.daemon.status}`);
        console.log(`  Version:     ${health.daemon.version}`);
        console.log(`  Uptime:      ${formatUptime(health.daemon.uptime)}`);
        console.log(`  Cycle Count: ${health.daemon.cycleCount}`);
        if (health.daemon.lastCycleTime) {
            const lastCycle = new Date(health.daemon.lastCycleTime);
            const ago = Math.floor((Date.now() - lastCycle.getTime()) / 1000);
            const successIcon = health.daemon.lastCycleSuccess ? chalk.green('✓') : chalk.red('✗');
            console.log(`  Last Cycle:  ${successIcon} ${formatUptime(ago)} ago (${health.daemon.lastCycleDuration}ms)`);
        }
        console.log();
    }
    // Worker pool
    if (health.workerPool) {
        console.log(chalk.bold('Worker Pool:'));
        console.log(`  Active:     ${health.workerPool.activeWorkers}/${health.workerPool.maxWorkers}`);
        console.log(`  Queued:     ${health.workerPool.queuedTasks}`);
        console.log(`  Completed:  ${health.workerPool.completedTasks}`);
        console.log(`  Failed:     ${health.workerPool.failedTasks}`);
        console.log();
    }
    // Health checks
    if (health.checks && health.checks.length > 0) {
        console.log(chalk.bold('Health Checks:'));
        for (const check of health.checks) {
            const icon = check.status === 'pass'
                ? chalk.green('✓')
                : check.status === 'warn'
                    ? chalk.yellow('⚠')
                    : chalk.red('✗');
            const time = check.responseTime ? chalk.gray(` (${check.responseTime}ms)`) : '';
            console.log(`  ${icon} ${check.name}: ${check.message || check.status}${time}`);
        }
        console.log();
    }
    console.log(chalk.gray(`Timestamp: ${health.timestamp}`));
}
/**
 * Format uptime in human-readable format
 */
function formatUptime(seconds) {
    if (seconds < 60) {
        return `${seconds}s`;
    }
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}
// Config command - show/validate config
program
    .command('config')
    .description('Show, validate, or upgrade configuration.\n\n' +
    'Displays the current configuration with all settings merged\n' +
    'from defaults, config file, and environment variables.\n\n' +
    'Configuration precedence (highest to lowest):\n' +
    '  1. Environment variables\n' +
    '  2. Config file\n' +
    '  3. Default values' +
    formatExamples([
        'autonomous-dev config',
        'autonomous-dev config --validate  # Validate without display',
        'autonomous-dev config --upgrade   # Migrate config to latest version',
        'autonomous-dev config -c ./custom.json',
    ]) +
    formatAdditionalInfo('Config File Locations (searched in order):\n' +
        '  • ./autonomous-dev.config.json\n' +
        '  • ./autonomous-dev.json\n' +
        '  • ./.autonomous-dev.json\n\n' +
        'Credential Status:\n' +
        '  ✓ configured  - Credential is set and valid\n' +
        '  ✗ missing     - Required credential is not set\n' +
        '  not used      - Optional credential not configured\n\n' +
        'Migration:\n' +
        '  Use --upgrade to migrate older config files to the latest version.\n' +
        '  A backup is created before modifying the original file.\n' +
        `  Current config version: ${CURRENT_CONFIG_VERSION}\n\n` +
        'Run "autonomous-dev init" to create a new config file interactively.'))
    .option('-c, --config <path>', 'Path to configuration file (JSON format)')
    .option('--validate', 'Only validate configuration, do not show details')
    .option('--upgrade', 'Migrate configuration file to the latest version')
    .action(async (options) => {
    // Validate config path if provided
    validateCommonOptions({ config: options.config }, 'config');
    try {
        // Handle --upgrade option
        if (options.upgrade) {
            logger.header('Configuration Migration');
            console.log();
            const result = upgradeConfig(options.config);
            if (result.migrationResult.fromVersion === result.migrationResult.toVersion) {
                logger.success(`Configuration is already at the latest version (v${result.migrationResult.toVersion})`);
                console.log(chalk.gray(`Config file: ${result.configPath}`));
                return;
            }
            console.log(formatMigrationSummary(result.migrationResult));
            if (result.success) {
                logger.success(`Configuration upgraded from v${result.migrationResult.fromVersion} to v${result.migrationResult.toVersion}`);
                console.log(chalk.gray(`Config file: ${result.configPath}`));
                if (result.backupPath) {
                    console.log(chalk.gray(`Backup: ${result.backupPath}`));
                }
                console.log();
                console.log(chalk.bold('Next steps:'));
                console.log('  1. Review the changes in your config file');
                console.log('  2. Run "autonomous-dev config --validate" to verify');
                console.log('  3. Delete the backup file once verified');
            }
            else {
                logger.error('Configuration upgrade failed');
                for (const error of result.migrationResult.errors) {
                    console.error(chalk.red(`  ✗ ${error}`));
                }
                process.exit(1);
            }
            return;
        }
        const config = loadConfig(options.config);
        // Validate repository info
        const repoResult = validateRepoInfo(config.repo.owner, config.repo.name);
        if (!repoResult.valid && options.validate) {
            displayValidationError(repoResult);
            process.exit(1);
        }
        if (options.validate) {
            // Additional credential validation in validate mode
            const hasGitHub = !!config.credentials.githubToken;
            const hasClaude = !!config.credentials.claudeAuth;
            if (!hasGitHub || !hasClaude) {
                console.error();
                console.error(chalk.yellow.bold('Configuration valid but credentials incomplete:'));
                if (!hasGitHub) {
                    console.error(chalk.yellow('  • GitHub token not configured'));
                }
                if (!hasClaude) {
                    console.error(chalk.yellow('  • Claude auth not configured'));
                }
                console.error();
                console.error(chalk.gray('Run "autonomous-dev config" to see credential status'));
                console.error();
                process.exit(0);
            }
            logger.success('Configuration is valid');
            return;
        }
        logger.header('Configuration');
        // Show config version
        const versionStatus = config.version === CURRENT_CONFIG_VERSION
            ? chalk.green(`v${config.version} (current)`)
            : chalk.yellow(`v${config.version} (run --upgrade to migrate to v${CURRENT_CONFIG_VERSION})`);
        console.log(chalk.bold('Version:'), versionStatus);
        console.log();
        console.log(chalk.bold('Repository:'));
        console.log(`  Owner:       ${config.repo.owner || chalk.red('(not set)')}`);
        console.log(`  Name:        ${config.repo.name || chalk.red('(not set)')}`);
        console.log(`  Base Branch: ${config.repo.baseBranch}`);
        console.log();
        console.log(chalk.bold('Discovery:'));
        console.log(`  Tasks/Cycle: ${config.discovery.tasksPerCycle}`);
        console.log(`  Max Open:    ${config.discovery.maxOpenIssues}`);
        console.log(`  Issue Label: ${config.discovery.issueLabel}`);
        console.log();
        console.log(chalk.bold('Execution:'));
        console.log(`  Workers:     ${config.execution.parallelWorkers}`);
        console.log(`  Timeout:     ${config.execution.timeoutMinutes} minutes`);
        console.log(`  Work Dir:    ${config.execution.workDir}`);
        console.log();
        console.log(chalk.bold('Evaluation:'));
        console.log(`  Build:       ${config.evaluation.requireBuild ? chalk.green('✓') : chalk.gray('skip')}`);
        console.log(`  Tests:       ${config.evaluation.requireTests ? chalk.green('✓') : chalk.gray('skip')}`);
        console.log(`  Health:      ${config.evaluation.requireHealthCheck ? chalk.green('✓') : chalk.gray('skip')}`);
        console.log();
        console.log(chalk.bold('Merge:'));
        console.log(`  Auto Merge:  ${config.merge.autoMerge ? chalk.green('✓') : chalk.gray('manual')}`);
        console.log(`  Method:      ${config.merge.mergeMethod}`);
        console.log(`  Strategy:    ${config.merge.conflictStrategy}`);
        console.log();
        console.log(chalk.bold('Credentials:'));
        console.log(`  GitHub:      ${config.credentials.githubToken ? chalk.green('✓ configured') : chalk.red('✗ missing')}`);
        console.log(`  Claude:      ${config.credentials.claudeAuth ? chalk.green('✓ configured') : chalk.red('✗ missing')}`);
        console.log(`  Database:    ${config.credentials.databaseUrl ? chalk.green('✓ configured') : chalk.gray('not used')}`);
        console.log(`  User Email:  ${config.credentials.userEmail || chalk.gray('not set')}`);
    }
    catch (error) {
        handleCommandError(error, 'config');
    }
});
// Init command - interactive setup wizard
program
    .command('init')
    .description('Initialize a new configuration file interactively.\n\n' +
    'This wizard will guide you through setting up autonomous-dev\n' +
    'for your project with sensible defaults and customization options.' +
    formatExamples([
        'autonomous-dev init',
        'autonomous-dev init --force  # Overwrite existing config',
        'autonomous-dev init --example  # Generate example config only',
        'autonomous-dev init --skip-credentials  # Skip credential validation',
    ]) +
    formatAdditionalInfo('The wizard will help you configure:\n' +
        '  • Repository settings (owner, name, branch)\n' +
        '  • Discovery preferences (tasks per cycle, limits)\n' +
        '  • Execution settings (workers, timeouts)\n' +
        '  • Evaluation requirements (build, tests)\n' +
        '  • Merge behavior (auto-merge, method)\n' +
        '  • Credential setup with validation\n\n' +
        'After completion:\n' +
        '  1. Set GITHUB_TOKEN environment variable\n' +
        '  2. Set CLAUDE_ACCESS_TOKEN environment variable\n' +
        '  3. Run "autonomous-dev validate" to verify setup\n' +
        '  4. Run "autonomous-dev discover" to test'))
    .option('--force', 'Overwrite existing configuration file')
    .option('-o, --output <path>', 'Output path for config file', './autonomous-dev.config.json')
    .option('--example', 'Generate an example configuration file without running wizard')
    .option('--skip-credentials', 'Skip credential validation during wizard')
    .action(async (options) => {
    try {
        // If --example flag is set, just generate example config
        if (options.example) {
            const examplePath = options.output.replace('.json', '.example.json');
            generateExampleConfig(examplePath);
            console.log();
            console.log(chalk.gray('To use this example:'));
            console.log(chalk.gray(`  1. Copy ${examplePath} to autonomous-dev.config.json`));
            console.log(chalk.gray('  2. Edit the values to match your repository'));
            console.log(chalk.gray('  3. Run "autonomous-dev validate" to verify'));
            console.log();
            return;
        }
        // Run the interactive wizard
        const result = await runConfigWizard({
            outputPath: options.output,
            force: options.force,
            skipCredentialValidation: options.skipCredentials,
        });
        if (!result) {
            process.exit(1);
        }
    }
    catch (error) {
        if (error instanceof Error && error.message === 'Configuration cancelled by user') {
            process.exit(0);
        }
        handleCommandError(error, 'init');
    }
});
// Validate command - validate configuration with detailed feedback
program
    .command('validate')
    .description('Validate your configuration and credentials setup.\n\n' +
    'Performs comprehensive validation of your autonomous-dev setup:\n' +
    '  • Checks configuration file exists and is valid JSON\n' +
    '  • Validates all required settings are present\n' +
    '  • Verifies credentials are configured correctly\n' +
    '  • Provides specific error messages with solutions\n' +
    '  • Suggests next steps to complete setup' +
    formatExamples([
        'autonomous-dev validate',
        'autonomous-dev validate -c ./production.json',
        'autonomous-dev validate --verbose',
    ]) +
    formatAdditionalInfo('Exit Codes:\n' +
        '  0  Configuration is valid and complete\n' +
        '  1  Configuration has errors that must be fixed\n\n' +
        'Common Issues:\n' +
        '  • Missing configuration file: Run "autonomous-dev init"\n' +
        '  • Missing credentials: Set GITHUB_TOKEN and CLAUDE_ACCESS_TOKEN\n' +
        '  • Invalid JSON: Check for syntax errors in config file\n' +
        '  • Outdated version: Run "autonomous-dev config --upgrade"'))
    .option('-c, --config <path>', 'Path to configuration file to validate')
    .option('-v, --verbose', 'Show detailed validation information')
    .action(async (options) => {
    try {
        // Validate config path if provided
        if (options.config) {
            const configResult = validateConfigPath(options.config);
            if (!configResult.valid) {
                displayValidationError(configResult);
                process.exit(1);
            }
        }
        logger.header('Configuration Validation');
        console.log();
        // Run comprehensive validation
        const result = await validateConfiguration(options.config);
        // Display results
        displayValidationResults(result);
        // In verbose mode, also load and display config details
        if (options.verbose && result.valid) {
            try {
                const config = loadConfig(options.config);
                console.log(chalk.bold('Configuration Details:'));
                console.log(chalk.gray('─'.repeat(40)));
                console.log(`  Repository: ${config.repo.owner}/${config.repo.name}`);
                console.log(`  Base Branch: ${config.repo.baseBranch}`);
                console.log(`  Tasks/Cycle: ${config.discovery.tasksPerCycle}`);
                console.log(`  Max Issues: ${config.discovery.maxOpenIssues}`);
                console.log(`  Workers: ${config.execution.parallelWorkers}`);
                console.log(`  Timeout: ${config.execution.timeoutMinutes} minutes`);
                console.log(`  Auto-merge: ${config.merge.autoMerge ? 'enabled' : 'disabled'}`);
                console.log();
            }
            catch {
                // Config loading failed, but we already showed validation results
            }
        }
        // Exit with appropriate code
        if (!result.valid) {
            process.exit(1);
        }
    }
    catch (error) {
        handleCommandError(error, 'validate');
    }
});
// Help command - show detailed help for configuration
program
    .command('help-config')
    .description('Show detailed help for configuration options.\n\n' +
    'Displays comprehensive documentation for all configuration\n' +
    'settings, environment variables, and their defaults.')
    .action(async () => {
    console.log();
    logger.header('Configuration Reference');
    console.log();
    console.log(getConfigHelp());
});
// Parse and run
program.parse();
//# sourceMappingURL=index.js.map