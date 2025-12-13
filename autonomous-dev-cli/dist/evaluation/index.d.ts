import { type BuildResult } from './build.js';
import { type TestResult } from './tests.js';
import { type HealthCheckResult } from './health.js';
export { runBuild, runTypeCheck, BuildCache, getBuildCache, initBuildCache, clearPackageJsonCache as clearBuildPackageJsonCache, type BuildResult, type BuildOptions } from './build.js';
export { runTests, clearPackageJsonCache as clearTestPackageJsonCache, type TestResult } from './tests.js';
export { runHealthChecks, generatePreviewUrl, type HealthCheckResult, type HealthCheck, type HealthCheckOptions } from './health.js';
export interface EvaluationResult {
    success: boolean;
    build?: BuildResult;
    tests?: TestResult;
    health?: HealthCheckResult;
    duration: number;
    summary: string;
}
export interface EvaluationOptions {
    repoPath: string;
    branchName: string;
    config: {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        healthCheckUrls: string[];
        previewUrlPattern: string;
    };
    repoInfo: {
        owner: string;
        repo: string;
    };
}
export declare function runEvaluation(options: EvaluationOptions): Promise<EvaluationResult>;
//# sourceMappingURL=index.d.ts.map