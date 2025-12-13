export interface HealthCheckResult {
    success: boolean;
    checks: HealthCheck[];
    duration: number;
}
export interface HealthCheck {
    url: string;
    status: number | null;
    ok: boolean;
    responseTime: number;
    error?: string;
}
export interface HealthCheckOptions {
    urls: string[];
    timeout?: number;
    expectedStatus?: number;
    retries?: number;
    retryDelay?: number;
    concurrency?: number;
    parallel?: boolean;
}
export declare function runHealthChecks(options: HealthCheckOptions): Promise<HealthCheckResult>;
export declare function generatePreviewUrl(pattern: string, params: {
    owner: string;
    repo: string;
    branch: string;
}): string;
//# sourceMappingURL=health.d.ts.map