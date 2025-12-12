import { z } from 'zod';
export declare const ConfigSchema: z.ZodObject<{
    repo: z.ZodObject<{
        owner: z.ZodString;
        name: z.ZodString;
        baseBranch: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        owner: string;
        name: string;
        baseBranch: string;
    }, {
        owner: string;
        name: string;
        baseBranch?: string | undefined;
    }>;
    discovery: z.ZodObject<{
        tasksPerCycle: z.ZodDefault<z.ZodNumber>;
        maxOpenIssues: z.ZodDefault<z.ZodNumber>;
        excludePaths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        issueLabel: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        tasksPerCycle: number;
        maxOpenIssues: number;
        excludePaths: string[];
        issueLabel: string;
    }, {
        tasksPerCycle?: number | undefined;
        maxOpenIssues?: number | undefined;
        excludePaths?: string[] | undefined;
        issueLabel?: string | undefined;
    }>;
    execution: z.ZodObject<{
        parallelWorkers: z.ZodDefault<z.ZodNumber>;
        timeoutMinutes: z.ZodDefault<z.ZodNumber>;
        workDir: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        parallelWorkers: number;
        timeoutMinutes: number;
        workDir: string;
    }, {
        parallelWorkers?: number | undefined;
        timeoutMinutes?: number | undefined;
        workDir?: string | undefined;
    }>;
    evaluation: z.ZodObject<{
        requireBuild: z.ZodDefault<z.ZodBoolean>;
        requireTests: z.ZodDefault<z.ZodBoolean>;
        requireHealthCheck: z.ZodDefault<z.ZodBoolean>;
        requireSmokeTests: z.ZodDefault<z.ZodBoolean>;
        healthCheckUrls: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        smokeTestUrls: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        previewUrlPattern: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        requireSmokeTests: boolean;
        healthCheckUrls: string[];
        smokeTestUrls: string[];
        previewUrlPattern: string;
    }, {
        requireBuild?: boolean | undefined;
        requireTests?: boolean | undefined;
        requireHealthCheck?: boolean | undefined;
        requireSmokeTests?: boolean | undefined;
        healthCheckUrls?: string[] | undefined;
        smokeTestUrls?: string[] | undefined;
        previewUrlPattern?: string | undefined;
    }>;
    merge: z.ZodObject<{
        autoMerge: z.ZodDefault<z.ZodBoolean>;
        requireAllChecks: z.ZodDefault<z.ZodBoolean>;
        maxRetries: z.ZodDefault<z.ZodNumber>;
        conflictStrategy: z.ZodDefault<z.ZodEnum<["rebase", "merge", "manual"]>>;
        mergeMethod: z.ZodDefault<z.ZodEnum<["merge", "squash", "rebase"]>>;
    }, "strip", z.ZodTypeAny, {
        autoMerge: boolean;
        requireAllChecks: boolean;
        maxRetries: number;
        conflictStrategy: "merge" | "rebase" | "manual";
        mergeMethod: "merge" | "rebase" | "squash";
    }, {
        autoMerge?: boolean | undefined;
        requireAllChecks?: boolean | undefined;
        maxRetries?: number | undefined;
        conflictStrategy?: "merge" | "rebase" | "manual" | undefined;
        mergeMethod?: "merge" | "rebase" | "squash" | undefined;
    }>;
    daemon: z.ZodObject<{
        loopIntervalMs: z.ZodDefault<z.ZodNumber>;
        pauseBetweenCycles: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    }, {
        loopIntervalMs?: number | undefined;
        pauseBetweenCycles?: boolean | undefined;
    }>;
    credentials: z.ZodObject<{
        githubToken: z.ZodOptional<z.ZodString>;
        claudeAuth: z.ZodOptional<z.ZodObject<{
            accessToken: z.ZodString;
            refreshToken: z.ZodString;
            expiresAt: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        }, {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        }>>;
        databaseUrl: z.ZodOptional<z.ZodString>;
        userEmail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    }, {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    repo: {
        owner: string;
        name: string;
        baseBranch: string;
    };
    discovery: {
        tasksPerCycle: number;
        maxOpenIssues: number;
        excludePaths: string[];
        issueLabel: string;
    };
    execution: {
        parallelWorkers: number;
        timeoutMinutes: number;
        workDir: string;
    };
    evaluation: {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        requireSmokeTests: boolean;
        healthCheckUrls: string[];
        smokeTestUrls: string[];
        previewUrlPattern: string;
    };
    merge: {
        autoMerge: boolean;
        requireAllChecks: boolean;
        maxRetries: number;
        conflictStrategy: "merge" | "rebase" | "manual";
        mergeMethod: "merge" | "rebase" | "squash";
    };
    daemon: {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    };
    credentials: {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    };
}, {
    repo: {
        owner: string;
        name: string;
        baseBranch?: string | undefined;
    };
    discovery: {
        tasksPerCycle?: number | undefined;
        maxOpenIssues?: number | undefined;
        excludePaths?: string[] | undefined;
        issueLabel?: string | undefined;
    };
    execution: {
        parallelWorkers?: number | undefined;
        timeoutMinutes?: number | undefined;
        workDir?: string | undefined;
    };
    evaluation: {
        requireBuild?: boolean | undefined;
        requireTests?: boolean | undefined;
        requireHealthCheck?: boolean | undefined;
        requireSmokeTests?: boolean | undefined;
        healthCheckUrls?: string[] | undefined;
        smokeTestUrls?: string[] | undefined;
        previewUrlPattern?: string | undefined;
    };
    merge: {
        autoMerge?: boolean | undefined;
        requireAllChecks?: boolean | undefined;
        maxRetries?: number | undefined;
        conflictStrategy?: "merge" | "rebase" | "manual" | undefined;
        mergeMethod?: "merge" | "rebase" | "squash" | undefined;
    };
    daemon: {
        loopIntervalMs?: number | undefined;
        pauseBetweenCycles?: boolean | undefined;
    };
    credentials: {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    };
}>;
export type Config = z.infer<typeof ConfigSchema>;
export declare const defaultConfig: Partial<Config>;
//# sourceMappingURL=schema.d.ts.map