import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, defaultConfig, ProfileSchema, type Config, type ConfigProfile } from './schema.js';
import { formatZodErrors, printValidationErrors } from './validation.js';
import { logger } from '../utils/logger.js';

// Load .env file
loadEnv();

export interface ConfigSource {
  source: 'default' | 'file' | 'profile' | 'env' | 'database';
  path?: string;
  profile?: string;
}

export interface LoadConfigOptions {
  configPath?: string;
  profile?: string;
  silent?: boolean;
}

export interface LoadConfigResult {
  config: Config;
  sources: ConfigSource[];
  profileChain: string[];
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key])
      ) {
        result[key] = deepMerge(
          (target[key] as object) || {},
          source[key] as object
        ) as T[typeof key];
      } else {
        result[key] = source[key] as T[typeof key];
      }
    }
  }
  return result;
}

function getEnvironment(): string {
  return process.env.NODE_ENV || process.env.APP_ENV || 'development';
}

function getProfilePaths(basePath: string, profile?: string): string[] {
  const dir = dirname(basePath);
  const ext = '.json';
  const baseFileName = basename(basePath, ext);

  // Determine which profile to use
  const env = getEnvironment();
  const targetProfile = profile || env;

  const paths: string[] = [];

  // Profile-specific paths (e.g., dev.config.json, prod.config.json)
  if (targetProfile !== 'development') {
    // Short profile name
    const shortProfile = targetProfile.replace('development', 'dev').replace('production', 'prod');
    paths.push(join(dir, `${shortProfile}.config.json`));
    paths.push(join(dir, `${shortProfile}${ext}`));

    // Full profile name
    if (shortProfile !== targetProfile) {
      paths.push(join(dir, `${targetProfile}.config.json`));
      paths.push(join(dir, `${targetProfile}${ext}`));
    }
  }

  return paths;
}

function loadProfileChain(
  startPath: string,
  visited: Set<string> = new Set()
): { configs: ConfigProfile[]; chain: string[] } {
  const configs: ConfigProfile[] = [];
  const chain: string[] = [];

  const fullPath = resolve(startPath);

  // Prevent circular references
  if (visited.has(fullPath)) {
    logger.warn(`Circular config reference detected: ${fullPath}`);
    return { configs, chain };
  }
  visited.add(fullPath);

  if (!existsSync(fullPath)) {
    return { configs, chain };
  }

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(content);
    const result = ProfileSchema.safeParse(parsed);

    if (!result.success) {
      logger.warn(`Invalid profile config at ${fullPath}`);
      return { configs, chain };
    }

    const profile = result.data;
    chain.push(fullPath);

    // Load parent profile if extends is specified
    if (profile.extends) {
      const parentPath = resolve(dirname(fullPath), profile.extends);
      const parentResult = loadProfileChain(parentPath, visited);
      configs.push(...parentResult.configs);
      chain.unshift(...parentResult.chain);
    }

    // Add this profile's config (without extends property)
    const { extends: _, ...profileConfig } = profile;
    configs.push(profileConfig);
  } catch (error) {
    logger.warn(`Failed to parse profile ${fullPath}: ${error}`);
  }

  return { configs, chain };
}

export function loadConfig(configPath?: string): Config;
export function loadConfig(options: LoadConfigOptions): LoadConfigResult;
export function loadConfig(
  configPathOrOptions?: string | LoadConfigOptions
): Config | LoadConfigResult {
  const options: LoadConfigOptions =
    typeof configPathOrOptions === 'string'
      ? { configPath: configPathOrOptions }
      : configPathOrOptions || {};

  const { configPath, profile, silent } = options;
  const sources: ConfigSource[] = [{ source: 'default' }];
  const profileChain: string[] = [];

  let fileConfig: Partial<Config> = {};

  // Determine base config paths
  const basePaths = configPath
    ? [configPath]
    : [
        './autonomous-dev.config.json',
        './autonomous-dev.json',
        './.autonomous-dev.json',
      ];

  // Try to load base config file
  let baseConfigPath: string | null = null;
  for (const path of basePaths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      baseConfigPath = fullPath;
      break;
    }
  }

  if (baseConfigPath) {
    // Load with profile chain support
    const { configs, chain } = loadProfileChain(baseConfigPath);
    if (configs.length > 0) {
      fileConfig = configs.reduce(
        (acc, cfg) => deepMerge(acc as Config, cfg),
        {} as Partial<Config>
      );
      profileChain.push(...chain);
      sources.push({ source: 'file', path: baseConfigPath });
      if (!silent) {
        logger.info(`Loaded config from ${baseConfigPath}`);
      }
    }
  }

  // Try to load environment-specific profile
  if (baseConfigPath || basePaths.length > 0) {
    const searchBase = baseConfigPath || resolve(basePaths[0]);
    const profilePaths = getProfilePaths(searchBase, profile);

    for (const profilePath of profilePaths) {
      const fullPath = resolve(profilePath);
      if (existsSync(fullPath) && !profileChain.includes(fullPath)) {
        const { configs, chain } = loadProfileChain(fullPath);
        if (configs.length > 0) {
          fileConfig = configs.reduce(
            (acc, cfg) => deepMerge(acc, cfg),
            fileConfig
          );
          profileChain.push(...chain.filter((p) => !profileChain.includes(p)));
          sources.push({
            source: 'profile',
            path: fullPath,
            profile: profile || getEnvironment(),
          });
          if (!silent) {
            logger.info(`Loaded profile config from ${fullPath}`);
          }
          break;
        }
      }
    }
  }

  // Build config from env vars (only include repo if set, use file config values as fallback)
  const envConfig: Partial<Config> = {};

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
    healthCheckUrls: process.env.HEALTH_CHECK_URLS?.split(',').filter(Boolean) || [],
    smokeTestUrls: process.env.SMOKE_TEST_URLS?.split(',').filter(Boolean) || [],
    previewUrlPattern: process.env.PREVIEW_URL_PATTERN || defaultConfig.evaluation?.previewUrlPattern || '',
  };

  envConfig.merge = {
    autoMerge: process.env.AUTO_MERGE !== 'false',
    requireAllChecks: process.env.REQUIRE_ALL_CHECKS !== 'false',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    conflictStrategy: (process.env.CONFLICT_STRATEGY as 'rebase' | 'merge' | 'manual') || 'rebase',
    mergeMethod: (process.env.MERGE_METHOD as 'merge' | 'squash' | 'rebase') || 'squash',
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

  sources.push({ source: 'env' });

  // Merge configs: defaults < file < env
  const mergedConfig = deepMerge(
    deepMerge(defaultConfig as Config, fileConfig),
    envConfig
  );

  // Validate
  const result = ConfigSchema.safeParse(mergedConfig);
  if (!result.success) {
    const formattedErrors = formatZodErrors(result.error, mergedConfig);
    printValidationErrors(formattedErrors);
    throw new Error('Configuration validation failed');
  }

  // Return based on call signature
  if (typeof configPathOrOptions === 'object') {
    return {
      config: result.data,
      sources,
      profileChain,
    };
  }

  return result.data;
}

export { Config } from './schema.js';
export { fieldMetadata } from './schema.js';
export type { ConfigSource, LoadConfigOptions, LoadConfigResult };
export {
  formatZodErrors,
  printValidationErrors,
  validateDependencies,
  validateGitHubToken,
  validateClaudeAuth,
  printDependencyValidation,
  type FormattedError,
  type ValidationResult,
  type DependencyValidationResult,
} from './validation.js';
