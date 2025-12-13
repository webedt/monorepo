/**
 * Input validation and sanitization utilities for configuration paths and user inputs.
 *
 * This module provides security-focused validation functions to:
 * - Prevent path traversal attacks
 * - Sanitize user-provided file paths
 * - Validate configuration file formats
 * - Ensure inputs meet expected format requirements
 */
import { resolve, normalize, isAbsolute, relative, dirname } from 'path';
import { existsSync, statSync, accessSync, constants } from 'fs';
/**
 * Dangerous path patterns that could indicate path traversal attempts
 */
const DANGEROUS_PATH_PATTERNS = [
    /\.\.\//g, // Parent directory traversal
    /\.\.\\/g, // Windows parent directory traversal
    /\/\.\./g, // Trailing parent directory
    /\\\.\./g, // Windows trailing parent directory
    /^\.\.$/, // Just parent directory
    /^~\//, // Home directory expansion (can be manipulated)
    /\0/, // Null bytes (path truncation attack)
    /%2e%2e/i, // URL-encoded parent directory
    /%252e%252e/i, // Double URL-encoded parent directory
    /\.\./, // Any parent directory reference
];
/**
 * Dangerous characters that should not appear in sanitized paths
 */
const DANGEROUS_CHARACTERS = /[<>:"|?*\x00-\x1f]/g;
/**
 * Check if a path contains potential path traversal sequences
 */
export function containsPathTraversal(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        return false;
    }
    // Check for null bytes
    if (inputPath.includes('\0')) {
        return true;
    }
    // Normalize and check if the path attempts to escape the base directory
    const normalized = normalize(inputPath);
    // Check for explicit parent directory references after normalization
    if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes('\\..')) {
        return true;
    }
    // Check against known dangerous patterns
    for (const pattern of DANGEROUS_PATH_PATTERNS) {
        if (pattern.test(inputPath)) {
            return true;
        }
    }
    return false;
}
/**
 * Sanitize a file path by removing dangerous characters and normalizing
 */
export function sanitizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        return '';
    }
    // Remove null bytes first
    let sanitized = inputPath.replace(/\0/g, '');
    // Remove dangerous characters
    sanitized = sanitized.replace(DANGEROUS_CHARACTERS, '');
    // Normalize the path
    sanitized = normalize(sanitized);
    // Remove leading/trailing whitespace
    sanitized = sanitized.trim();
    return sanitized;
}
/**
 * Validate and sanitize a configuration file path
 */
export function validateConfigPath(inputPath, options = {}) {
    const { allowRelative = true, mustExist = false, mustBeFile = true, baseDir = process.cwd(), allowedExtensions = ['.json'], checkReadAccess = false, } = options;
    // Check for empty or invalid input
    if (!inputPath || typeof inputPath !== 'string') {
        return {
            valid: false,
            error: 'Configuration path is required and must be a string',
        };
    }
    // Check for path traversal attempts
    if (containsPathTraversal(inputPath)) {
        return {
            valid: false,
            error: 'Configuration path contains invalid path traversal sequences',
        };
    }
    // Sanitize the path
    const sanitized = sanitizePath(inputPath);
    if (!sanitized) {
        return {
            valid: false,
            error: 'Configuration path is empty after sanitization',
        };
    }
    // Resolve to absolute path
    const absolutePath = isAbsolute(sanitized) ? sanitized : resolve(baseDir, sanitized);
    // Validate that resolved path doesn't escape base directory (for relative paths)
    if (!allowRelative && !isAbsolute(inputPath)) {
        return {
            valid: false,
            error: 'Configuration path must be an absolute path',
        };
    }
    // For relative paths, ensure they don't escape the base directory
    if (!isAbsolute(inputPath)) {
        const relativePath = relative(baseDir, absolutePath);
        if (relativePath.startsWith('..')) {
            return {
                valid: false,
                error: 'Configuration path cannot reference parent directories outside the base directory',
            };
        }
    }
    // Check file extension
    if (allowedExtensions.length > 0) {
        const hasValidExtension = allowedExtensions.some(ext => absolutePath.toLowerCase().endsWith(ext.toLowerCase()));
        if (!hasValidExtension) {
            return {
                valid: false,
                error: `Configuration file must have one of these extensions: ${allowedExtensions.join(', ')}`,
            };
        }
    }
    // Check if path exists (if required)
    if (mustExist) {
        if (!existsSync(absolutePath)) {
            return {
                valid: false,
                error: `Configuration file not found: ${absolutePath}`,
            };
        }
        try {
            const stats = statSync(absolutePath);
            if (mustBeFile && !stats.isFile()) {
                return {
                    valid: false,
                    error: 'Configuration path must be a file, not a directory',
                };
            }
        }
        catch (error) {
            return {
                valid: false,
                error: `Cannot access configuration file: ${error.message}`,
            };
        }
        // Check read access
        if (checkReadAccess) {
            try {
                accessSync(absolutePath, constants.R_OK);
            }
            catch {
                return {
                    valid: false,
                    error: 'Configuration file is not readable',
                };
            }
        }
    }
    return {
        valid: true,
        sanitizedValue: absolutePath,
    };
}
/**
 * Validate and sanitize a work directory path
 */
export function validateWorkDirectory(inputPath, options = {}) {
    const { allowRelative = true, mustExist = false, baseDir = process.cwd(), checkWriteAccess = false, } = options;
    // Check for empty or invalid input
    if (!inputPath || typeof inputPath !== 'string') {
        return {
            valid: false,
            error: 'Work directory path is required and must be a string',
        };
    }
    // Check for path traversal attempts
    if (containsPathTraversal(inputPath)) {
        return {
            valid: false,
            error: 'Work directory path contains invalid path traversal sequences',
        };
    }
    // Sanitize the path
    const sanitized = sanitizePath(inputPath);
    if (!sanitized) {
        return {
            valid: false,
            error: 'Work directory path is empty after sanitization',
        };
    }
    // Resolve to absolute path
    const absolutePath = isAbsolute(sanitized) ? sanitized : resolve(baseDir, sanitized);
    // For relative paths, ensure they don't escape the base directory
    if (!isAbsolute(inputPath) && !allowRelative) {
        const relativePath = relative(baseDir, absolutePath);
        if (relativePath.startsWith('..')) {
            return {
                valid: false,
                error: 'Work directory path cannot reference parent directories outside the base directory',
            };
        }
    }
    // Validate the path doesn't point to sensitive system directories
    const sensitiveDirectories = [
        '/etc',
        '/usr',
        '/bin',
        '/sbin',
        '/boot',
        '/root',
        '/var/log',
        '/proc',
        '/sys',
        '/dev',
        'C:\\Windows',
        'C:\\Program Files',
        'C:\\Program Files (x86)',
    ];
    const normalizedAbsolute = absolutePath.toLowerCase();
    for (const sensitiveDir of sensitiveDirectories) {
        if (normalizedAbsolute.startsWith(sensitiveDir.toLowerCase())) {
            return {
                valid: false,
                error: `Work directory cannot be inside system directory: ${sensitiveDir}`,
            };
        }
    }
    // Check if parent directory exists and is writable (if path doesn't exist yet)
    if (mustExist && !existsSync(absolutePath)) {
        return {
            valid: false,
            error: `Work directory does not exist: ${absolutePath}`,
        };
    }
    // Check write access on existing directory or parent
    if (checkWriteAccess) {
        const dirToCheck = existsSync(absolutePath) ? absolutePath : dirname(absolutePath);
        if (existsSync(dirToCheck)) {
            try {
                accessSync(dirToCheck, constants.W_OK);
            }
            catch {
                return {
                    valid: false,
                    error: 'Work directory is not writable',
                };
            }
        }
    }
    // Verify it's a directory if it exists
    if (existsSync(absolutePath)) {
        try {
            const stats = statSync(absolutePath);
            if (!stats.isDirectory()) {
                return {
                    valid: false,
                    error: 'Work directory path must be a directory, not a file',
                };
            }
        }
        catch (error) {
            return {
                valid: false,
                error: `Cannot access work directory: ${error.message}`,
            };
        }
    }
    return {
        valid: true,
        sanitizedValue: absolutePath,
    };
}
/**
 * Validate a GitHub repository owner name
 */
export function validateRepoOwner(owner) {
    if (!owner || typeof owner !== 'string') {
        return {
            valid: false,
            error: 'Repository owner is required and must be a string',
        };
    }
    const trimmed = owner.trim();
    if (trimmed.length === 0) {
        return {
            valid: false,
            error: 'Repository owner cannot be empty',
        };
    }
    // GitHub username rules:
    // - 1-39 characters
    // - Can contain alphanumeric characters and hyphens
    // - Cannot start or end with a hyphen
    // - Cannot have consecutive hyphens
    const validPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
    if (!validPattern.test(trimmed)) {
        return {
            valid: false,
            error: 'Repository owner must be 1-39 characters, alphanumeric or single hyphens, and cannot start/end with hyphen',
        };
    }
    return {
        valid: true,
        sanitizedValue: trimmed,
    };
}
/**
 * Validate a GitHub repository name
 */
export function validateRepoName(name) {
    if (!name || typeof name !== 'string') {
        return {
            valid: false,
            error: 'Repository name is required and must be a string',
        };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return {
            valid: false,
            error: 'Repository name cannot be empty',
        };
    }
    // GitHub repository name rules:
    // - Cannot exceed 100 characters
    // - Can contain alphanumeric characters, hyphens, underscores, and periods
    // - Cannot start with a period
    // - Cannot end with .git
    // - Cannot be . or ..
    const validPattern = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,99}$/;
    if (!validPattern.test(trimmed)) {
        return {
            valid: false,
            error: 'Repository name must be 1-100 characters, alphanumeric with hyphens/underscores/periods, and cannot start with a period',
        };
    }
    if (trimmed === '.' || trimmed === '..') {
        return {
            valid: false,
            error: 'Repository name cannot be "." or ".."',
        };
    }
    if (trimmed.toLowerCase().endsWith('.git')) {
        return {
            valid: false,
            error: 'Repository name cannot end with ".git"',
        };
    }
    return {
        valid: true,
        sanitizedValue: trimmed,
    };
}
/**
 * Validate a branch name
 */
export function validateBranchName(branch) {
    if (!branch || typeof branch !== 'string') {
        return {
            valid: false,
            error: 'Branch name is required and must be a string',
        };
    }
    const trimmed = branch.trim();
    if (trimmed.length === 0) {
        return {
            valid: false,
            error: 'Branch name cannot be empty',
        };
    }
    // Git branch name restrictions:
    // - Cannot contain: space, ~, ^, :, ?, *, [, \, @{, ..
    // - Cannot start or end with /
    // - Cannot start with -
    // - Cannot end with .lock
    // - Cannot be @
    const invalidPatterns = [
        /\s/, // No whitespace
        /~/, // No tilde
        /\^/, // No caret
        /:/, // No colon
        /\?/, // No question mark
        /\*/, // No asterisk
        /\[/, // No opening bracket
        /\\/, // No backslash
        /@\{/, // No @{
        /\.\./, // No consecutive dots
        /^\//, // Cannot start with /
        /\/$/, // Cannot end with /
        /^-/, // Cannot start with -
        /\.lock$/i, // Cannot end with .lock
    ];
    for (const pattern of invalidPatterns) {
        if (pattern.test(trimmed)) {
            return {
                valid: false,
                error: 'Branch name contains invalid characters or sequences',
            };
        }
    }
    if (trimmed === '@') {
        return {
            valid: false,
            error: 'Branch name cannot be "@"',
        };
    }
    // Maximum length check (Git allows up to 255 bytes, we'll be conservative)
    if (trimmed.length > 200) {
        return {
            valid: false,
            error: 'Branch name cannot exceed 200 characters',
        };
    }
    return {
        valid: true,
        sanitizedValue: trimmed,
    };
}
/**
 * Validate an issue label
 */
export function validateIssueLabel(label) {
    if (!label || typeof label !== 'string') {
        return {
            valid: false,
            error: 'Issue label is required and must be a string',
        };
    }
    const trimmed = label.trim();
    if (trimmed.length === 0) {
        return {
            valid: false,
            error: 'Issue label cannot be empty',
        };
    }
    // GitHub label restrictions:
    // - Maximum 50 characters
    // - Cannot contain null bytes
    // - Leading/trailing whitespace is trimmed
    if (trimmed.length > 50) {
        return {
            valid: false,
            error: 'Issue label cannot exceed 50 characters',
        };
    }
    if (trimmed.includes('\0')) {
        return {
            valid: false,
            error: 'Issue label cannot contain null bytes',
        };
    }
    return {
        valid: true,
        sanitizedValue: trimmed,
    };
}
/**
 * Validate a URL string
 */
export function validateUrl(url, options = {}) {
    if (!url || typeof url !== 'string') {
        return {
            valid: false,
            error: 'URL is required and must be a string',
        };
    }
    const trimmed = url.trim();
    if (trimmed.length === 0) {
        return {
            valid: false,
            error: 'URL cannot be empty',
        };
    }
    try {
        const parsed = new URL(trimmed);
        if (options.requireHttps && parsed.protocol !== 'https:') {
            return {
                valid: false,
                error: 'URL must use HTTPS protocol',
            };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
                valid: false,
                error: 'URL must use HTTP or HTTPS protocol',
            };
        }
        return {
            valid: true,
            sanitizedValue: trimmed,
        };
    }
    catch {
        return {
            valid: false,
            error: 'Invalid URL format',
        };
    }
}
/**
 * Validate exclude paths array
 */
export function validateExcludePaths(paths) {
    if (!Array.isArray(paths)) {
        return {
            valid: false,
            error: 'Exclude paths must be an array',
        };
    }
    const sanitized = [];
    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (typeof path !== 'string') {
            return {
                valid: false,
                error: `Exclude path at index ${i} must be a string`,
            };
        }
        // Check for path traversal in exclude patterns
        // Note: We allow patterns like "../" in exclude paths since they're used for matching
        // But we should prevent obvious security issues
        if (path.includes('\0')) {
            return {
                valid: false,
                error: `Exclude path at index ${i} contains null bytes`,
            };
        }
        const trimmed = path.trim();
        if (trimmed.length > 0) {
            sanitized.push(trimmed);
        }
    }
    return {
        valid: true,
        sanitizedValue: JSON.stringify(sanitized),
    };
}
/**
 * Validate and sanitize environment variable name
 */
export function validateEnvVarName(name) {
    if (!name || typeof name !== 'string') {
        return {
            valid: false,
            error: 'Environment variable name is required and must be a string',
        };
    }
    const trimmed = name.trim();
    // Environment variable name rules:
    // - Must start with a letter or underscore
    // - Can contain letters, numbers, and underscores
    const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    if (!validPattern.test(trimmed)) {
        return {
            valid: false,
            error: 'Environment variable name must start with a letter or underscore and contain only alphanumeric characters and underscores',
        };
    }
    return {
        valid: true,
        sanitizedValue: trimmed,
    };
}
/**
 * Sanitize a string for safe inclusion in error messages or logs
 */
export function sanitizeForDisplay(input, maxLength = 100) {
    if (!input || typeof input !== 'string') {
        return '';
    }
    // Remove null bytes and control characters
    let sanitized = input.replace(/[\x00-\x1f\x7f]/g, '');
    // Truncate if necessary
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength) + '...';
    }
    return sanitized;
}
//# sourceMappingURL=validation.js.map