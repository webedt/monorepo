/**
 * Interactive Configuration Wizard for Autonomous Dev CLI
 *
 * Provides a step-by-step guided setup experience for new users
 * with real-time validation and helpful error messages.
 */
import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { validateRepoInfo, validateNumericParam, validateGitHubToken, validateClaudeAuth, NUMERIC_RANGES, } from './validation.js';
import { CURRENT_CONFIG_VERSION } from '../config/schema.js';
import { logger } from './logger.js';
/**
 * Interactive Configuration Wizard
 */
export class ConfigWizard {
    rl;
    state;
    options;
    constructor(options = {}) {
        this.options = {
            outputPath: './autonomous-dev.config.json',
            force: false,
            skipCredentialValidation: false,
            nonInteractive: false,
            ...options,
        };
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        this.state = {
            currentStep: 0,
            totalSteps: 6,
            config: {},
            envFileContent: [],
        };
    }
    /**
     * Run the interactive configuration wizard
     */
    async run() {
        try {
            // Check for existing config
            const configPath = this.options.outputPath;
            if (existsSync(configPath) && !this.options.force) {
                console.error(chalk.red(`\n❌ Configuration file already exists at ${configPath}`));
                console.error(chalk.gray('Use --force to overwrite or -o to specify a different path\n'));
                this.close();
                return null;
            }
            // Display welcome
            this.displayWelcome();
            // Run wizard steps
            await this.stepRepository();
            await this.stepDiscovery();
            await this.stepExecution();
            await this.stepEvaluation();
            await this.stepMerge();
            await this.stepCredentials();
            // Build and save configuration
            const result = await this.finalize();
            this.close();
            return result;
        }
        catch (error) {
            this.close();
            throw error;
        }
    }
    /**
     * Display welcome message and instructions
     */
    displayWelcome() {
        console.log();
        console.log(chalk.bold.cyan('╔════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold.cyan('║') + chalk.bold.white('     🚀 Autonomous Dev CLI - Configuration Wizard          ') + chalk.bold.cyan('║'));
        console.log(chalk.bold.cyan('╚════════════════════════════════════════════════════════════╝'));
        console.log();
        console.log(chalk.gray('This wizard will guide you through setting up autonomous-dev.'));
        console.log(chalk.gray('Press Enter to accept default values shown in [brackets].'));
        console.log(chalk.gray('Press Ctrl+C at any time to cancel.\n'));
    }
    /**
     * Display step header with progress
     */
    displayStepHeader(stepNumber, title, description) {
        this.state.currentStep = stepNumber;
        const progress = `[${stepNumber}/${this.state.totalSteps}]`;
        console.log();
        console.log(chalk.bold.cyan(`${progress} ${title}`));
        console.log(chalk.gray('─'.repeat(60)));
        if (description) {
            console.log(chalk.gray(description));
            console.log();
        }
    }
    /**
     * Prompt for input with default value
     */
    async prompt(message, defaultValue) {
        return new Promise((resolve) => {
            const displayDefault = defaultValue ? chalk.gray(` [${defaultValue}]`) : '';
            this.rl.question(`${message}${displayDefault}: `, (answer) => {
                resolve(answer.trim() || defaultValue || '');
            });
        });
    }
    /**
     * Prompt for yes/no input
     */
    async promptYesNo(message, defaultValue) {
        const defaultStr = defaultValue ? 'Y/n' : 'y/N';
        const answer = await this.prompt(`${message} [${defaultStr}]`);
        if (!answer)
            return defaultValue;
        return answer.toLowerCase().startsWith('y');
    }
    /**
     * Prompt for numeric input with validation
     */
    async promptNumber(message, paramName, range) {
        const rangeHint = chalk.gray(`(${range.min}-${range.max})`);
        const answer = await this.prompt(`${message} ${rangeHint}`, String(range.default));
        const result = validateNumericParam(answer, paramName, range);
        if (!result.valid) {
            console.log(chalk.yellow(`  ⚠ Invalid value, using default: ${range.default}`));
            return range.default;
        }
        return result.parsedValue;
    }
    /**
     * Prompt with real-time validation
     */
    async promptWithValidation(message, validator, required = true) {
        while (true) {
            const answer = await this.prompt(message);
            if (!answer && !required) {
                return '';
            }
            if (!answer && required) {
                console.log(chalk.red('  ✗ This field is required'));
                continue;
            }
            const result = validator(answer);
            if (!result.valid) {
                console.log(chalk.red(`  ✗ ${result.message}`));
                continue;
            }
            if (result.warning) {
                console.log(chalk.yellow(`  ⚠ ${result.warning}`));
            }
            return answer;
        }
    }
    /**
     * Step 1: Repository Settings
     */
    async stepRepository() {
        this.displayStepHeader(1, 'Repository Settings', 'Configure the GitHub repository autonomous-dev will work with.');
        // Repository owner
        const owner = await this.promptWithValidation('GitHub repository owner (username or org)', (value) => {
            const result = validateRepoInfo(value, 'placeholder');
            if (!result.valid && result.error?.message.includes('owner')) {
                return { valid: false, message: 'Owner should contain only alphanumeric characters and hyphens' };
            }
            return { valid: true };
        });
        // Repository name
        const name = await this.promptWithValidation('Repository name', (value) => {
            const result = validateRepoInfo(owner, value);
            if (!result.valid && result.error?.message.includes('name')) {
                return { valid: false, message: 'Name should contain only alphanumeric characters, dots, underscores, and hyphens' };
            }
            return { valid: true };
        });
        // Base branch
        const baseBranch = await this.prompt('Base branch', 'main');
        this.state.config.repo = { owner, name, baseBranch };
        console.log(chalk.green(`  ✓ Repository: ${owner}/${name} (branch: ${baseBranch})`));
    }
    /**
     * Step 2: Discovery Settings
     */
    async stepDiscovery() {
        this.displayStepHeader(2, 'Discovery Settings', 'Control how tasks are discovered and managed.');
        const tasksPerCycle = await this.promptNumber('Tasks to discover per cycle', 'tasksPerCycle', NUMERIC_RANGES.taskCount);
        const maxOpenIssues = await this.promptNumber('Maximum open issues before pausing', 'maxOpenIssues', NUMERIC_RANGES.maxOpenIssues);
        const issueLabel = await this.prompt('Label for auto-created issues', 'autonomous-dev');
        // Exclude paths
        console.log(chalk.gray('\n  Default excluded paths: node_modules, dist, .git, coverage, *.lock'));
        const customExcludes = await this.prompt('Additional paths to exclude (comma-separated)', '');
        const excludePaths = ['node_modules', 'dist', '.git', 'coverage', '*.lock'];
        if (customExcludes) {
            excludePaths.push(...customExcludes.split(',').map((p) => p.trim()));
        }
        this.state.config.discovery = {
            tasksPerCycle,
            maxOpenIssues,
            excludePaths,
            issueLabel,
        };
        console.log(chalk.green(`  ✓ Discovery: ${tasksPerCycle} tasks/cycle, max ${maxOpenIssues} open issues`));
    }
    /**
     * Step 3: Execution Settings
     */
    async stepExecution() {
        this.displayStepHeader(3, 'Execution Settings', 'Configure how tasks are executed.');
        const parallelWorkers = await this.promptNumber('Parallel workers', 'parallelWorkers', NUMERIC_RANGES.workerCount);
        const timeoutMinutes = await this.promptNumber('Task timeout in minutes', 'timeoutMinutes', NUMERIC_RANGES.timeoutMinutes);
        const workDir = await this.prompt('Working directory', '/tmp/autonomous-dev');
        this.state.config.execution = {
            parallelWorkers,
            timeoutMinutes,
            workDir,
        };
        console.log(chalk.green(`  ✓ Execution: ${parallelWorkers} workers, ${timeoutMinutes}min timeout`));
    }
    /**
     * Step 4: Evaluation Settings
     */
    async stepEvaluation() {
        this.displayStepHeader(4, 'Evaluation Settings', 'Configure quality checks before merging PRs.');
        const requireBuild = await this.promptYesNo('Require build to pass?', true);
        const requireTests = await this.promptYesNo('Require tests to pass?', true);
        const requireHealthCheck = await this.promptYesNo('Require health checks?', false);
        const requireSmokeTests = await this.promptYesNo('Require smoke tests?', false);
        // Health check URLs if enabled
        let healthCheckUrls = [];
        if (requireHealthCheck) {
            const urls = await this.prompt('Health check URLs (comma-separated)', '');
            if (urls) {
                healthCheckUrls = urls.split(',').map((u) => u.trim());
            }
        }
        // Smoke test URLs if enabled
        let smokeTestUrls = [];
        if (requireSmokeTests) {
            const urls = await this.prompt('Smoke test URLs (comma-separated)', '');
            if (urls) {
                smokeTestUrls = urls.split(',').map((u) => u.trim());
            }
        }
        this.state.config.evaluation = {
            requireBuild,
            requireTests,
            requireHealthCheck,
            requireSmokeTests,
            healthCheckUrls,
            smokeTestUrls,
        };
        const checks = [];
        if (requireBuild)
            checks.push('build');
        if (requireTests)
            checks.push('tests');
        if (requireHealthCheck)
            checks.push('health');
        if (requireSmokeTests)
            checks.push('smoke');
        console.log(chalk.green(`  ✓ Evaluation: ${checks.length > 0 ? checks.join(', ') : 'none'}`));
    }
    /**
     * Step 5: Merge Settings
     */
    async stepMerge() {
        this.displayStepHeader(5, 'Merge Settings', 'Configure how pull requests are merged.');
        const autoMerge = await this.promptYesNo('Enable auto-merge for passing PRs?', true);
        // Merge method
        console.log(chalk.gray('\n  Merge methods: merge, squash, rebase'));
        let mergeMethod = await this.prompt('Merge method', 'squash');
        if (!['merge', 'squash', 'rebase'].includes(mergeMethod)) {
            console.log(chalk.yellow('  ⚠ Invalid method, using squash'));
            mergeMethod = 'squash';
        }
        // Conflict strategy
        console.log(chalk.gray('\n  Conflict strategies: rebase, merge, manual'));
        let conflictStrategy = await this.prompt('Conflict strategy', 'rebase');
        if (!['rebase', 'merge', 'manual'].includes(conflictStrategy)) {
            console.log(chalk.yellow('  ⚠ Invalid strategy, using rebase'));
            conflictStrategy = 'rebase';
        }
        this.state.config.merge = {
            autoMerge,
            requireAllChecks: true,
            maxRetries: 3,
            conflictStrategy,
            mergeMethod,
        };
        console.log(chalk.green(`  ✓ Merge: ${autoMerge ? 'auto' : 'manual'}, method: ${mergeMethod}`));
    }
    /**
     * Step 6: Credentials Setup
     */
    async stepCredentials() {
        this.displayStepHeader(6, 'Credentials Setup', 'Configure authentication credentials.\n' +
            chalk.yellow('⚠ Security: Credentials should be stored in environment variables, not config files.'));
        this.state.config.credentials = {};
        // Check for existing environment variables
        const hasGitHubToken = !!process.env.GITHUB_TOKEN;
        const hasClaudeToken = !!process.env.CLAUDE_ACCESS_TOKEN;
        console.log(chalk.bold('\nCurrent credential status:'));
        console.log(`  GITHUB_TOKEN:        ${hasGitHubToken ? chalk.green('✓ configured') : chalk.red('✗ not set')}`);
        console.log(`  CLAUDE_ACCESS_TOKEN: ${hasClaudeToken ? chalk.green('✓ configured') : chalk.red('✗ not set')}`);
        console.log();
        // Validate existing credentials if present
        if (!this.options.skipCredentialValidation) {
            if (hasGitHubToken) {
                const spinner = ora('Validating GitHub token...').start();
                const result = validateGitHubToken(process.env.GITHUB_TOKEN);
                if (result.valid) {
                    spinner.succeed('GitHub token is valid');
                }
                else {
                    spinner.warn('GitHub token format may be invalid');
                }
            }
            if (hasClaudeToken) {
                const spinner = ora('Validating Claude token...').start();
                const result = validateClaudeAuth({ accessToken: process.env.CLAUDE_ACCESS_TOKEN });
                if (result.valid) {
                    spinner.succeed('Claude token is configured');
                }
                else {
                    spinner.warn('Claude token may be invalid');
                }
            }
        }
        // Offer to set up missing credentials
        if (!hasGitHubToken || !hasClaudeToken) {
            console.log();
            const setupNow = await this.promptYesNo('Would you like to generate an example .env file?', true);
            if (setupNow) {
                this.state.envFileContent = this.generateEnvFileContent();
            }
        }
    }
    /**
     * Generate .env file content with examples
     */
    generateEnvFileContent() {
        return [
            '# Autonomous Dev CLI - Environment Variables',
            '# Generated by autonomous-dev init',
            '#',
            '# IMPORTANT: Never commit this file to version control!',
            '# Add .env to your .gitignore file.',
            '',
            '# =============================================================================',
            '# REQUIRED CREDENTIALS',
            '# =============================================================================',
            '',
            '# GitHub Personal Access Token',
            '# Create at: https://github.com/settings/tokens',
            '# Required scopes: repo, workflow',
            'GITHUB_TOKEN=your-github-token-here',
            '',
            '# Claude API Access Token',
            '# Create at: https://console.anthropic.com/',
            'CLAUDE_ACCESS_TOKEN=your-claude-token-here',
            '',
            '# Optional: Claude Refresh Token (for automatic token refresh)',
            '# CLAUDE_REFRESH_TOKEN=your-refresh-token-here',
            '',
            '# =============================================================================',
            '# OPTIONAL SETTINGS (override config file values)',
            '# =============================================================================',
            '',
            '# Repository settings (can also be set in config file)',
            `# REPO_OWNER=${this.state.config.repo?.owner || 'your-username'}`,
            `# REPO_NAME=${this.state.config.repo?.name || 'your-repo'}`,
            '# REPO_BASE_BRANCH=main',
            '',
            '# Execution settings',
            `# PARALLEL_WORKERS=${this.state.config.execution?.parallelWorkers || 4}`,
            `# TIMEOUT_MINUTES=${this.state.config.execution?.timeoutMinutes || 30}`,
            '',
            '# Logging settings',
            '# LOG_LEVEL=info',
            '# LOG_FORMAT=pretty',
            '',
            '# Database connection (optional)',
            '# DATABASE_URL=postgresql://user:password@localhost:5432/autonomous_dev',
            '',
        ];
    }
    /**
     * Finalize and save configuration
     */
    async finalize() {
        console.log();
        console.log(chalk.bold.cyan('═'.repeat(60)));
        console.log(chalk.bold.cyan(' Configuration Summary'));
        console.log(chalk.bold.cyan('═'.repeat(60)));
        console.log();
        // Display summary
        this.displayConfigSummary();
        // Confirm save
        console.log();
        const confirm = await this.promptYesNo('Save configuration?', true);
        if (!confirm) {
            console.log(chalk.yellow('\nConfiguration cancelled. No files were created.'));
            throw new Error('Configuration cancelled by user');
        }
        // Build final config
        const config = this.buildFinalConfig();
        const configPath = this.options.outputPath;
        // Save config file with comments
        const configContent = this.generateConfigWithComments(config);
        writeFileSync(configPath, configContent);
        console.log(chalk.green(`\n✓ Configuration saved to ${configPath}`));
        // Save .env file if generated
        let envPath;
        if (this.state.envFileContent.length > 0) {
            envPath = '.env.example';
            // Don't overwrite existing .env, use .env.example
            if (existsSync('.env')) {
                envPath = '.env.example';
            }
            writeFileSync(envPath, this.state.envFileContent.join('\n') + '\n');
            console.log(chalk.green(`✓ Environment template saved to ${envPath}`));
        }
        // Display next steps
        this.displayNextSteps();
        return { configPath, envPath };
    }
    /**
     * Display configuration summary
     */
    displayConfigSummary() {
        const c = this.state.config;
        console.log(chalk.bold('Repository:'));
        console.log(`  ${c.repo?.owner}/${c.repo?.name} (${c.repo?.baseBranch})`);
        console.log();
        console.log(chalk.bold('Discovery:'));
        console.log(`  ${c.discovery?.tasksPerCycle} tasks/cycle, max ${c.discovery?.maxOpenIssues} issues`);
        console.log();
        console.log(chalk.bold('Execution:'));
        console.log(`  ${c.execution?.parallelWorkers} workers, ${c.execution?.timeoutMinutes}min timeout`);
        console.log();
        console.log(chalk.bold('Evaluation:'));
        const checks = [];
        if (c.evaluation?.requireBuild)
            checks.push('build');
        if (c.evaluation?.requireTests)
            checks.push('tests');
        if (c.evaluation?.requireHealthCheck)
            checks.push('health');
        if (c.evaluation?.requireSmokeTests)
            checks.push('smoke');
        console.log(`  Required: ${checks.length > 0 ? checks.join(', ') : 'none'}`);
        console.log();
        console.log(chalk.bold('Merge:'));
        console.log(`  ${c.merge?.autoMerge ? 'Auto-merge' : 'Manual'}, method: ${c.merge?.mergeMethod}`);
    }
    /**
     * Build final configuration object
     */
    buildFinalConfig() {
        return {
            version: CURRENT_CONFIG_VERSION,
            repo: this.state.config.repo,
            discovery: this.state.config.discovery,
            execution: this.state.config.execution,
            evaluation: this.state.config.evaluation,
            merge: this.state.config.merge,
            daemon: {
                loopIntervalMs: 60000,
                pauseBetweenCycles: true,
            },
            credentials: {},
        };
    }
    /**
     * Generate config file content with helpful comments
     */
    generateConfigWithComments(config) {
        // For JSON we can't add inline comments, but we can add a header comment
        // by using a special key that gets ignored or documentation
        const configWithMeta = {
            _comment: 'Autonomous Dev CLI Configuration - Generated by autonomous-dev init',
            _documentation: 'Run "autonomous-dev help-config" for detailed documentation',
            ...config,
        };
        // Remove meta comments and return clean JSON
        const cleanConfig = { ...config };
        return JSON.stringify(cleanConfig, null, 2) + '\n';
    }
    /**
     * Display next steps after configuration
     */
    displayNextSteps() {
        console.log();
        console.log(chalk.bold.green('╔════════════════════════════════════════════════════════════╗'));
        console.log(chalk.bold.green('║') + chalk.bold.white('                    🎉 Setup Complete!                      ') + chalk.bold.green('║'));
        console.log(chalk.bold.green('╚════════════════════════════════════════════════════════════╝'));
        console.log();
        console.log(chalk.bold('Next steps:'));
        console.log();
        const hasGitHubToken = !!process.env.GITHUB_TOKEN;
        const hasClaudeToken = !!process.env.CLAUDE_ACCESS_TOKEN;
        let step = 1;
        if (!hasGitHubToken || !hasClaudeToken) {
            console.log(chalk.cyan(`  ${step++}. Set up credentials:`));
            if (!hasGitHubToken) {
                console.log(chalk.gray('     export GITHUB_TOKEN="your-github-token"'));
            }
            if (!hasClaudeToken) {
                console.log(chalk.gray('     export CLAUDE_ACCESS_TOKEN="your-claude-token"'));
            }
            console.log();
        }
        console.log(chalk.cyan(`  ${step++}. Validate your configuration:`));
        console.log(chalk.gray('     autonomous-dev config --validate'));
        console.log();
        console.log(chalk.cyan(`  ${step++}. Test task discovery:`));
        console.log(chalk.gray('     autonomous-dev discover --dry-run'));
        console.log();
        console.log(chalk.cyan(`  ${step++}. Start autonomous development:`));
        console.log(chalk.gray('     autonomous-dev start'));
        console.log();
        console.log(chalk.gray('For more help, run: autonomous-dev help-config'));
        console.log();
    }
    /**
     * Close the readline interface
     */
    close() {
        this.rl.close();
    }
}
/**
 * Run the configuration wizard
 */
export async function runConfigWizard(options = {}) {
    const wizard = new ConfigWizard(options);
    return wizard.run();
}
/**
 * Validate configuration with detailed results
 */
export async function validateConfiguration(configPath) {
    const result = {
        valid: true,
        errors: [],
        warnings: [],
        suggestions: [],
    };
    // Check for config file
    const possiblePaths = configPath
        ? [configPath]
        : [
            './autonomous-dev.config.json',
            './autonomous-dev.json',
            './.autonomous-dev.json',
        ];
    let foundPath;
    let config;
    for (const path of possiblePaths) {
        const fullPath = resolve(path);
        if (existsSync(fullPath)) {
            try {
                const content = readFileSync(fullPath, 'utf-8');
                config = JSON.parse(content);
                foundPath = fullPath;
                break;
            }
            catch (error) {
                result.errors.push({
                    field: 'config',
                    message: `Failed to parse config file: ${path}`,
                    suggestion: 'Ensure the file contains valid JSON',
                });
                result.valid = false;
                return result;
            }
        }
    }
    if (!foundPath || !config) {
        result.errors.push({
            field: 'config',
            message: 'No configuration file found',
            suggestion: 'Run "autonomous-dev init" to create a configuration file',
        });
        result.valid = false;
        return result;
    }
    // Validate repository settings
    const repo = config.repo;
    if (!repo?.owner) {
        result.errors.push({
            field: 'repo.owner',
            message: 'Repository owner is required',
            suggestion: 'Set repo.owner in your config file or REPO_OWNER environment variable',
        });
        result.valid = false;
    }
    if (!repo?.name) {
        result.errors.push({
            field: 'repo.name',
            message: 'Repository name is required',
            suggestion: 'Set repo.name in your config file or REPO_NAME environment variable',
        });
        result.valid = false;
    }
    // Check credentials
    const hasGitHubToken = !!process.env.GITHUB_TOKEN;
    const hasClaudeToken = !!process.env.CLAUDE_ACCESS_TOKEN;
    if (!hasGitHubToken) {
        result.errors.push({
            field: 'credentials.githubToken',
            message: 'GitHub token is not configured',
            suggestion: 'Set the GITHUB_TOKEN environment variable',
        });
        result.valid = false;
    }
    else {
        // Validate token format
        const tokenResult = validateGitHubToken(process.env.GITHUB_TOKEN);
        if (!tokenResult.valid) {
            result.warnings.push({
                field: 'credentials.githubToken',
                message: 'GitHub token format may be invalid',
                suggestion: 'Verify the token was copied correctly from GitHub',
            });
        }
    }
    if (!hasClaudeToken) {
        result.errors.push({
            field: 'credentials.claudeAuth',
            message: 'Claude API token is not configured',
            suggestion: 'Set the CLAUDE_ACCESS_TOKEN environment variable',
        });
        result.valid = false;
    }
    // Check for outdated config version
    const version = config.version;
    if (!version) {
        result.warnings.push({
            field: 'version',
            message: 'Configuration version not specified',
            suggestion: 'Run "autonomous-dev config --upgrade" to update your configuration',
        });
    }
    else if (version < CURRENT_CONFIG_VERSION) {
        result.warnings.push({
            field: 'version',
            message: `Configuration version ${version} is outdated (current: ${CURRENT_CONFIG_VERSION})`,
            suggestion: 'Run "autonomous-dev config --upgrade" to migrate to the latest version',
        });
    }
    // Add helpful suggestions
    if (result.valid) {
        result.suggestions.push('Your configuration is valid and ready to use!');
        result.suggestions.push('Run "autonomous-dev discover" to test task discovery');
        result.suggestions.push('Run "autonomous-dev start" to begin autonomous development');
    }
    else {
        result.suggestions.push('Fix the errors above to complete your setup');
        result.suggestions.push('Run "autonomous-dev init --force" to create a new configuration');
        result.suggestions.push('Run "autonomous-dev help-config" for detailed documentation');
    }
    return result;
}
/**
 * Display validation results in a user-friendly format
 */
export function displayValidationResults(result) {
    console.log();
    if (result.valid) {
        console.log(chalk.bold.green('✓ Configuration is valid'));
        console.log();
    }
    else {
        console.log(chalk.bold.red('✗ Configuration has errors'));
        console.log();
    }
    // Display errors
    if (result.errors.length > 0) {
        console.log(chalk.bold.red('Errors:'));
        for (const error of result.errors) {
            console.log(chalk.red(`  ✗ ${error.field}: ${error.message}`));
            if (error.suggestion) {
                console.log(chalk.gray(`    → ${error.suggestion}`));
            }
        }
        console.log();
    }
    // Display warnings
    if (result.warnings.length > 0) {
        console.log(chalk.bold.yellow('Warnings:'));
        for (const warning of result.warnings) {
            console.log(chalk.yellow(`  ⚠ ${warning.field}: ${warning.message}`));
            if (warning.suggestion) {
                console.log(chalk.gray(`    → ${warning.suggestion}`));
            }
        }
        console.log();
    }
    // Display suggestions
    if (result.suggestions.length > 0) {
        console.log(chalk.bold('Next steps:'));
        for (const suggestion of result.suggestions) {
            console.log(chalk.cyan(`  • ${suggestion}`));
        }
        console.log();
    }
}
/**
 * Generate an example configuration file with comments
 */
export function generateExampleConfig(outputPath = './autonomous-dev.config.example.json') {
    const exampleConfig = {
        version: CURRENT_CONFIG_VERSION,
        repo: {
            owner: 'your-username',
            name: 'your-repository',
            baseBranch: 'main',
        },
        discovery: {
            tasksPerCycle: 5,
            maxOpenIssues: 10,
            excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
            issueLabel: 'autonomous-dev',
        },
        execution: {
            parallelWorkers: 4,
            timeoutMinutes: 30,
            workDir: '/tmp/autonomous-dev',
        },
        evaluation: {
            requireBuild: true,
            requireTests: true,
            requireHealthCheck: false,
            requireSmokeTests: false,
            healthCheckUrls: [],
            smokeTestUrls: [],
        },
        merge: {
            autoMerge: true,
            requireAllChecks: true,
            maxRetries: 3,
            conflictStrategy: 'rebase',
            mergeMethod: 'squash',
        },
        daemon: {
            loopIntervalMs: 60000,
            pauseBetweenCycles: true,
        },
        credentials: {},
    };
    writeFileSync(outputPath, JSON.stringify(exampleConfig, null, 2) + '\n');
    logger.success(`Example configuration written to ${outputPath}`);
}
//# sourceMappingURL=configWizard.js.map