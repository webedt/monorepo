import { AnalyzerError } from '../utils/errors.js';
export interface CodebaseAnalysis {
    structure: DirectoryEntry[];
    fileCount: number;
    todoComments: TodoComment[];
    recentChanges: string[];
    packages: PackageInfo[];
    configFiles: string[];
}
export interface DirectoryEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: DirectoryEntry[];
}
export interface TodoComment {
    file: string;
    line: number;
    text: string;
    type: 'TODO' | 'FIXME' | 'HACK' | 'XXX';
}
export interface PackageInfo {
    name: string;
    path: string;
    dependencies: string[];
    scripts: Record<string, string>;
}
/**
 * Configuration options for the analyzer
 */
export interface AnalyzerConfig {
    maxDepth?: number;
    maxFiles?: number;
}
/**
 * Result type for validation operations
 */
export interface ValidationResult {
    valid: boolean;
    error?: AnalyzerError;
}
export declare class CodebaseAnalyzer {
    private repoPath;
    private excludePaths;
    private maxDepth;
    private maxFiles;
    private fileCount;
    private validationErrors;
    constructor(repoPath: string, excludePaths?: string[], config?: AnalyzerConfig);
    /**
     * Clamp a value between min and max bounds
     */
    private clampValue;
    /**
     * Validate that a directory path exists and is readable
     */
    validateDirectoryPath(dirPath: string): ValidationResult;
    /**
     * Validate and sanitize a glob pattern to prevent ReDoS attacks
     */
    validateGlobPattern(pattern: string): ValidationResult;
    /**
     * Validate that a pattern compiles as valid regex
     */
    validateRegexPattern(pattern: string): ValidationResult;
    /**
     * Validate analyzer configuration
     */
    validateConfig(): ValidationResult;
    /**
     * Perform all validations before analysis
     */
    private validateBeforeAnalysis;
    analyze(): Promise<CodebaseAnalysis>;
    /**
     * Check if a path should be excluded based on exclude patterns
     */
    private shouldExclude;
    private scanDirectory;
    private countFiles;
    private findTodoComments;
    private findPackages;
    private findConfigFiles;
    generateSummary(analysis: CodebaseAnalysis): string;
}
//# sourceMappingURL=analyzer.d.ts.map