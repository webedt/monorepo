export interface BuildResult {
    success: boolean;
    output: string;
    duration: number;
    error?: string;
}
export interface BuildOptions {
    repoPath: string;
    packages?: string[];
    timeout?: number;
}
export declare function runBuild(options: BuildOptions): Promise<BuildResult>;
export declare function runTypeCheck(repoPath: string): Promise<BuildResult>;
//# sourceMappingURL=build.d.ts.map