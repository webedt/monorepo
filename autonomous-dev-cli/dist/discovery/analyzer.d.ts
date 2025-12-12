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
export declare class CodebaseAnalyzer {
    private repoPath;
    private excludePaths;
    constructor(repoPath: string, excludePaths?: string[]);
    analyze(): Promise<CodebaseAnalysis>;
    private scanDirectory;
    private countFiles;
    private findTodoComments;
    private findPackages;
    private findConfigFiles;
    generateSummary(analysis: CodebaseAnalysis): string;
}
//# sourceMappingURL=analyzer.d.ts.map