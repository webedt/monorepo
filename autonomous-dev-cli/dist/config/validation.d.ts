/**
 * Input validation and sanitization utilities for configuration paths and user inputs.
 *
 * This module provides security-focused validation functions to:
 * - Prevent path traversal attacks
 * - Sanitize user-provided file paths
 * - Validate configuration file formats
 * - Ensure inputs meet expected format requirements
 */
/**
 * Result of a validation operation
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
    sanitizedValue?: string;
}
/**
 * Path validation options
 */
export interface PathValidationOptions {
    /** Allow relative paths (default: true) */
    allowRelative?: boolean;
    /** Require the path to exist (default: false) */
    mustExist?: boolean;
    /** Require the path to be a file (default: false) */
    mustBeFile?: boolean;
    /** Require the path to be a directory (default: false) */
    mustBeDirectory?: boolean;
    /** Base directory for relative path resolution (default: process.cwd()) */
    baseDir?: string;
    /** Allowed file extensions (e.g., ['.json', '.yaml']) */
    allowedExtensions?: string[];
    /** Check read access (default: false) */
    checkReadAccess?: boolean;
    /** Check write access (default: false) */
    checkWriteAccess?: boolean;
}
/**
 * Check if a path contains potential path traversal sequences
 */
export declare function containsPathTraversal(inputPath: string): boolean;
/**
 * Sanitize a file path by removing dangerous characters and normalizing
 */
export declare function sanitizePath(inputPath: string): string;
/**
 * Validate and sanitize a configuration file path
 */
export declare function validateConfigPath(inputPath: string, options?: PathValidationOptions): ValidationResult;
/**
 * Validate and sanitize a work directory path
 */
export declare function validateWorkDirectory(inputPath: string, options?: PathValidationOptions): ValidationResult;
/**
 * Validate a GitHub repository owner name
 */
export declare function validateRepoOwner(owner: string): ValidationResult;
/**
 * Validate a GitHub repository name
 */
export declare function validateRepoName(name: string): ValidationResult;
/**
 * Validate a branch name
 */
export declare function validateBranchName(branch: string): ValidationResult;
/**
 * Validate an issue label
 */
export declare function validateIssueLabel(label: string): ValidationResult;
/**
 * Validate a URL string
 */
export declare function validateUrl(url: string, options?: {
    requireHttps?: boolean;
}): ValidationResult;
/**
 * Validate exclude paths array
 */
export declare function validateExcludePaths(paths: string[]): ValidationResult;
/**
 * Validate and sanitize environment variable name
 */
export declare function validateEnvVarName(name: string): ValidationResult;
/**
 * Sanitize a string for safe inclusion in error messages or logs
 */
export declare function sanitizeForDisplay(input: string, maxLength?: number): string;
//# sourceMappingURL=validation.d.ts.map