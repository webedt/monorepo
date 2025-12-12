import { z } from 'zod';
export const ConfigSchema = z.object({
    // Target repository
    repo: z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
        baseBranch: z.string().default('main'),
    }),
    // Task discovery
    discovery: z.object({
        tasksPerCycle: z.number().min(1).max(10).default(5),
        maxOpenIssues: z.number().min(1).default(10),
        excludePaths: z.array(z.string()).default([
            'node_modules',
            'dist',
            '.git',
            'coverage',
            '*.lock',
        ]),
        issueLabel: z.string().default('autonomous-dev'),
    }),
    // Execution
    execution: z.object({
        parallelWorkers: z.number().min(1).max(10).default(4),
        timeoutMinutes: z.number().min(5).max(120).default(30),
        workDir: z.string().default('/tmp/autonomous-dev'),
    }),
    // Evaluation
    evaluation: z.object({
        requireBuild: z.boolean().default(true),
        requireTests: z.boolean().default(true),
        requireHealthCheck: z.boolean().default(true),
        requireSmokeTests: z.boolean().default(false),
        healthCheckUrls: z.array(z.string()).default([]),
        smokeTestUrls: z.array(z.string()).default([]),
        previewUrlPattern: z.string().default('https://github.etdofresh.com/{owner}/{repo}/{branch}/'),
    }),
    // Auto-merge
    merge: z.object({
        autoMerge: z.boolean().default(true),
        requireAllChecks: z.boolean().default(true),
        maxRetries: z.number().min(1).max(5).default(3),
        conflictStrategy: z.enum(['rebase', 'merge', 'manual']).default('rebase'),
        mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    }),
    // Daemon
    daemon: z.object({
        loopIntervalMs: z.number().min(0).default(60000),
        pauseBetweenCycles: z.boolean().default(true),
    }),
    // Credentials (populated from DB or env)
    credentials: z.object({
        githubToken: z.string().optional(),
        claudeAuth: z.object({
            accessToken: z.string(),
            refreshToken: z.string(),
            expiresAt: z.number().optional(),
        }).optional(),
        databaseUrl: z.string().optional(),
        userEmail: z.string().email().optional(),
    }),
});
export const defaultConfig = {
    discovery: {
        tasksPerCycle: 5,
        maxOpenIssues: 10,
        excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
        issueLabel: 'autonomous-dev',
    },
    execution: {
        parallelWorkers: 4,
        timeoutMinutes: 30,
        workDir: '/tmp/autonomous-dev',
    },
    evaluation: {
        requireBuild: true,
        requireTests: true,
        requireHealthCheck: true,
        requireSmokeTests: false,
        healthCheckUrls: [],
        smokeTestUrls: [],
        previewUrlPattern: 'https://github.etdofresh.com/{owner}/{repo}/{branch}/',
    },
    merge: {
        autoMerge: true,
        requireAllChecks: true,
        maxRetries: 3,
        conflictStrategy: 'rebase',
        mergeMethod: 'squash',
    },
    daemon: {
        loopIntervalMs: 60000,
        pauseBetweenCycles: true,
    },
};
//# sourceMappingURL=schema.js.map