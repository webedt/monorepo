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
import { ValidationError } from './errors.js';
import { z } from 'zod';
/**
 * Validation result with error details
 */
export interface ValidationResult {
    valid: boolean;
    error?: ValidationError;
    suggestion?: string;
}
/**
 * Numeric range configuration
 */
export interface NumericRange {
    min: number;
    max: number;
    default: number;
}
/**
 * Common numeric ranges for CLI options
 */
export declare const NUMERIC_RANGES: {
    readonly workerCount: {
        readonly min: 1;
        readonly max: 10;
        readonly default: 4;
    };
    readonly taskCount: {
        readonly min: 1;
        readonly max: 10;
        readonly default: 5;
    };
    readonly port: {
        readonly min: 1;
        readonly max: 65535;
        readonly default: 9091;
    };
    readonly timeoutMinutes: {
        readonly min: 5;
        readonly max: 120;
        readonly default: 30;
    };
    readonly maxOpenIssues: {
        readonly min: 1;
        readonly max: 100;
        readonly default: 10;
    };
    readonly loopIntervalMs: {
        readonly min: 0;
        readonly max: 86400000;
        readonly default: 60000;
    };
    readonly maxRetries: {
        readonly min: 1;
        readonly max: 10;
        readonly default: 3;
    };
    readonly maxDepth: {
        readonly min: 1;
        readonly max: 20;
        readonly default: 10;
    };
    readonly maxFiles: {
        readonly min: 100;
        readonly max: 50000;
        readonly default: 10000;
    };
};
/**
 * Zod schema for validating email format
 */
export declare const EmailSchema: z.ZodString;
/**
 * Zod schema for validating GitHub repository owner
 * Must be alphanumeric with hyphens, cannot start/end with hyphen
 */
export declare const GitHubOwnerSchema: z.ZodString;
/**
 * Zod schema for validating GitHub repository name
 * Allows alphanumeric, dots, underscores, and hyphens
 */
export declare const GitHubRepoNameSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Zod schema for validating file paths (no traversal)
 */
export declare const SafePathSchema: z.ZodEffects<z.ZodString, string, string>;
/**
 * Zod schema for environment variable names
 */
export declare const EnvVarNameSchema: z.ZodString;
/**
 * Check if a path contains path traversal attempts
 * @param inputPath - The path to check
 * @returns true if path traversal is detected
 */
export declare function containsPathTraversal(inputPath: string): boolean;
/**
 * Validate and sanitize a path to prevent path traversal attacks
 * @param inputPath - The path to validate
 * @param allowedBase - Optional base directory the path must be within
 * @returns ValidationResult with sanitized path or error
 */
export declare function validatePath(inputPath: string, allowedBase?: string): ValidationResult & {
    sanitizedPath?: string;
};
/**
 * Validate workDir path for security
 * Ensures the path is within allowed directories and doesn't contain traversal attacks
 * @param workDir - The working directory path
 * @returns ValidationResult with sanitized path or error
 */
export declare function validateWorkDir(workDir: string): ValidationResult & {
    sanitizedPath?: string;
};
/**
 * Validate email format before database queries
 * @param email - Email address to validate
 * @returns ValidationResult with error details if invalid
 */
export declare function validateEmail(email: string | undefined): ValidationResult;
/**
 * Validate a config file path
 * @param configPath - Path to the config file
 * @returns ValidationResult with error details if invalid
 */
export declare function validateConfigPath(configPath: string | undefined): ValidationResult;
/**
 * Validate a numeric parameter within a range
 * @param value - The value to validate (string from CLI or number)
 * @param paramName - Name of the parameter for error messages
 * @param range - The allowed range
 * @returns ValidationResult with parsed number or error
 */
export declare function validateNumericParam(value: string | number | undefined, paramName: string, range: NumericRange): ValidationResult & {
    parsedValue?: number;
};
/**
 * Validate repository information format (owner/name) using Zod schemas
 * @param owner - Repository owner
 * @param name - Repository name
 * @returns ValidationResult with error details if invalid
 */
export declare function validateRepoInfo(owner: string | undefined, name: string | undefined): ValidationResult;
/**
 * Validate GitHub token format
 * @param token - The GitHub token
 * @returns ValidationResult with error details if invalid
 */
export declare function validateGitHubToken(token: string | undefined): ValidationResult;
/**
 * Validate Claude authentication
 * @param claudeAuth - Claude auth object
 * @returns ValidationResult with error details if invalid
 */
export declare function validateClaudeAuth(claudeAuth: {
    accessToken: string;
    refreshToken?: string;
} | undefined): ValidationResult;
/**
 * Validate port number
 * @param port - Port number (string or number)
 * @returns ValidationResult with parsed port
 */
export declare function validatePort(port: string | number | undefined): ValidationResult & {
    parsedValue?: number;
};
/**
 * Validate host/hostname format
 * @param host - The hostname
 * @returns ValidationResult
 */
export declare function validateHost(host: string | undefined): ValidationResult;
/**
 * Format credential setup instructions for display
 * @param envVar - Environment variable name
 * @param description - Human-readable description
 * @returns Formatted instruction string
 */
export declare function formatCredentialSetupInstructions(envVar: string, description: string): string;
/**
 * Display a validation error with formatting
 * @param result - The validation result to display
 */
export declare function displayValidationError(result: ValidationResult): void;
/**
 * Validate all common CLI options at once
 * @param options - CLI options object
 * @returns Object with validation results for each option
 */
export declare function validateCLIOptions(options: {
    config?: string;
    count?: string;
    port?: string;
    host?: string;
}): {
    isValid: boolean;
    errors: ValidationResult[];
};
/**
 * Create a user-friendly error message for missing credentials
 * @param credentialType - Type of credential (github, claude, database)
 * @returns Formatted error message string
 */
export declare function createMissingCredentialMessage(credentialType: 'github' | 'claude' | 'database'): string;
/**
 * Validate environment variables used by the CLI
 * @param envVars - Object with environment variable names and values (defaults to process.env)
 * @returns Object with validation results
 */
export declare function validateEnvironmentVariables(envVars?: Record<string, string | undefined>): {
    isValid: boolean;
    errors: {
        envVar: string;
        error: ValidationError;
    }[];
    warnings: {
        envVar: string;
        message: string;
    }[];
};
/**
 * Display environment variable validation errors
 * @param result - Validation result from validateEnvironmentVariables
 */
export declare function displayEnvValidationErrors(result: ReturnType<typeof validateEnvironmentVariables>): void;
//# sourceMappingURL=validation.d.ts.map