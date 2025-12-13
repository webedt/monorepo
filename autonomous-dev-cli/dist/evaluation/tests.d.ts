import { TestError } from '../utils/errors.js';
export interface TestResult {
    success: boolean;
    output: string;
    duration: number;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    error?: string;
    structuredError?: TestError;
}
export interface TestOptions {
    repoPath: string;
    packages?: string[];
    timeout?: number;
    testPattern?: string;
}
export declare function runTests(options: TestOptions): Promise<TestResult>;
//# sourceMappingURL=tests.d.ts.map