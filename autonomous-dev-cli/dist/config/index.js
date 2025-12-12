import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, defaultConfig } from './schema.js';
import { logger } from '../utils/logger.js';
// Load .env file
loadEnv();
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] !== undefined) {
            if (typeof source[key] === 'object' &&
                source[key] !== null &&
                !Array.isArray(source[key])) {
                result[key] = deepMerge(target[key] || {}, source[key]);
            }
            else {
                result[key] = source[key];
            }
        }
    }
    return result;
}
export function loadConfig(configPath) {
    let fileConfig = {};
    // Try to load config file
    const possiblePaths = configPath
        ? [configPath]
        : [
            './autonomous-dev.config.json',
            './autonomous-dev.json',
            './.autonomous-dev.json',
        ];
    for (const path of possiblePaths) {
        const fullPath = resolve(path);
        if (existsSync(fullPath)) {
            try {
                const content = readFileSync(fullPath, 'utf-8');
                fileConfig = JSON.parse(content);
                logger.info(`Loaded config from ${fullPath}`);
                break;
            }
            catch (error) {
                logger.warn(`Failed to parse config file ${fullPath}: ${error}`);
            }
        }
    }
    // Build config from env vars (only include repo if set, use file config values as fallback)
    const envConfig = {};
    // Repo config - prioritize file config, then env, then empty
    const repoOwner = process.env.REPO_OWNER || fileConfig.repo?.owner || '';
    const repoName = process.env.REPO_NAME || fileConfig.repo?.name || '';
    const baseBranch = process.env.REPO_BASE_BRANCH || fileConfig.repo?.baseBranch || 'main';
    if (repoOwner || repoName) {
        envConfig.repo = { owner: repoOwner, name: repoName, baseBranch };
    }
    envConfig.discovery = {
        tasksPerCycle: parseInt(process.env.TASKS_PER_CYCLE || '5', 10),
        maxOpenIssues: parseInt(process.env.MAX_OPEN_ISSUES || '10', 10),
        excludePaths: process.env.EXCLUDE_PATHS?.split(',') || defaultConfig.discovery?.excludePaths || [],
        issueLabel: process.env.ISSUE_LABEL || 'autonomous-dev',
    };
    envConfig.execution = {
        parallelWorkers: parseInt(process.env.PARALLEL_WORKERS || '4', 10),
        timeoutMinutes: parseInt(process.env.TIMEOUT_MINUTES || '30', 10),
        workDir: process.env.WORK_DIR || '/tmp/autonomous-dev',
    };
    envConfig.evaluation = {
        requireBuild: process.env.REQUIRE_BUILD !== 'false',
        requireTests: process.env.REQUIRE_TESTS !== 'false',
        requireHealthCheck: process.env.REQUIRE_HEALTH_CHECK !== 'false',
        requireSmokeTests: process.env.REQUIRE_SMOKE_TESTS === 'true',
        healthCheckUrls: process.env.HEALTH_CHECK_URLS?.split(',') || [],
        smokeTestUrls: process.env.SMOKE_TEST_URLS?.split(',') || [],
        previewUrlPattern: process.env.PREVIEW_URL_PATTERN || defaultConfig.evaluation?.previewUrlPattern || '',
    };
    envConfig.merge = {
        autoMerge: process.env.AUTO_MERGE !== 'false',
        requireAllChecks: process.env.REQUIRE_ALL_CHECKS !== 'false',
        maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
        conflictStrategy: process.env.CONFLICT_STRATEGY || 'rebase',
        mergeMethod: process.env.MERGE_METHOD || 'squash',
    };
    envConfig.daemon = {
        loopIntervalMs: parseInt(process.env.LOOP_INTERVAL_MS || '60000', 10),
        pauseBetweenCycles: process.env.PAUSE_BETWEEN_CYCLES !== 'false',
    };
    envConfig.credentials = {
        githubToken: process.env.GITHUB_TOKEN,
        claudeAuth: process.env.CLAUDE_ACCESS_TOKEN
            ? {
                accessToken: process.env.CLAUDE_ACCESS_TOKEN,
                refreshToken: process.env.CLAUDE_REFRESH_TOKEN || '',
                expiresAt: process.env.CLAUDE_EXPIRES_AT
                    ? parseInt(process.env.CLAUDE_EXPIRES_AT, 10)
                    : undefined,
            }
            : undefined,
        databaseUrl: process.env.DATABASE_URL,
        userEmail: process.env.USER_EMAIL,
    };
    // Merge configs: defaults < file < env
    const mergedConfig = deepMerge(deepMerge(defaultConfig, fileConfig), envConfig);
    // Validate
    const result = ConfigSchema.safeParse(mergedConfig);
    if (!result.success) {
        logger.error('Invalid configuration:');
        for (const error of result.error.errors) {
            logger.error(`  ${error.path.join('.')}: ${error.message}`);
        }
        throw new Error('Configuration validation failed');
    }
    return result.data;
}
//# sourceMappingURL=index.js.map