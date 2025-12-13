export interface TestResult {
    success: boolean;
    output: string;
    duration: number;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    error?: string;
}
export interface TestOptions {
    repoPath: string;
    packages?: string[];
    timeout?: number;
    testPattern?: string;
}
/**
 * Clear the package.json cache. Useful for testing or when files are known to have changed.
 */
export declare function clearPackageJsonCache(): void;
export declare function runTests(options: TestOptions): Promise<TestResult>;
//# sourceMappingURL=tests.d.ts.map