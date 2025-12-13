import { readFileSync, readdirSync, statSync, existsSync, accessSync, constants } from 'fs';
import { join, relative, extname, isAbsolute, resolve } from 'path';
import { logger } from '../utils/logger.js';
import { AnalyzerError, ErrorCode } from '../utils/errors.js';
// Analyzer configuration bounds
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 20;
const DEFAULT_MAX_DEPTH = 10;
const MIN_MAX_FILES = 100;
const MAX_MAX_FILES = 50000;
const DEFAULT_MAX_FILES = 10000;
// Patterns known to cause ReDoS vulnerabilities
const REDOS_PATTERNS = [
    /\(\.\*\)\+/, // (.*)+
    /\(\.\+\)\+/, // (.+)+
    /\(\[^\\s\]\*\)\+/, // ([^\s]*)+
    /\(\.\*\)\{\d+,\}/, // (.*){\d+,}
    /\(\[^\\]\]\*\)\+/, // ([^]]*)+
    /\(\.\*\?\)\+/, // (.*?)+
];
// Maximum length for glob patterns to prevent excessive processing
const MAX_PATTERN_LENGTH = 500;
const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.next',
    '.cache',
    '.turbo',
    '__pycache__',
]);
const IGNORED_FILES = new Set([
    '.DS_Store',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
]);
const CODE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.vue',
    '.svelte',
    '.py',
    '.go',
    '.rs',
    '.java',
    '.kt',
    '.swift',
    '.rb',
    '.php',
    '.cs',
    '.cpp',
    '.c',
    '.h',
]);
const CONFIG_EXTENSIONS = new Set([
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    '.ini',
    '.env',
]);
export class CodebaseAnalyzer {
    repoPath;
    excludePaths;
    maxDepth;
    maxFiles;
    fileCount = 0;
    validationErrors = [];
    constructor(repoPath, excludePaths = [], config = {}) {
        // Normalize and resolve the path
        this.repoPath = isAbsolute(repoPath) ? repoPath : resolve(repoPath);
        this.excludePaths = excludePaths;
        // Apply bounds to configuration
        this.maxDepth = this.clampValue(config.maxDepth ?? DEFAULT_MAX_DEPTH, MIN_MAX_DEPTH, MAX_MAX_DEPTH);
        this.maxFiles = this.clampValue(config.maxFiles ?? DEFAULT_MAX_FILES, MIN_MAX_FILES, MAX_MAX_FILES);
    }
    /**
     * Clamp a value between min and max bounds
     */
    clampValue(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
    /**
     * Validate that a directory path exists and is readable
     */
    validateDirectoryPath(dirPath) {
        // Check if path exists
        if (!existsSync(dirPath)) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_FOUND, `Directory path does not exist: ${dirPath}`, { path: dirPath }),
            };
        }
        // Check if path is a directory
        try {
            const stat = statSync(dirPath);
            if (!stat.isDirectory()) {
                return {
                    valid: false,
                    error: new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_DIRECTORY, `Path is not a directory: ${dirPath}`, { path: dirPath }),
                };
            }
        }
        catch (err) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_READABLE, `Cannot access path: ${dirPath}`, { path: dirPath, cause: err }),
            };
        }
        // Check if path is readable
        try {
            accessSync(dirPath, constants.R_OK);
        }
        catch (err) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_PATH_NOT_READABLE, `Directory is not readable: ${dirPath}`, { path: dirPath, cause: err }),
            };
        }
        return { valid: true };
    }
    /**
     * Validate and sanitize a glob pattern to prevent ReDoS attacks
     */
    validateGlobPattern(pattern) {
        // Check pattern length
        if (pattern.length > MAX_PATTERN_LENGTH) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_GLOB_PATTERN, `Glob pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`, { pattern: pattern.substring(0, 50) + '...' }),
            };
        }
        // Check for potentially dangerous patterns
        for (const redosPattern of REDOS_PATTERNS) {
            if (redosPattern.test(pattern)) {
                return {
                    valid: false,
                    error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_GLOB_PATTERN, `Glob pattern contains potentially dangerous regex sequence that could cause ReDoS`, { pattern }),
                };
            }
        }
        // Check for excessive wildcards (more than 10 ** or * sequences)
        const wildcardCount = (pattern.match(/\*+/g) || []).length;
        if (wildcardCount > 10) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_GLOB_PATTERN, `Glob pattern contains too many wildcards (${wildcardCount}), maximum is 10`, { pattern }),
            };
        }
        return { valid: true };
    }
    /**
     * Validate that a pattern compiles as valid regex
     */
    validateRegexPattern(pattern) {
        // Check pattern length
        if (pattern.length > MAX_PATTERN_LENGTH) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_REGEX_PATTERN, `Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters`, { pattern: pattern.substring(0, 50) + '...' }),
            };
        }
        // Check for ReDoS patterns before attempting to compile
        for (const redosPattern of REDOS_PATTERNS) {
            if (redosPattern.test(pattern)) {
                return {
                    valid: false,
                    error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_REGEX_PATTERN, `Regex pattern contains potentially dangerous sequence that could cause ReDoS`, { pattern }),
                };
            }
        }
        // Try to compile the pattern
        try {
            new RegExp(pattern);
        }
        catch (err) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_REGEX_PATTERN, `Invalid regex pattern: ${err.message}`, { pattern, cause: err }),
            };
        }
        return { valid: true };
    }
    /**
     * Validate analyzer configuration
     */
    validateConfig() {
        const errors = [];
        if (this.maxDepth < MIN_MAX_DEPTH || this.maxDepth > MAX_MAX_DEPTH) {
            errors.push(`maxDepth must be between ${MIN_MAX_DEPTH} and ${MAX_MAX_DEPTH}, got ${this.maxDepth}`);
        }
        if (this.maxFiles < MIN_MAX_FILES || this.maxFiles > MAX_MAX_FILES) {
            errors.push(`maxFiles must be between ${MIN_MAX_FILES} and ${MAX_MAX_FILES}, got ${this.maxFiles}`);
        }
        // Validate exclude paths
        for (const pattern of this.excludePaths) {
            const result = this.validateGlobPattern(pattern);
            if (!result.valid) {
                errors.push(`Invalid exclude pattern "${pattern}": ${result.error?.message}`);
            }
        }
        if (errors.length > 0) {
            return {
                valid: false,
                error: new AnalyzerError(ErrorCode.ANALYZER_INVALID_CONFIG, `Invalid analyzer configuration: ${errors.join('; ')}`, { context: { errors } }),
            };
        }
        return { valid: true };
    }
    /**
     * Perform all validations before analysis
     */
    validateBeforeAnalysis() {
        // Validate configuration
        const configResult = this.validateConfig();
        if (!configResult.valid) {
            return configResult;
        }
        // Validate repository path
        const pathResult = this.validateDirectoryPath(this.repoPath);
        if (!pathResult.valid) {
            return pathResult;
        }
        return { valid: true };
    }
    async analyze() {
        logger.info('Analyzing codebase...', { path: this.repoPath });
        // Validate inputs before processing
        const validationResult = this.validateBeforeAnalysis();
        if (!validationResult.valid && validationResult.error) {
            logger.structuredError(validationResult.error);
            throw validationResult.error;
        }
        // Reset file count for this analysis
        this.fileCount = 0;
        this.validationErrors = [];
        const structure = this.scanDirectory(this.repoPath);
        // Check if we hit the file limit
        if (this.fileCount >= this.maxFiles) {
            logger.warn(`File limit reached (${this.maxFiles}). Some files may not be included in analysis.`);
        }
        const todoComments = await this.findTodoComments();
        const packages = await this.findPackages();
        const configFiles = this.findConfigFiles();
        const fileCount = this.countFiles(structure);
        logger.info(`Found ${fileCount} files, ${todoComments.length} TODOs, ${packages.length} packages`);
        // Log any validation warnings collected during analysis
        if (this.validationErrors.length > 0) {
            logger.warn(`Encountered ${this.validationErrors.length} validation issues during analysis`);
        }
        return {
            structure,
            fileCount,
            todoComments,
            recentChanges: [], // Could integrate with git log
            packages,
            configFiles,
        };
    }
    /**
     * Check if a path should be excluded based on exclude patterns
     */
    shouldExclude(relativePath) {
        for (const pattern of this.excludePaths) {
            try {
                // First try as a simple prefix match
                if (relativePath.startsWith(pattern)) {
                    return true;
                }
                // Then try as a regex pattern (with safety check already done in validateConfig)
                if (relativePath.match(pattern)) {
                    return true;
                }
            }
            catch {
                // If the pattern fails to match, skip it and log a warning
                logger.debug(`Skipping invalid exclude pattern: ${pattern}`);
            }
        }
        return false;
    }
    scanDirectory(dirPath, depth = 0) {
        // Enforce depth limit
        if (depth > this.maxDepth) {
            return [];
        }
        // Check file count limit
        if (this.fileCount >= this.maxFiles) {
            return [];
        }
        const entries = [];
        try {
            const items = readdirSync(dirPath);
            for (const item of items) {
                // Check file count limit on each iteration
                if (this.fileCount >= this.maxFiles) {
                    break;
                }
                if (IGNORED_DIRS.has(item) || IGNORED_FILES.has(item)) {
                    continue;
                }
                const fullPath = join(dirPath, item);
                const relativePath = relative(this.repoPath, fullPath);
                // Check exclude paths using safe matching
                if (this.shouldExclude(relativePath)) {
                    continue;
                }
                try {
                    const stat = statSync(fullPath);
                    if (stat.isDirectory()) {
                        entries.push({
                            name: item,
                            path: relativePath,
                            type: 'directory',
                            children: this.scanDirectory(fullPath, depth + 1),
                        });
                    }
                    else if (stat.isFile()) {
                        this.fileCount++;
                        entries.push({
                            name: item,
                            path: relativePath,
                            type: 'file',
                        });
                    }
                }
                catch {
                    // Skip files we can't access
                }
            }
        }
        catch (error) {
            logger.warn(`Failed to scan directory: ${dirPath}`, { error });
        }
        return entries;
    }
    countFiles(entries) {
        let count = 0;
        for (const entry of entries) {
            if (entry.type === 'file') {
                count++;
            }
            else if (entry.children) {
                count += this.countFiles(entry.children);
            }
        }
        return count;
    }
    async findTodoComments() {
        const todos = [];
        const todoPattern = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/gi;
        let scannedFiles = 0;
        const scanFile = (filePath) => {
            // Enforce a reasonable limit on scanned files for TODO comments
            if (scannedFiles >= this.maxFiles) {
                return;
            }
            const ext = extname(filePath);
            if (!CODE_EXTENSIONS.has(ext)) {
                return;
            }
            try {
                const content = readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                scannedFiles++;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const matches = line.matchAll(todoPattern);
                    for (const match of matches) {
                        todos.push({
                            file: relative(this.repoPath, filePath),
                            line: i + 1,
                            text: match[2]?.trim() || '',
                            type: match[1].toUpperCase(),
                        });
                    }
                }
            }
            catch {
                // Skip files we can't read
            }
        };
        const scanDir = (dirPath, depth = 0) => {
            // Enforce depth limit
            if (depth > this.maxDepth) {
                return;
            }
            if (scannedFiles >= this.maxFiles) {
                return;
            }
            try {
                const items = readdirSync(dirPath);
                for (const item of items) {
                    if (scannedFiles >= this.maxFiles) {
                        break;
                    }
                    if (IGNORED_DIRS.has(item)) {
                        continue;
                    }
                    const fullPath = join(dirPath, item);
                    const relativePath = relative(this.repoPath, fullPath);
                    // Check exclude paths
                    if (this.shouldExclude(relativePath)) {
                        continue;
                    }
                    try {
                        const stat = statSync(fullPath);
                        if (stat.isDirectory()) {
                            scanDir(fullPath, depth + 1);
                        }
                        else if (stat.isFile()) {
                            scanFile(fullPath);
                        }
                    }
                    catch {
                        // Skip inaccessible files
                    }
                }
            }
            catch {
                // Skip inaccessible directories
            }
        };
        scanDir(this.repoPath);
        return todos;
    }
    async findPackages() {
        const packages = [];
        let scannedDirs = 0;
        const maxDirsToScan = Math.min(this.maxFiles, 1000); // Limit package.json searching
        const findPackageJson = (dirPath, depth = 0) => {
            // Enforce depth limit
            if (depth > this.maxDepth) {
                return;
            }
            if (scannedDirs >= maxDirsToScan) {
                return;
            }
            const packageJsonPath = join(dirPath, 'package.json');
            if (existsSync(packageJsonPath)) {
                try {
                    const content = readFileSync(packageJsonPath, 'utf-8');
                    const pkg = JSON.parse(content);
                    packages.push({
                        name: pkg.name || relative(this.repoPath, dirPath),
                        path: relative(this.repoPath, dirPath) || '.',
                        dependencies: Object.keys(pkg.dependencies || {}),
                        scripts: pkg.scripts || {},
                    });
                }
                catch {
                    // Skip invalid package.json
                }
            }
            scannedDirs++;
            // Check subdirectories
            try {
                const items = readdirSync(dirPath);
                for (const item of items) {
                    if (scannedDirs >= maxDirsToScan) {
                        break;
                    }
                    if (IGNORED_DIRS.has(item)) {
                        continue;
                    }
                    const fullPath = join(dirPath, item);
                    const relativePath = relative(this.repoPath, fullPath);
                    // Check exclude paths
                    if (this.shouldExclude(relativePath)) {
                        continue;
                    }
                    try {
                        const stat = statSync(fullPath);
                        if (stat.isDirectory()) {
                            findPackageJson(fullPath, depth + 1);
                        }
                    }
                    catch {
                        // Skip inaccessible
                    }
                }
            }
            catch {
                // Skip inaccessible directories
            }
        };
        findPackageJson(this.repoPath);
        return packages;
    }
    findConfigFiles() {
        const configFiles = [];
        const configPatterns = [
            /^\..*rc$/,
            /^\..*rc\.js$/,
            /^\..*rc\.json$/,
            /\.config\.(js|ts|json|mjs|cjs)$/,
            /^tsconfig.*\.json$/,
            /^package\.json$/,
            /^docker-compose.*\.ya?ml$/,
            /^Dockerfile$/,
            /^\.github/,
        ];
        // Only scan top-level config files (depth 2)
        const maxConfigDepth = Math.min(2, this.maxDepth);
        const scanDir = (dirPath, depth = 0) => {
            if (depth > maxConfigDepth)
                return;
            try {
                const items = readdirSync(dirPath);
                for (const item of items) {
                    if (IGNORED_DIRS.has(item)) {
                        continue;
                    }
                    const fullPath = join(dirPath, item);
                    const relativePath = relative(this.repoPath, fullPath);
                    try {
                        const stat = statSync(fullPath);
                        if (stat.isFile()) {
                            const isConfig = configPatterns.some((pattern) => pattern.test(item));
                            if (isConfig) {
                                configFiles.push(relativePath);
                            }
                        }
                        else if (stat.isDirectory() && item === '.github') {
                            // Include .github directory
                            configFiles.push(relativePath);
                        }
                    }
                    catch {
                        // Skip inaccessible
                    }
                }
            }
            catch {
                // Skip inaccessible directories
            }
        };
        scanDir(this.repoPath);
        return configFiles;
    }
    // Generate a summary suitable for Claude
    generateSummary(analysis) {
        const lines = [];
        lines.push('## Codebase Structure\n');
        // Package overview
        if (analysis.packages.length > 0) {
            lines.push('### Packages\n');
            for (const pkg of analysis.packages) {
                lines.push(`- **${pkg.name}** (${pkg.path})`);
                if (Object.keys(pkg.scripts).length > 0) {
                    const scriptNames = Object.keys(pkg.scripts).slice(0, 5).join(', ');
                    lines.push(`  - Scripts: ${scriptNames}${Object.keys(pkg.scripts).length > 5 ? '...' : ''}`);
                }
            }
            lines.push('');
        }
        // Directory structure (top-level only)
        lines.push('### Top-Level Structure\n');
        for (const entry of analysis.structure) {
            const icon = entry.type === 'directory' ? '📁' : '📄';
            lines.push(`- ${icon} ${entry.name}`);
        }
        lines.push('');
        // Config files
        if (analysis.configFiles.length > 0) {
            lines.push('### Configuration Files\n');
            for (const file of analysis.configFiles.slice(0, 10)) {
                lines.push(`- ${file}`);
            }
            if (analysis.configFiles.length > 10) {
                lines.push(`- ... and ${analysis.configFiles.length - 10} more`);
            }
            lines.push('');
        }
        // TODOs
        if (analysis.todoComments.length > 0) {
            lines.push('### TODO Comments\n');
            const byType = {};
            for (const todo of analysis.todoComments) {
                if (!byType[todo.type]) {
                    byType[todo.type] = [];
                }
                byType[todo.type].push(todo);
            }
            for (const [type, todos] of Object.entries(byType)) {
                lines.push(`\n**${type}** (${todos.length}):`);
                for (const todo of todos.slice(0, 5)) {
                    lines.push(`- ${todo.file}:${todo.line}: ${todo.text}`);
                }
                if (todos.length > 5) {
                    lines.push(`- ... and ${todos.length - 5} more`);
                }
            }
            lines.push('');
        }
        lines.push(`\n**Total Files:** ${analysis.fileCount}`);
        return lines.join('\n');
    }
}
//# sourceMappingURL=analyzer.js.map