#!/usr/bin/env node

import { Command } from 'commander';
import { createDaemon, type DaemonOptions } from './daemon.js';
import { loadConfig, getConfigHelp } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase } from './db/index.js';
import { createGitHub } from './github/index.js';
import { discoverTasks } from './discovery/index.js';
import { logger } from './utils/logger.js';
import chalk from 'chalk';
import * as readline from 'readline';
import { writeFileSync, existsSync } from 'fs';

const program = new Command();

// Helper to format examples section
function formatExamples(examples: string[]): string {
  return '\n\nExamples:\n' + examples.map(ex => `  $ ${ex}`).join('\n');
}

// Helper to format additional info
function formatAdditionalInfo(info: string): string {
  return '\n\n' + info;
}

program
  .name('autonomous-dev')
  .description(
    'Autonomous development CLI for continuous website improvement.\n\n' +
    'This tool automates the discovery, implementation, and deployment of\n' +
    'development tasks using AI-powered analysis and GitHub integration.\n\n' +
    'Quick Start:\n' +
    '  1. Run "autonomous-dev init" to create a configuration file\n' +
    '  2. Set up credentials (GitHub token, Claude auth)\n' +
    '  3. Run "autonomous-dev discover" to find tasks\n' +
    '  4. Run "autonomous-dev start" to begin autonomous development\n\n' +
    'For more information on a specific command, run:\n' +
    '  autonomous-dev <command> --help'
  )
  .version('0.1.0');

// Start command - run continuous daemon
program
  .command('start')
  .description(
    'Start the autonomous development daemon in continuous mode.\n\n' +
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
    formatAdditionalInfo(
      'Environment Variables:\n' +
      '  GITHUB_TOKEN         GitHub personal access token\n' +
      '  CLAUDE_ACCESS_TOKEN  Claude API access token\n' +
      '  DATABASE_URL         Database connection URL (optional)\n\n' +
      'Signals:\n' +
      '  SIGINT (Ctrl+C)      Graceful shutdown after current cycle\n' +
      '  SIGTERM              Graceful shutdown after current cycle'
    )
  )
  .option('-c, --config <path>', 'Path to configuration file (JSON format)')
  .option('-v, --verbose', 'Enable verbose/debug logging output')
  .option('--dry-run', 'Discover tasks but do not execute or create issues (safe preview mode)')
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
    } catch (error: any) {
      logger.error('Daemon failed', { error: error.message });
      process.exit(1);
    }
  });

// Run command - run single cycle
program
  .command('run')
  .description(
    'Run a single development cycle and exit.\n\n' +
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
    formatAdditionalInfo(
      'Use Cases:\n' +
      '  • Scheduled runs via cron: 0 */4 * * * autonomous-dev run\n' +
      '  • CI/CD integration for nightly improvements\n' +
      '  • Manual triggering for controlled development\n\n' +
      'Exit Codes:\n' +
      '  0  Cycle completed successfully\n' +
      '  1  Cycle failed (check logs for details)'
    )
  )
  .option('-c, --config <path>', 'Path to configuration file (JSON format)')
  .option('-v, --verbose', 'Enable verbose/debug logging output')
  .option('--dry-run', 'Discover tasks but do not execute or create issues (safe preview mode)')
  .action(async (options) => {
    const daemon = createDaemon({
      configPath: options.config,
      verbose: options.verbose,
      dryRun: options.dryRun,
      singleCycle: true,
    });

    try {
      await daemon.start();
    } catch (error: any) {
      logger.error('Cycle failed', { error: error.message });
      process.exit(1);
    }
  });

// Discover command - only discover tasks
program
  .command('discover')
  .description(
    'Discover development tasks without executing them.\n\n' +
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
    formatAdditionalInfo(
      'Output Information:\n' +
      '  Each task displays:\n' +
      '  • Title and description\n' +
      '  • Priority level (high/medium/low)\n' +
      '  • Category (bug-fix, feature, etc.)\n' +
      '  • Estimated complexity\n' +
      '  • Affected file paths\n\n' +
      'Issue Labels (when --create-issues is used):\n' +
      '  • autonomous-dev (or custom label from config)\n' +
      '  • priority:<level>\n' +
      '  • type:<category>'
    )
  )
  .option('-c, --config <path>', 'Path to configuration file (JSON format)')
  .option('-v, --verbose', 'Enable verbose/debug logging output')
  .option('-n, --count <number>', 'Number of tasks to discover (default: 5, max: 10)', '5')
  .option('--create-issues', 'Create GitHub issues for discovered tasks automatically')
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
      let existingIssues: any[] = [];
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
        const priorityColor =
          task.priority === 'high' ? chalk.red : task.priority === 'medium' ? chalk.yellow : chalk.gray;

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
    } catch (error: any) {
      logger.error('Discovery failed', { error: error.message });
      process.exit(1);
    }
  });

// Status command - show current status
program
  .command('status')
  .description(
    'Show current status of autonomous development.\n\n' +
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
    formatAdditionalInfo(
      'Status Indicators:\n' +
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
      '  • Service health (GitHub, database)'
    )
  )
  .option('-c, --config <path>', 'Path to configuration file (JSON format)')
  .option('--daemon', 'Check running daemon status via health endpoint')
  .option('-p, --port <port>', 'Daemon health server port (default: 9091)', '9091')
  .option('-H, --host <host>', 'Daemon health server host (default: localhost)', 'localhost')
  .action(async (options) => {
    try {
      // If daemon flag is set, check daemon status
      if (options.daemon) {
        await checkDaemonStatus(options.host, parseInt(options.port, 10));
        return;
      }

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
    } catch (error: any) {
      logger.error('Status check failed', { error: error.message });
      process.exit(1);
    }
  });

/**
 * Check daemon status by connecting to its health endpoint
 */
async function checkDaemonStatus(host: string, port: number): Promise<void> {
  const http = await import('http');

  logger.header('Daemon Status Check');
  console.log(chalk.gray(`Connecting to http://${host}:${port}/health...`));
  console.log();

  return new Promise((resolve) => {
    const startTime = Date.now();

    const req = http.request(
      {
        hostname: host,
        port: port,
        path: '/health',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
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
          } catch (error) {
            logger.error('Failed to parse health response', { data });
            process.exit(1);
          }
        });
      }
    );

    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') {
        console.log(chalk.red('✗ Daemon not running'));
        console.log(chalk.gray(`  No daemon found at http://${host}:${port}`));
        console.log();
        console.log(chalk.bold('To start the daemon:'));
        console.log(chalk.gray(`  autonomous-dev start --monitoring-port ${port - 1}`));
      } else {
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
function displayDaemonHealth(health: any, responseTime: number): void {
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
function formatUptime(seconds: number): string {
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
  .description(
    'Show or validate configuration.\n\n' +
    'Displays the current configuration with all settings merged\n' +
    'from defaults, config file, and environment variables.\n\n' +
    'Configuration precedence (highest to lowest):\n' +
    '  1. Environment variables\n' +
    '  2. Config file\n' +
    '  3. Default values' +
    formatExamples([
      'autonomous-dev config',
      'autonomous-dev config --validate  # Validate without display',
      'autonomous-dev config -c ./custom.json',
    ]) +
    formatAdditionalInfo(
      'Config File Locations (searched in order):\n' +
      '  • ./autonomous-dev.config.json\n' +
      '  • ./autonomous-dev.json\n' +
      '  • ./.autonomous-dev.json\n\n' +
      'Credential Status:\n' +
      '  ✓ configured  - Credential is set and valid\n' +
      '  ✗ missing     - Required credential is not set\n' +
      '  not used      - Optional credential not configured\n\n' +
      'Run "autonomous-dev init" to create a new config file interactively.'
    )
  )
  .option('-c, --config <path>', 'Path to configuration file (JSON format)')
  .option('--validate', 'Only validate configuration, do not show details')
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
    } catch (error: any) {
      logger.error('Configuration error', { error: error.message });
      process.exit(1);
    }
  });

// Init command - interactive setup wizard
program
  .command('init')
  .description(
    'Initialize a new configuration file interactively.\n\n' +
    'This wizard will guide you through setting up autonomous-dev\n' +
    'for your project with sensible defaults and customization options.' +
    formatExamples([
      'autonomous-dev init',
      'autonomous-dev init --force  # Overwrite existing config',
    ]) +
    formatAdditionalInfo(
      'The wizard will help you configure:\n' +
      '  • Repository settings (owner, name, branch)\n' +
      '  • Discovery preferences (tasks per cycle, limits)\n' +
      '  • Execution settings (workers, timeouts)\n' +
      '  • Evaluation requirements (build, tests)\n' +
      '  • Merge behavior (auto-merge, method)\n\n' +
      'After completion:\n' +
      '  1. Set GITHUB_TOKEN environment variable\n' +
      '  2. Set CLAUDE_ACCESS_TOKEN environment variable\n' +
      '  3. Run "autonomous-dev config --validate" to verify\n' +
      '  4. Run "autonomous-dev discover" to test'
    )
  )
  .option('--force', 'Overwrite existing configuration file')
  .option('-o, --output <path>', 'Output path for config file', './autonomous-dev.config.json')
  .action(async (options) => {
    const configPath = options.output;

    // Check for existing config
    if (existsSync(configPath) && !options.force) {
      logger.error(`Configuration file already exists at ${configPath}`);
      logger.info('Use --force to overwrite or -o to specify a different path');
      process.exit(1);
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer.trim()));
      });
    };

    const questionWithDefault = async (prompt: string, defaultValue: string): Promise<string> => {
      const answer = await question(`${prompt} [${defaultValue}]: `);
      return answer || defaultValue;
    };

    const questionYesNo = async (prompt: string, defaultValue: boolean): Promise<boolean> => {
      const defaultStr = defaultValue ? 'Y/n' : 'y/N';
      const answer = await question(`${prompt} [${defaultStr}]: `);
      if (!answer) return defaultValue;
      return answer.toLowerCase().startsWith('y');
    };

    try {
      console.log();
      logger.header('Autonomous Dev Setup Wizard');
      console.log();
      console.log(chalk.gray('This wizard will help you create a configuration file.'));
      console.log(chalk.gray('Press Enter to accept default values shown in [brackets].'));
      console.log();

      // Repository settings
      console.log(chalk.bold.cyan('Repository Settings'));
      console.log(chalk.gray('─'.repeat(40)));
      const repoOwner = await question('GitHub repository owner (username or org): ');
      if (!repoOwner) {
        logger.error('Repository owner is required');
        rl.close();
        process.exit(1);
      }
      const repoName = await question('Repository name: ');
      if (!repoName) {
        logger.error('Repository name is required');
        rl.close();
        process.exit(1);
      }
      const baseBranch = await questionWithDefault('Base branch', 'main');
      console.log();

      // Discovery settings
      console.log(chalk.bold.cyan('Discovery Settings'));
      console.log(chalk.gray('─'.repeat(40)));
      const tasksPerCycle = parseInt(await questionWithDefault('Tasks to discover per cycle (1-10)', '5'), 10);
      const maxOpenIssues = parseInt(await questionWithDefault('Maximum open issues before pausing', '10'), 10);
      const issueLabel = await questionWithDefault('Label for auto-created issues', 'autonomous-dev');
      console.log();

      // Execution settings
      console.log(chalk.bold.cyan('Execution Settings'));
      console.log(chalk.gray('─'.repeat(40)));
      const parallelWorkers = parseInt(await questionWithDefault('Parallel workers (1-10)', '4'), 10);
      const timeoutMinutes = parseInt(await questionWithDefault('Task timeout in minutes', '30'), 10);
      console.log();

      // Evaluation settings
      console.log(chalk.bold.cyan('Evaluation Settings'));
      console.log(chalk.gray('─'.repeat(40)));
      const requireBuild = await questionYesNo('Require build to pass?', true);
      const requireTests = await questionYesNo('Require tests to pass?', true);
      const requireHealthCheck = await questionYesNo('Require health checks?', false);
      console.log();

      // Merge settings
      console.log(chalk.bold.cyan('Merge Settings'));
      console.log(chalk.gray('─'.repeat(40)));
      const autoMerge = await questionYesNo('Enable auto-merge for passing PRs?', true);
      const mergeMethodAnswer = await questionWithDefault('Merge method (merge/squash/rebase)', 'squash');
      const mergeMethod = ['merge', 'squash', 'rebase'].includes(mergeMethodAnswer) ? mergeMethodAnswer : 'squash';
      console.log();

      rl.close();

      // Build config object
      const config = {
        repo: {
          owner: repoOwner,
          name: repoName,
          baseBranch,
        },
        discovery: {
          tasksPerCycle: Math.min(10, Math.max(1, tasksPerCycle)),
          maxOpenIssues: Math.max(1, maxOpenIssues),
          excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
          issueLabel,
        },
        execution: {
          parallelWorkers: Math.min(10, Math.max(1, parallelWorkers)),
          timeoutMinutes: Math.min(120, Math.max(5, timeoutMinutes)),
          workDir: '/tmp/autonomous-dev',
        },
        evaluation: {
          requireBuild,
          requireTests,
          requireHealthCheck,
          requireSmokeTests: false,
          healthCheckUrls: [],
          smokeTestUrls: [],
        },
        merge: {
          autoMerge,
          requireAllChecks: true,
          maxRetries: 3,
          conflictStrategy: 'rebase',
          mergeMethod,
        },
        daemon: {
          loopIntervalMs: 60000,
          pauseBetweenCycles: true,
        },
        credentials: {},
      };

      // Write config file
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log();
      logger.success(`Configuration saved to ${configPath}`);
      console.log();

      // Next steps
      console.log(chalk.bold.green('Next Steps:'));
      console.log();
      console.log('  1. Set up credentials as environment variables:');
      console.log(chalk.gray('     export GITHUB_TOKEN="your-github-token"'));
      console.log(chalk.gray('     export CLAUDE_ACCESS_TOKEN="your-claude-token"'));
      console.log();
      console.log('  2. Validate your configuration:');
      console.log(chalk.gray('     autonomous-dev config --validate'));
      console.log();
      console.log('  3. Test task discovery:');
      console.log(chalk.gray('     autonomous-dev discover --dry-run'));
      console.log();
      console.log('  4. Start autonomous development:');
      console.log(chalk.gray('     autonomous-dev start'));
      console.log();
    } catch (error: any) {
      rl.close();
      logger.error('Setup failed', { error: error.message });
      process.exit(1);
    }
  });

// Help command - show detailed help for configuration
program
  .command('help-config')
  .description(
    'Show detailed help for configuration options.\n\n' +
    'Displays comprehensive documentation for all configuration\n' +
    'settings, environment variables, and their defaults.'
  )
  .action(async () => {
    console.log();
    logger.header('Configuration Reference');
    console.log();
    console.log(getConfigHelp());
  });

// Parse and run
program.parse();
