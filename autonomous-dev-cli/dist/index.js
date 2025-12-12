#!/usr/bin/env node
import { Command } from 'commander';
import { createDaemon } from './daemon.js';
import { loadConfig } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase } from './db/index.js';
import { createGitHub } from './github/index.js';
import { discoverTasks } from './discovery/index.js';
import { logger } from './utils/logger.js';
import chalk from 'chalk';
const program = new Command();
program
    .name('autonomous-dev')
    .description('Autonomous development CLI for continuous website improvement')
    .version('0.1.0');
// Start command - run continuous daemon
program
    .command('start')
    .description('Start the autonomous development daemon (continuous mode)')
    .option('-c, --config <path>', 'Path to config file')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--dry-run', 'Discover tasks but do not execute or create issues')
    .action(async (options) => {
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
    try {
        await daemon.start();
    }
    catch (error) {
        logger.error('Daemon failed', { error: error.message });
        process.exit(1);
    }
});
// Run command - run single cycle
program
    .command('run')
    .description('Run a single development cycle and exit')
    .option('-c, --config <path>', 'Path to config file')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--dry-run', 'Discover tasks but do not execute or create issues')
    .action(async (options) => {
    const daemon = createDaemon({
        configPath: options.config,
        verbose: options.verbose,
        dryRun: options.dryRun,
        singleCycle: true,
    });
    try {
        await daemon.start();
    }
    catch (error) {
        logger.error('Cycle failed', { error: error.message });
        process.exit(1);
    }
});
// Discover command - only discover tasks
program
    .command('discover')
    .description('Discover tasks without executing them')
    .option('-c, --config <path>', 'Path to config file')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('-n, --count <number>', 'Number of tasks to discover', '5')
    .option('--create-issues', 'Create GitHub issues for discovered tasks')
    .action(async (options) => {
    if (options.verbose) {
        logger.setLevel('debug');
    }
    try {
        const config = loadConfig(options.config);
        // Load credentials
        if (config.credentials.databaseUrl && config.credentials.userEmail) {
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
        if (!config.credentials.claudeAuth) {
            logger.error('Claude auth not configured');
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
            claudeAuth: config.credentials.claudeAuth,
            repoPath: process.cwd(),
            excludePaths: config.discovery.excludePaths,
            tasksPerCycle: parseInt(options.count, 10),
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
        logger.error('Discovery failed', { error: error.message });
        process.exit(1);
    }
});
// Status command - show current status
program
    .command('status')
    .description('Show current status of autonomous development')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (options) => {
    try {
        const config = loadConfig(options.config);
        // Load credentials
        if (config.credentials.databaseUrl && config.credentials.userEmail) {
            await initDatabase(config.credentials.databaseUrl);
            const creds = await getUserCredentials(config.credentials.userEmail);
            if (creds?.githubAccessToken) {
                config.credentials.githubToken = creds.githubAccessToken;
            }
        }
        if (!config.credentials.githubToken) {
            logger.error('GitHub token not configured');
            process.exit(1);
        }
        const github = createGitHub({
            token: config.credentials.githubToken,
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
        logger.error('Status check failed', { error: error.message });
        process.exit(1);
    }
});
// Config command - show/validate config
program
    .command('config')
    .description('Show or validate configuration')
    .option('-c, --config <path>', 'Path to config file')
    .option('--validate', 'Only validate, do not show')
    .action(async (options) => {
    try {
        const config = loadConfig(options.config);
        if (options.validate) {
            logger.success('Configuration is valid');
            return;
        }
        logger.header('Configuration');
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
        logger.error('Configuration error', { error: error.message });
        process.exit(1);
    }
});
// Parse and run
program.parse();
//# sourceMappingURL=index.js.map