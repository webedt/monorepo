/**
 * Input validation utilities for CLI commands
 * Provides validation for command options with user-friendly error messages
 *
 * Security features:
 * - Path traversal prevention for file paths
 * - Input sanitization for shell-safe operations
 * - Format validation for emails, URLs, and identifiers
 * - Bounds checking for numeric inputs
 */
import { existsSync, accessSync, constants } from 'fs';
import { resolve, normalize, isAbsolute, relative } from 'path';
import chalk from 'chalk';
import { ErrorCode, ValidationError } from './errors.js';
import { z } from 'zod';
/**
 * Common numeric ranges for CLI options
 */
export const NUMERIC_RANGES = {
    workerCount: { min: 1, max: 10, default: 4 },
    taskCount: { min: 1, max: 10, default: 5 },
    port: { min: 1, max: 65535, default: 9091 },
    timeoutMinutes: { min: 5, max: 120, default: 30 },
    maxOpenIssues: { min: 1, max: 100, default: 10 },
    loopIntervalMs: { min: 0, max: 86400000, default: 60000 }, // 0 to 24 hours
    maxRetries: { min: 1, max: 10, default: 3 },
    maxDepth: { min: 1, max: 20, default: 10 },
    maxFiles: { min: 100, max: 50000, default: 10000 },
};
/**
 * Dangerous path patterns that indicate potential path traversal attacks
 */
const PATH_TRAVERSAL_PATTERNS = [
    /\.\.\//, // ../
    /\.\.\\/, // ..\
    /\.\.$/, // ends with ..
    /^\.\.$/, // just ..
    /%2e%2e/i, // URL encoded ..
    /%2f/i, // URL encoded /
    /%5c/i, // URL encoded \
    /\0/, // null byte
];
/**
 * Allowed base directories for workDir (security boundary)
 */
const ALLOWED_WORK_DIR_BASES = [
    '/tmp',
    '/var/tmp',
    process.env.HOME ? `${process.env.HOME}/.autonomous-dev` : null,
    process.env.TMPDIR || null,
].filter(Boolean);
/**
 * Zod schema for validating email format
 */
export const EmailSchema = z.string().email('Invalid email format');
/**
 * Zod schema for validating GitHub repository owner
 * Must be alphanumeric with hyphens, cannot start/end with hyphen
 */
export const GitHubOwnerSchema = z.string()
    .min(1, 'Repository owner is required')
    .max(39, 'GitHub username cannot exceed 39 characters')
    .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/, 'Owner must be alphanumeric with hyphens, cannot start or end with hyphen');
/**
 * Zod schema for validating GitHub repository name
 * Allows alphanumeric, dots, underscores, and hyphens
 */
export const GitHubRepoNameSchema = z.string()
    .min(1, 'Repository name is required')
    .max(100, 'Repository name cannot exceed 100 characters')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Repository name must contain only alphanumeric characters, dots, underscores, and hyphens')
    .refine((name) => !name.endsWith('.git'), 'Repository name should not end with .git');
/**
 * Zod schema for validating file paths (no traversal)
 */
export const SafePathSchema = z.string()
    .refine((path) => !PATH_TRAVERSAL_PATTERNS.some(pattern => pattern.test(path)), 'Path contains potentially dangerous traversal patterns');
/**
 * Zod schema for environment variable names
 */
export const EnvVarNameSchema = z.string()
    .regex(/^[A-Z_][A-Z0-9_]*$/, 'Environment variable name must be uppercase letters, numbers, and underscores');
/**
 * Check if a path contains path traversal attempts
 * @param inputPath - The path to check
 * @returns true if path traversal is detected
 */
export function containsPathTraversal(inputPath) {
    return PATH_TRAVERSAL_PATTERNS.some(pattern => pattern.test(inputPath));
}
/**
 * Validate and sanitize a path to prevent path traversal attacks
 * @param inputPath - The path to validate
 * @param allowedBase - Optional base directory the path must be within
 * @returns ValidationResult with sanitized path or error
 */
export function validatePath(inputPath, allowedBase) {
    // Check for null bytes and URL-encoded traversal
    if (containsPathTraversal(inputPath)) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Path contains potentially dangerous characters or traversal sequences: "${inputPath}"`, {
                field: 'path',
                value: inputPath,
                constraints: ['Must not contain path traversal sequences (../, ..\\, etc.)'],
                recoveryActions: [
                    {
                        description: 'Use an absolute path without traversal sequences',
                        automatic: false,
                    },
                    {
                        description: 'Ensure the path does not contain URL-encoded characters',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Path traversal detected. Use a direct absolute or relative path without ".." sequences.',
        };
    }
    // Normalize and resolve the path
    const normalizedPath = normalize(inputPath);
    const resolvedPath = resolve(normalizedPath);
    // If an allowed base is specified, ensure the resolved path is within it
    if (allowedBase) {
        const normalizedBase = normalize(resolve(allowedBase));
        const relativePath = relative(normalizedBase, resolvedPath);
        // If relative path starts with '..', it's outside the allowed base
        if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
            return {
                valid: false,
                error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Path "${inputPath}" resolves outside the allowed directory: "${allowedBase}"`, {
                    field: 'path',
                    value: inputPath,
                    constraints: [`Path must be within ${allowedBase}`],
                    recoveryActions: [
                        {
                            description: `Use a path within the allowed directory: ${allowedBase}`,
                            automatic: false,
                        },
                    ],
                }),
                suggestion: `The path must be within ${allowedBase}`,
            };
        }
    }
    return { valid: true, sanitizedPath: resolvedPath };
}
/**
 * Validate workDir path for security
 * Ensures the path is within allowed directories and doesn't contain traversal attacks
 * @param workDir - The working directory path
 * @returns ValidationResult with sanitized path or error
 */
export function validateWorkDir(workDir) {
    // First check for path traversal
    const pathResult = validatePath(workDir);
    if (!pathResult.valid) {
        return pathResult;
    }
    const resolvedPath = pathResult.sanitizedPath;
    // Check if the path is within an allowed base directory
    const isAllowed = ALLOWED_WORK_DIR_BASES.some(base => {
        try {
            const normalizedBase = normalize(resolve(base));
            const relativePath = relative(normalizedBase, resolvedPath);
            return !relativePath.startsWith('..') && !isAbsolute(relativePath);
        }
        catch {
            return false;
        }
    });
    if (!isAllowed) {
        // Allow paths that are direct subdirectories of current working directory
        const cwd = process.cwd();
        const relativeToCmd = relative(cwd, resolvedPath);
        const isWithinCwd = !relativeToCmd.startsWith('..') && !isAbsolute(relativeToCmd);
        if (!isWithinCwd) {
            return {
                valid: false,
                error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Working directory "${workDir}" is outside allowed locations`, {
                    field: 'workDir',
                    value: workDir,
                    constraints: [
                        'workDir must be within /tmp, /var/tmp, ~/.autonomous-dev, or current working directory',
                    ],
                    recoveryActions: [
                        {
                            description: 'Use a working directory within /tmp (recommended)',
                            automatic: false,
                        },
                        {
                            description: 'Use a subdirectory of your current working directory',
                            automatic: false,
                        },
                    ],
                }),
                suggestion: `Allowed locations: ${ALLOWED_WORK_DIR_BASES.join(', ')}, or subdirectories of ${cwd}`,
            };
        }
    }
    return { valid: true, sanitizedPath: resolvedPath };
}
/**
 * Validate email format before database queries
 * @param email - Email address to validate
 * @returns ValidationResult with error details if invalid
 */
export function validateEmail(email) {
    if (!email) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_REQUIRED_FIELD, 'Email address is required', {
                field: 'email',
                recoveryActions: [
                    {
                        description: 'Provide a valid email address',
                        automatic: false,
                    },
                    {
                        description: 'Set the USER_EMAIL environment variable',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Provide a valid email address (e.g., user@example.com)',
        };
    }
    const result = EmailSchema.safeParse(email);
    if (!result.success) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Invalid email format: "${email}"`, {
                field: 'email',
                value: email,
                constraints: ['Must be a valid email address format'],
                recoveryActions: [
                    {
                        description: 'Check the email address for typos',
                        automatic: false,
                    },
                    {
                        description: 'Use format: user@domain.com',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Email must be in the format: user@domain.com',
        };
    }
    // Additional security: prevent SQL injection patterns in email
    const dangerousPatterns = [/[;'"\\]/];
    if (dangerousPatterns.some(pattern => pattern.test(email))) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, 'Email contains invalid characters', {
                field: 'email',
                value: email,
                constraints: ['Email must not contain special SQL characters'],
                recoveryActions: [
                    {
                        description: 'Remove special characters from the email address',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Email must not contain characters like ; \' " \\',
        };
    }
    return { valid: true };
}
/**
 * Validate a config file path
 * @param configPath - Path to the config file
 * @returns ValidationResult with error details if invalid
 */
export function validateConfigPath(configPath) {
    if (!configPath) {
        return { valid: true }; // Optional, will use default paths
    }
    // Check for path traversal attacks
    const pathResult = validatePath(configPath);
    if (!pathResult.valid) {
        return pathResult;
    }
    const resolvedPath = pathResult.sanitizedPath;
    // Check if path exists
    if (!existsSync(resolvedPath)) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.CONFIG_FILE_NOT_FOUND, `Configuration file not found: ${configPath}`, {
                field: 'config',
                value: configPath,
                recoveryActions: [
                    {
                        description: `Create a config file at "${configPath}" or use --config with a valid path`,
                        automatic: false,
                    },
                    {
                        description: 'Run "autonomous-dev init" to create a new configuration file',
                        automatic: false,
                    },
                    {
                        description: 'Check that the file path is correct and the file exists',
                        automatic: false,
                    },
                ],
                context: {
                    providedPath: configPath,
                    resolvedPath,
                    suggestedLocations: [
                        './autonomous-dev.config.json',
                        './autonomous-dev.json',
                        './.autonomous-dev.json',
                    ],
                },
            }),
            suggestion: `Try one of these default locations:\n` +
                `  • ./autonomous-dev.config.json\n` +
                `  • ./autonomous-dev.json\n` +
                `  • ./.autonomous-dev.json`,
        };
    }
    // Check if file is readable
    try {
        accessSync(resolvedPath, constants.R_OK);
    }
    catch {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.CONFIG_FILE_NOT_FOUND, `Configuration file is not readable: ${configPath}`, {
                field: 'config',
                value: configPath,
                recoveryActions: [
                    {
                        description: 'Check file permissions - the file must be readable',
                        automatic: false,
                    },
                    {
                        description: `Run: chmod +r "${configPath}" to make it readable`,
                        automatic: false,
                    },
                ],
                context: {
                    providedPath: configPath,
                    resolvedPath,
                },
            }),
            suggestion: 'Check that the file has read permissions',
        };
    }
    // Check if file has .json extension (warning only)
    if (!resolvedPath.endsWith('.json')) {
        return {
            valid: true, // Still valid, but warn
            suggestion: 'Config file should have a .json extension',
        };
    }
    return { valid: true };
}
/**
 * Validate a numeric parameter within a range
 * @param value - The value to validate (string from CLI or number)
 * @param paramName - Name of the parameter for error messages
 * @param range - The allowed range
 * @returns ValidationResult with parsed number or error
 */
export function validateNumericParam(value, paramName, range) {
    if (value === undefined) {
        return { valid: true, parsedValue: range.default };
    }
    const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
    // Check if it's a valid number
    if (isNaN(numValue)) {
        return {
            valid: false,
            parsedValue: undefined,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_TYPE, `Invalid value for ${paramName}: "${value}" is not a valid number`, {
                field: paramName,
                value,
                expectedType: 'number',
                constraints: [`Must be a number between ${range.min} and ${range.max}`],
                recoveryActions: [
                    {
                        description: `Provide a valid number between ${range.min} and ${range.max}`,
                        automatic: false,
                    },
                    {
                        description: `Example: --${paramName.replace(/([A-Z])/g, '-$1').toLowerCase()} ${range.default}`,
                        automatic: false,
                    },
                ],
            }),
            suggestion: `Provide a valid number between ${range.min} and ${range.max} (default: ${range.default})`,
        };
    }
    // Check if it's within range
    if (numValue < range.min || numValue > range.max) {
        return {
            valid: false,
            parsedValue: undefined,
            error: new ValidationError(ErrorCode.VALIDATION_OUT_OF_RANGE, `${paramName} must be between ${range.min} and ${range.max}, got ${numValue}`, {
                field: paramName,
                value: numValue,
                constraints: [`Minimum: ${range.min}`, `Maximum: ${range.max}`],
                recoveryActions: [
                    {
                        description: `Use a value between ${range.min} and ${range.max}`,
                        automatic: false,
                    },
                    {
                        description: `Recommended default: ${range.default}`,
                        automatic: false,
                    },
                ],
            }),
            suggestion: `Value must be between ${range.min} and ${range.max}. Using default: ${range.default}`,
        };
    }
    return { valid: true, parsedValue: numValue };
}
/**
 * Validate repository information format (owner/name) using Zod schemas
 * @param owner - Repository owner
 * @param name - Repository name
 * @returns ValidationResult with error details if invalid
 */
export function validateRepoInfo(owner, name) {
    const errors = [];
    const suggestions = [];
    // Validate owner using Zod schema
    if (!owner) {
        errors.push('Repository owner is required');
        suggestions.push('Set repo.owner in your config file or REPO_OWNER environment variable');
    }
    else {
        const ownerResult = GitHubOwnerSchema.safeParse(owner);
        if (!ownerResult.success) {
            const zodError = ownerResult.error.errors[0];
            errors.push(`Invalid repository owner: ${zodError.message}`);
            suggestions.push('Owner must be alphanumeric with hyphens, cannot start/end with hyphen (max 39 chars)');
        }
    }
    // Validate name using Zod schema
    if (!name) {
        errors.push('Repository name is required');
        suggestions.push('Set repo.name in your config file or REPO_NAME environment variable');
    }
    else {
        const nameResult = GitHubRepoNameSchema.safeParse(name);
        if (!nameResult.success) {
            const zodError = nameResult.error.errors[0];
            errors.push(`Invalid repository name: ${zodError.message}`);
            suggestions.push('Name must be alphanumeric with dots, underscores, and hyphens (max 100 chars)');
        }
    }
    if (errors.length > 0) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_REQUIRED_FIELD, errors.join('; '), {
                field: 'repo',
                constraints: [
                    'Owner: alphanumeric and hyphens, cannot start/end with hyphen (1-39 chars)',
                    'Name: alphanumeric, dots, underscores, and hyphens (1-100 chars)',
                ],
                recoveryActions: suggestions.map(s => ({ description: s, automatic: false })),
                context: {
                    providedOwner: owner,
                    providedName: name,
                },
            }),
            suggestion: suggestions.join('\n'),
        };
    }
    return { valid: true };
}
/**
 * Validate GitHub token format
 * @param token - The GitHub token
 * @returns ValidationResult with error details if invalid
 */
export function validateGitHubToken(token) {
    if (!token) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_REQUIRED_FIELD, 'GitHub token is required but not configured', {
                field: 'credentials.githubToken',
                recoveryActions: [
                    {
                        description: 'Set the GITHUB_TOKEN environment variable',
                        automatic: false,
                    },
                    {
                        description: 'Create a personal access token at https://github.com/settings/tokens',
                        automatic: false,
                    },
                    {
                        description: 'Required token scopes: repo, workflow',
                        automatic: false,
                    },
                ],
            }),
            suggestion: formatCredentialSetupInstructions('GITHUB_TOKEN', 'GitHub personal access token'),
        };
    }
    // Basic format validation for common token patterns
    const validPatterns = [
        /^ghp_[a-zA-Z0-9]{36}$/, // Classic personal access token
        /^github_pat_[a-zA-Z0-9_]{22,}$/, // Fine-grained personal access token
        /^gho_[a-zA-Z0-9]{36}$/, // OAuth access token
        /^ghs_[a-zA-Z0-9]{36}$/, // GitHub App server-to-server token
        /^ghr_[a-zA-Z0-9]{36}$/, // GitHub App refresh token
    ];
    const isValidFormat = validPatterns.some(pattern => pattern.test(token));
    if (!isValidFormat && token.length < 20) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, 'GitHub token appears to be invalid or malformed', {
                field: 'credentials.githubToken',
                recoveryActions: [
                    {
                        description: 'Verify the token was copied completely',
                        automatic: false,
                    },
                    {
                        description: 'Generate a new token at https://github.com/settings/tokens',
                        automatic: false,
                    },
                    {
                        description: 'Ensure the token has not expired',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Token format looks incorrect. Please verify it was copied completely.',
        };
    }
    return { valid: true };
}
/**
 * Validate Claude authentication
 * @param claudeAuth - Claude auth object
 * @returns ValidationResult with error details if invalid
 */
export function validateClaudeAuth(claudeAuth) {
    if (!claudeAuth || !claudeAuth.accessToken) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_REQUIRED_FIELD, 'Claude authentication is required but not configured', {
                field: 'credentials.claudeAuth',
                recoveryActions: [
                    {
                        description: 'Set the CLAUDE_ACCESS_TOKEN environment variable',
                        automatic: false,
                    },
                    {
                        description: 'Optionally set CLAUDE_REFRESH_TOKEN for automatic token refresh',
                        automatic: false,
                    },
                    {
                        description: 'Obtain credentials from https://console.anthropic.com/',
                        automatic: false,
                    },
                ],
            }),
            suggestion: formatCredentialSetupInstructions('CLAUDE_ACCESS_TOKEN', 'Claude API access token'),
        };
    }
    return { valid: true };
}
/**
 * Validate port number
 * @param port - Port number (string or number)
 * @returns ValidationResult with parsed port
 */
export function validatePort(port) {
    return validateNumericParam(port, 'port', NUMERIC_RANGES.port);
}
/**
 * Validate host/hostname format
 * @param host - The hostname
 * @returns ValidationResult
 */
export function validateHost(host) {
    if (!host) {
        return { valid: true }; // Will use default
    }
    // Simple validation - hostname or IP
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const localhostRegex = /^localhost$/i;
    if (!hostnameRegex.test(host) && !ipv4Regex.test(host) && !localhostRegex.test(host)) {
        return {
            valid: false,
            error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Invalid host format: "${host}"`, {
                field: 'host',
                value: host,
                recoveryActions: [
                    {
                        description: 'Use a valid hostname (e.g., localhost, myserver.com)',
                        automatic: false,
                    },
                    {
                        description: 'Or use a valid IP address (e.g., 127.0.0.1)',
                        automatic: false,
                    },
                ],
            }),
            suggestion: 'Use a valid hostname (e.g., localhost) or IP address (e.g., 127.0.0.1)',
        };
    }
    return { valid: true };
}
/**
 * Format credential setup instructions for display
 * @param envVar - Environment variable name
 * @param description - Human-readable description
 * @returns Formatted instruction string
 */
export function formatCredentialSetupInstructions(envVar, description) {
    return [
        `\n${chalk.bold.yellow('Credential Setup Required')}`,
        ``,
        `${description} is not configured.`,
        ``,
        `${chalk.bold('To fix this, set the environment variable:')}`,
        ``,
        `  ${chalk.cyan(`export ${envVar}="your-token-here"`)}`,
        ``,
        `${chalk.bold('Or add it to your .env file:')}`,
        ``,
        `  ${chalk.gray(`${envVar}=your-token-here`)}`,
        ``,
        `For more help, run: ${chalk.cyan('autonomous-dev help-config')}`,
    ].join('\n');
}
/**
 * Display a validation error with formatting
 * @param result - The validation result to display
 */
export function displayValidationError(result) {
    if (result.valid || !result.error)
        return;
    console.error();
    console.error(chalk.red.bold('Validation Error:'));
    console.error(chalk.red(`  ${result.error.message}`));
    console.error();
    if (result.error.recoveryActions && result.error.recoveryActions.length > 0) {
        console.error(chalk.yellow.bold('How to fix:'));
        for (const action of result.error.recoveryActions) {
            const prefix = action.automatic ? chalk.cyan('(auto)') : chalk.magenta('(manual)');
            console.error(`  ${prefix} ${action.description}`);
        }
        console.error();
    }
    if (result.suggestion) {
        console.error(chalk.gray(result.suggestion));
        console.error();
    }
}
/**
 * Validate all common CLI options at once
 * @param options - CLI options object
 * @returns Object with validation results for each option
 */
export function validateCLIOptions(options) {
    const results = [];
    // Validate config path
    if (options.config) {
        const configResult = validateConfigPath(options.config);
        if (!configResult.valid) {
            results.push(configResult);
        }
    }
    // Validate count (if provided)
    if (options.count) {
        const countResult = validateNumericParam(options.count, 'count', NUMERIC_RANGES.taskCount);
        if (!countResult.valid) {
            results.push(countResult);
        }
    }
    // Validate port (if provided)
    if (options.port) {
        const portResult = validatePort(options.port);
        if (!portResult.valid) {
            results.push(portResult);
        }
    }
    // Validate host (if provided)
    if (options.host) {
        const hostResult = validateHost(options.host);
        if (!hostResult.valid) {
            results.push(hostResult);
        }
    }
    return {
        isValid: results.filter(r => !r.valid).length === 0,
        errors: results.filter(r => !r.valid),
    };
}
/**
 * Create a user-friendly error message for missing credentials
 * @param credentialType - Type of credential (github, claude, database)
 * @returns Formatted error message string
 */
export function createMissingCredentialMessage(credentialType) {
    const configs = {
        github: {
            envVar: 'GITHUB_TOKEN',
            description: 'GitHub personal access token',
            url: 'https://github.com/settings/tokens',
            scopes: 'repo, workflow',
        },
        claude: {
            envVar: 'CLAUDE_ACCESS_TOKEN',
            description: 'Claude API access token',
            url: 'https://console.anthropic.com/',
        },
        database: {
            envVar: 'DATABASE_URL',
            description: 'Database connection URL',
            url: 'postgresql://user:password@host:5432/database',
        },
    };
    const config = configs[credentialType];
    if (!config)
        return 'Unknown credential type';
    const lines = [
        '',
        chalk.red.bold(`❌ ${config.description} not configured`),
        '',
        chalk.bold('Setup instructions:'),
        '',
        `  1. ${credentialType === 'database' ? 'Get your database connection string' : `Create a token at ${chalk.cyan(config.url)}`}`,
    ];
    if (config.scopes) {
        lines.push(`     Required scopes: ${chalk.yellow(config.scopes)}`);
    }
    lines.push('', `  2. Set the environment variable:`, '', `     ${chalk.cyan(`export ${config.envVar}="your-token-here"`)}`, '', `     Or add to your ${chalk.cyan('.env')} file:`, '', `     ${chalk.gray(`${config.envVar}=your-token-here`)}`, '');
    return lines.join('\n');
}
/**
 * Known environment variables used by the CLI with their validation rules
 */
const ENV_VAR_VALIDATORS = {
    GITHUB_TOKEN: {
        validate: (value) => validateGitHubToken(value),
        description: 'GitHub personal access token',
    },
    CLAUDE_ACCESS_TOKEN: {
        validate: (value) => {
            if (!value || value.length < 10) {
                return {
                    valid: false,
                    error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, 'CLAUDE_ACCESS_TOKEN appears to be too short or invalid', {
                        field: 'CLAUDE_ACCESS_TOKEN',
                        recoveryActions: [
                            { description: 'Verify the token was copied completely', automatic: false },
                        ],
                    }),
                };
            }
            return { valid: true };
        },
        description: 'Claude API access token',
    },
    DATABASE_URL: {
        validate: (value) => {
            // Basic URL format check for PostgreSQL connection string
            const pgRegex = /^postgres(ql)?:\/\/.+/i;
            if (!pgRegex.test(value)) {
                return {
                    valid: false,
                    error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, 'DATABASE_URL must be a valid PostgreSQL connection string', {
                        field: 'DATABASE_URL',
                        constraints: ['Format: postgresql://user:password@host:port/database'],
                        recoveryActions: [
                            { description: 'Use format: postgresql://user:password@host:5432/database', automatic: false },
                        ],
                    }),
                };
            }
            return { valid: true };
        },
        description: 'PostgreSQL database connection URL',
    },
    USER_EMAIL: {
        validate: (value) => validateEmail(value),
        description: 'User email for credential lookup',
    },
    REPO_OWNER: {
        validate: (value) => {
            const result = GitHubOwnerSchema.safeParse(value);
            if (!result.success) {
                return {
                    valid: false,
                    error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Invalid REPO_OWNER: ${result.error.errors[0].message}`, { field: 'REPO_OWNER', value }),
                };
            }
            return { valid: true };
        },
        description: 'GitHub repository owner',
    },
    REPO_NAME: {
        validate: (value) => {
            const result = GitHubRepoNameSchema.safeParse(value);
            if (!result.success) {
                return {
                    valid: false,
                    error: new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, `Invalid REPO_NAME: ${result.error.errors[0].message}`, { field: 'REPO_NAME', value }),
                };
            }
            return { valid: true };
        },
        description: 'GitHub repository name',
    },
    PARALLEL_WORKERS: {
        validate: (value) => validateNumericParam(value, 'PARALLEL_WORKERS', NUMERIC_RANGES.workerCount),
        description: 'Number of parallel workers',
    },
    TIMEOUT_MINUTES: {
        validate: (value) => validateNumericParam(value, 'TIMEOUT_MINUTES', NUMERIC_RANGES.timeoutMinutes),
        description: 'Task execution timeout in minutes',
    },
    TASKS_PER_CYCLE: {
        validate: (value) => validateNumericParam(value, 'TASKS_PER_CYCLE', NUMERIC_RANGES.taskCount),
        description: 'Number of tasks to discover per cycle',
    },
    MAX_OPEN_ISSUES: {
        validate: (value) => validateNumericParam(value, 'MAX_OPEN_ISSUES', NUMERIC_RANGES.maxOpenIssues),
        description: 'Maximum number of open issues',
    },
    LOOP_INTERVAL_MS: {
        validate: (value) => validateNumericParam(value, 'LOOP_INTERVAL_MS', NUMERIC_RANGES.loopIntervalMs),
        description: 'Daemon loop interval in milliseconds',
    },
    WORK_DIR: {
        validate: (value) => validateWorkDir(value),
        description: 'Working directory for task execution',
    },
};
/**
 * Validate environment variables used by the CLI
 * @param envVars - Object with environment variable names and values (defaults to process.env)
 * @returns Object with validation results
 */
export function validateEnvironmentVariables(envVars = process.env) {
    const errors = [];
    const warnings = [];
    for (const [envVar, config] of Object.entries(ENV_VAR_VALIDATORS)) {
        const value = envVars[envVar];
        // Skip if not set (unless required)
        if (value === undefined || value === '') {
            if (config.required) {
                errors.push({
                    envVar,
                    error: new ValidationError(ErrorCode.VALIDATION_REQUIRED_FIELD, `Required environment variable ${envVar} is not set`, {
                        field: envVar,
                        recoveryActions: [
                            { description: `Set the ${envVar} environment variable`, automatic: false },
                        ],
                    }),
                });
            }
            continue;
        }
        // Validate the value
        const result = config.validate(value);
        if (!result.valid && result.error) {
            errors.push({ envVar, error: result.error });
        }
    }
    // Check for potentially dangerous environment variable patterns
    for (const [key, value] of Object.entries(envVars)) {
        if (value === undefined)
            continue;
        // Warn about potentially sensitive data in non-credential env vars
        if (!key.includes('TOKEN') && !key.includes('SECRET') && !key.includes('PASSWORD')) {
            const credentialPatterns = [
                /^sk-ant-/i, // Anthropic API keys
                /^ghp_/i, // GitHub personal access tokens
                /^gho_/i, // GitHub OAuth tokens
                /^github_pat_/i, // GitHub PATs
            ];
            if (credentialPatterns.some(pattern => pattern.test(value))) {
                warnings.push({
                    envVar: key,
                    message: `${key} appears to contain a credential. Consider using a more descriptive variable name.`,
                });
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
/**
 * Display environment variable validation errors
 * @param result - Validation result from validateEnvironmentVariables
 */
export function displayEnvValidationErrors(result) {
    if (result.errors.length > 0) {
        console.error(chalk.red.bold('\nEnvironment Variable Validation Errors:'));
        for (const { envVar, error } of result.errors) {
            console.error(chalk.red(`  ${envVar}: ${error.message}`));
            if (error.recoveryActions.length > 0) {
                for (const action of error.recoveryActions) {
                    console.error(chalk.gray(`    → ${action.description}`));
                }
            }
        }
        console.error();
    }
    if (result.warnings.length > 0) {
        console.error(chalk.yellow.bold('\nEnvironment Variable Warnings:'));
        for (const { envVar, message } of result.warnings) {
            console.error(chalk.yellow(`  ${envVar}: ${message}`));
        }
        console.error();
    }
}
//# sourceMappingURL=validation.js.map