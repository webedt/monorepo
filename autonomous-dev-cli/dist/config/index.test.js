import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { loadConfig, getConfigHelp } from './index.js';
import { ConfigError, ErrorCode } from '../utils/errors.js';
import { validateNoCredentialsInConfig, ConfigSchema, defaultConfig } from './schema.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
describe('Config Module', () => {
    let testDir;
    let originalEnv;
    let originalCwd;
    beforeEach(() => {
        // Save original environment and cwd
        originalEnv = { ...process.env };
        originalCwd = process.cwd();
        // Create a temporary test directory
        testDir = join(tmpdir(), `config-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        process.chdir(testDir);
        // Clear relevant environment variables
        delete process.env.REPO_OWNER;
        delete process.env.REPO_NAME;
        delete process.env.REPO_BASE_BRANCH;
        delete process.env.GITHUB_TOKEN;
        delete process.env.CLAUDE_ACCESS_TOKEN;
        delete process.env.TASKS_PER_CYCLE;
        delete process.env.MAX_OPEN_ISSUES;
        delete process.env.PARALLEL_WORKERS;
        delete process.env.TIMEOUT_MINUTES;
        delete process.env.WORK_DIR;
    });
    afterEach(() => {
        // Restore original environment and cwd
        process.env = originalEnv;
        process.chdir(originalCwd);
        // Clean up test directory
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });
    describe('loadConfig', () => {
        it('should load config from autonomous-dev.config.json', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                    baseBranch: 'main',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            const config = loadConfig();
            assert.strictEqual(config.repo.owner, 'test-owner');
            assert.strictEqual(config.repo.name, 'test-repo');
            assert.strictEqual(config.repo.baseBranch, 'main');
        });
        it('should load config from autonomous-dev.json', () => {
            const configContent = {
                repo: {
                    owner: 'json-owner',
                    name: 'json-repo',
                    baseBranch: 'develop',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(configContent));
            const config = loadConfig();
            assert.strictEqual(config.repo.owner, 'json-owner');
            assert.strictEqual(config.repo.name, 'json-repo');
            assert.strictEqual(config.repo.baseBranch, 'develop');
        });
        it('should load config from .autonomous-dev.json', () => {
            const configContent = {
                repo: {
                    owner: 'hidden-owner',
                    name: 'hidden-repo',
                    baseBranch: 'main',
                },
            };
            writeFileSync(join(testDir, '.autonomous-dev.json'), JSON.stringify(configContent));
            const config = loadConfig();
            assert.strictEqual(config.repo.owner, 'hidden-owner');
            assert.strictEqual(config.repo.name, 'hidden-repo');
        });
        it('should prioritize environment variables over config file', () => {
            const configContent = {
                repo: {
                    owner: 'file-owner',
                    name: 'file-repo',
                    baseBranch: 'main',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            process.env.REPO_OWNER = 'env-owner';
            process.env.REPO_NAME = 'env-repo';
            const config = loadConfig();
            assert.strictEqual(config.repo.owner, 'env-owner');
            assert.strictEqual(config.repo.name, 'env-repo');
        });
        it('should use default values for optional fields', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            const config = loadConfig();
            // Check default values
            assert.strictEqual(config.repo.baseBranch, 'main');
            assert.strictEqual(config.discovery.tasksPerCycle, 5);
            assert.strictEqual(config.discovery.maxOpenIssues, 10);
            assert.strictEqual(config.execution.parallelWorkers, 4);
            assert.strictEqual(config.execution.timeoutMinutes, 30);
            assert.strictEqual(config.merge.mergeMethod, 'squash');
            assert.strictEqual(config.merge.conflictStrategy, 'rebase');
            assert.strictEqual(config.merge.autoMerge, true);
        });
        it('should throw ConfigError for missing required fields', () => {
            // Create config file without required repo fields
            const configContent = {
                discovery: {
                    tasksPerCycle: 5,
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            assert.throws(() => loadConfig(), (error) => {
                return error instanceof ConfigError &&
                    error.code === ErrorCode.CONFIG_VALIDATION_FAILED;
            });
        });
        it('should throw ConfigError for invalid JSON', () => {
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), 'not valid json {');
            // Since invalid JSON is logged but config loading continues,
            // it will fail on validation of empty config
            assert.throws(() => loadConfig(), (error) => {
                return error instanceof ConfigError;
            });
        });
        it('should validate numeric bounds', () => {
            // Note: The config loader merges file config with env defaults
            // We need to set env vars to test bounds validation properly
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
                discovery: {
                    tasksPerCycle: 100, // Max is 10, but env override will use this value
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            // Set env var to the out-of-bounds value
            process.env.TASKS_PER_CYCLE = '100';
            assert.throws(() => loadConfig(), (error) => {
                return error instanceof ConfigError &&
                    error.code === ErrorCode.CONFIG_VALIDATION_FAILED;
            });
        });
        it('should validate enum values', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
                merge: {
                    mergeMethod: 'invalid-method',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            // Set env var to the invalid value to ensure validation triggers
            process.env.MERGE_METHOD = 'invalid-method';
            assert.throws(() => loadConfig(), (error) => {
                return error instanceof ConfigError;
            });
        });
        it('should load config from specified path', () => {
            const customPath = join(testDir, 'custom-config.json');
            const configContent = {
                repo: {
                    owner: 'custom-owner',
                    name: 'custom-repo',
                    baseBranch: 'custom-branch',
                },
            };
            writeFileSync(customPath, JSON.stringify(configContent));
            const config = loadConfig(customPath);
            assert.strictEqual(config.repo.owner, 'custom-owner');
            assert.strictEqual(config.repo.name, 'custom-repo');
            assert.strictEqual(config.repo.baseBranch, 'custom-branch');
        });
        it('should handle deeply nested configuration merging', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
                evaluation: {
                    requireBuild: false,
                    requireTests: false,
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            // Set env vars to match the file config to ensure values propagate
            process.env.REQUIRE_BUILD = 'false';
            process.env.REQUIRE_TESTS = 'false';
            const config = loadConfig();
            assert.strictEqual(config.evaluation.requireBuild, false);
            assert.strictEqual(config.evaluation.requireTests, false);
            // Other evaluation defaults should still be present (requireHealthCheck default is true)
            // but env override REQUIRE_HEALTH_CHECK is not 'false', so stays true
            assert.strictEqual(config.evaluation.requireHealthCheck, true);
        });
        it('should parse environment variables for array fields', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            process.env.EXCLUDE_PATHS = 'node_modules,dist,build';
            const config = loadConfig();
            assert.deepStrictEqual(config.discovery.excludePaths, ['node_modules', 'dist', 'build']);
        });
        it('should parse boolean environment variables', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            process.env.REQUIRE_BUILD = 'false';
            process.env.AUTO_MERGE = 'false';
            const config = loadConfig();
            assert.strictEqual(config.evaluation.requireBuild, false);
            assert.strictEqual(config.merge.autoMerge, false);
        });
        it('should handle Claude auth from environment', () => {
            const configContent = {
                repo: {
                    owner: 'test-owner',
                    name: 'test-repo',
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            process.env.CLAUDE_ACCESS_TOKEN = 'test-access-token';
            process.env.CLAUDE_REFRESH_TOKEN = 'test-refresh-token';
            const config = loadConfig();
            assert.strictEqual(config.credentials.claudeAuth?.accessToken, 'test-access-token');
            assert.strictEqual(config.credentials.claudeAuth?.refreshToken, 'test-refresh-token');
        });
    });
    describe('getConfigHelp', () => {
        it('should return comprehensive help text', () => {
            const helpText = getConfigHelp();
            // Check that major sections are present
            assert.ok(helpText.includes('REPOSITORY SETTINGS'));
            assert.ok(helpText.includes('DISCOVERY SETTINGS'));
            assert.ok(helpText.includes('EXECUTION SETTINGS'));
            assert.ok(helpText.includes('EVALUATION SETTINGS'));
            assert.ok(helpText.includes('MERGE SETTINGS'));
            assert.ok(helpText.includes('DAEMON SETTINGS'));
            assert.ok(helpText.includes('CREDENTIALS'));
            assert.ok(helpText.includes('CONFIGURATION FILES'));
            assert.ok(helpText.includes('QUICK START'));
        });
        it('should include environment variable references', () => {
            const helpText = getConfigHelp();
            assert.ok(helpText.includes('REPO_OWNER'));
            assert.ok(helpText.includes('REPO_NAME'));
            assert.ok(helpText.includes('GITHUB_TOKEN'));
            assert.ok(helpText.includes('CLAUDE_ACCESS_TOKEN'));
        });
        it('should include example values', () => {
            const helpText = getConfigHelp();
            assert.ok(helpText.includes('Example:'));
            assert.ok(helpText.includes('main'));
            assert.ok(helpText.includes('squash'));
        });
        it('should include file search order', () => {
            const helpText = getConfigHelp();
            assert.ok(helpText.includes('autonomous-dev.config.json'));
            assert.ok(helpText.includes('autonomous-dev.json'));
            assert.ok(helpText.includes('.autonomous-dev.json'));
        });
    });
    describe('ConfigError', () => {
        it('should include recovery actions', () => {
            const configContent = {
                discovery: {
                    tasksPerCycle: 5,
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            try {
                loadConfig();
                assert.fail('Expected ConfigError to be thrown');
            }
            catch (error) {
                assert.ok(error instanceof ConfigError);
                assert.ok(error.recoveryActions.length > 0);
                const descriptions = error.recoveryActions.map(a => a.description);
                assert.ok(descriptions.some(d => d.includes('autonomous-dev init')));
            }
        });
        it('should include validation error context', () => {
            const configContent = {
                discovery: {
                    tasksPerCycle: 5,
                },
            };
            writeFileSync(join(testDir, 'autonomous-dev.config.json'), JSON.stringify(configContent));
            try {
                loadConfig();
                assert.fail('Expected ConfigError to be thrown');
            }
            catch (error) {
                assert.ok(error instanceof ConfigError);
                assert.ok(error.context.validationErrors);
                assert.ok(Array.isArray(error.context.validationErrors));
            }
        });
    });
});
describe('Config Schema', () => {
    let testDir;
    let originalEnv;
    let originalCwd;
    beforeEach(() => {
        originalEnv = { ...process.env };
        originalCwd = process.cwd();
        testDir = join(tmpdir(), `schema-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        process.chdir(testDir);
        // Clear environment
        delete process.env.REPO_OWNER;
        delete process.env.REPO_NAME;
        delete process.env.TASKS_PER_CYCLE;
        delete process.env.MAX_OPEN_ISSUES;
        delete process.env.PARALLEL_WORKERS;
        delete process.env.TIMEOUT_MINUTES;
        delete process.env.MERGE_METHOD;
        delete process.env.CONFLICT_STRATEGY;
        delete process.env.MAX_DEPTH;
        delete process.env.MAX_FILES;
    });
    afterEach(() => {
        process.env = originalEnv;
        process.chdir(originalCwd);
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });
    it('should validate tasksPerCycle bounds (1-10)', () => {
        // Test minimum bound - set env var to invalid value
        process.env.TASKS_PER_CYCLE = '0';
        const minConfig = {
            repo: { owner: 'test', name: 'repo' },
            discovery: { tasksPerCycle: 0 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(minConfig));
        assert.throws(() => loadConfig(), ConfigError);
        // Test maximum bound - set env var to invalid value
        process.env.TASKS_PER_CYCLE = '11';
        const maxConfig = {
            repo: { owner: 'test', name: 'repo' },
            discovery: { tasksPerCycle: 11 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(maxConfig));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate parallelWorkers bounds (1-10)', () => {
        // Set env var to invalid value
        process.env.PARALLEL_WORKERS = '15';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            execution: { parallelWorkers: 15 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate timeoutMinutes bounds (5-120)', () => {
        // Set env var to invalid value
        process.env.TIMEOUT_MINUTES = '2';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            execution: { timeoutMinutes: 2 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate mergeMethod enum', () => {
        // Set env var to invalid value
        process.env.MERGE_METHOD = 'fast-forward';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            merge: { mergeMethod: 'fast-forward' },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate conflictStrategy enum', () => {
        // Set env var to invalid value
        process.env.CONFLICT_STRATEGY = 'force';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            merge: { conflictStrategy: 'force' },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate maxDepth bounds (1-20)', () => {
        // Set env var to invalid value
        process.env.MAX_DEPTH = '25';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            discovery: { maxDepth: 25 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should validate maxFiles bounds (100-50000)', () => {
        // Set env var to invalid value
        process.env.MAX_FILES = '50';
        const config = {
            repo: { owner: 'test', name: 'repo' },
            discovery: { maxFiles: 50 },
        };
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        assert.throws(() => loadConfig(), ConfigError);
    });
    it('should accept valid complete configuration', () => {
        const config = {
            repo: {
                owner: 'test-owner',
                name: 'test-repo',
                baseBranch: 'main',
            },
            discovery: {
                tasksPerCycle: 5,
                maxOpenIssues: 10,
                excludePaths: ['node_modules', 'dist'],
                issueLabel: 'autonomous-dev',
                maxDepth: 10,
                maxFiles: 10000,
            },
            execution: {
                parallelWorkers: 4,
                timeoutMinutes: 30,
                workDir: '/tmp/test',
            },
            evaluation: {
                requireBuild: true,
                requireTests: true,
                requireHealthCheck: false,
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
        writeFileSync(join(testDir, 'autonomous-dev.json'), JSON.stringify(config));
        const loadedConfig = loadConfig();
        assert.strictEqual(loadedConfig.repo.owner, 'test-owner');
        assert.strictEqual(loadedConfig.discovery.tasksPerCycle, 5);
        assert.strictEqual(loadedConfig.execution.parallelWorkers, 4);
        assert.strictEqual(loadedConfig.merge.mergeMethod, 'squash');
    });
});
describe('Credential Validation', () => {
    describe('validateNoCredentialsInConfig', () => {
        it('should detect Anthropic API keys (sk-ant-)', () => {
            const config = {
                credentials: {
                    claudeAuth: {
                        accessToken: 'sk-ant-abcdefghijklmnop1234567890',
                        refreshToken: '',
                    },
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
            assert.ok(warnings.some(w => w.includes('Potential credential detected')));
        });
        it('should detect GitHub personal access tokens (ghp_)', () => {
            const config = {
                credentials: {
                    githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
            assert.ok(warnings.some(w => w.includes('Potential credential detected')));
        });
        it('should detect GitHub OAuth tokens (gho_)', () => {
            const config = {
                credentials: {
                    githubToken: 'gho_abcdefghijklmnopqrstuvwxyz1234567890',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
        });
        it('should detect GitHub PATs (github_pat_)', () => {
            const config = {
                credentials: {
                    githubToken: 'github_pat_abcdefghijklmnopqrstuvwxyz12345',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
        });
        it('should detect Bearer tokens', () => {
            const config = {
                credentials: {
                    githubToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
        });
        it('should detect Basic auth tokens', () => {
            const config = {
                credentials: {
                    githubToken: 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.ok(warnings.length > 0);
        });
        it('should not flag short strings', () => {
            const config = {
                repo: {
                    owner: 'myuser',
                    name: 'myrepo',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.strictEqual(warnings.length, 0);
        });
        it('should not flag normal configuration values', () => {
            const config = {
                repo: {
                    owner: 'organization-name',
                    name: 'repository-name',
                    baseBranch: 'main',
                },
                execution: {
                    workDir: '/tmp/autonomous-dev',
                },
                discovery: {
                    issueLabel: 'autonomous-dev',
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            assert.strictEqual(warnings.length, 0);
        });
        it('should check nested objects recursively', () => {
            const config = {
                credentials: {
                    claudeAuth: {
                        accessToken: 'sk-ant-verylongsecrettokenstring12345',
                        refreshToken: 'ghp_anothersecrettokenthatisalsoverylongstring',
                    },
                },
            };
            const warnings = validateNoCredentialsInConfig(config);
            // Should detect both credential patterns
            assert.ok(warnings.length >= 2);
        });
        it('should return empty array for empty config', () => {
            const warnings = validateNoCredentialsInConfig({});
            assert.strictEqual(warnings.length, 0);
        });
    });
    describe('ConfigSchema credential validation', () => {
        const validBaseConfig = {
            repo: { owner: 'test', name: 'repo', baseBranch: 'main' },
            discovery: {
                tasksPerCycle: 5,
                maxOpenIssues: 10,
                excludePaths: ['node_modules'],
                issueLabel: 'test',
                maxDepth: 10,
                maxFiles: 10000,
            },
            execution: {
                parallelWorkers: 4,
                timeoutMinutes: 30,
                workDir: '/tmp/test',
            },
            evaluation: {
                requireBuild: true,
                requireTests: true,
                requireHealthCheck: false,
                requireSmokeTests: false,
                healthCheckUrls: [],
                smokeTestUrls: [],
                previewUrlPattern: '',
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
            logging: {
                format: 'pretty',
                level: 'info',
                includeCorrelationId: true,
                includeTimestamp: true,
            },
            circuitBreaker: {
                failureThreshold: 5,
                resetTimeoutMs: 60000,
                baseDelayMs: 100,
                maxDelayMs: 30000,
                successThreshold: 1,
                enabled: true,
            },
            credentials: {},
        };
        it('should reject credentials in config file strings via Zod refinement', () => {
            const result = ConfigSchema.safeParse({
                ...validBaseConfig,
                credentials: {
                    githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
                },
            });
            assert.strictEqual(result.success, false);
            if (!result.success) {
                const errorMessages = result.error.errors.map(e => e.message);
                assert.ok(errorMessages.some(m => m.includes('environment variables')));
            }
        });
        it('should accept empty credential strings', () => {
            const result = ConfigSchema.safeParse({
                ...validBaseConfig,
                credentials: {
                    githubToken: '',
                },
            });
            assert.strictEqual(result.success, true);
        });
        it('should accept undefined credentials', () => {
            const result = ConfigSchema.safeParse({
                ...validBaseConfig,
                credentials: {},
            });
            assert.strictEqual(result.success, true);
        });
        it('should accept valid short tokens that are not credential patterns', () => {
            const result = ConfigSchema.safeParse({
                ...validBaseConfig,
                credentials: {
                    githubToken: 'short',
                },
            });
            assert.strictEqual(result.success, true);
        });
    });
});
describe('Default Config', () => {
    it('should have sensible discovery defaults', () => {
        assert.strictEqual(defaultConfig.discovery?.tasksPerCycle, 5);
        assert.strictEqual(defaultConfig.discovery?.maxOpenIssues, 10);
        assert.strictEqual(defaultConfig.discovery?.maxDepth, 10);
        assert.strictEqual(defaultConfig.discovery?.maxFiles, 10000);
        assert.ok(Array.isArray(defaultConfig.discovery?.excludePaths));
        assert.ok(defaultConfig.discovery?.excludePaths?.includes('node_modules'));
        assert.ok(defaultConfig.discovery?.excludePaths?.includes('dist'));
    });
    it('should have sensible execution defaults', () => {
        assert.strictEqual(defaultConfig.execution?.parallelWorkers, 4);
        assert.strictEqual(defaultConfig.execution?.timeoutMinutes, 30);
        assert.strictEqual(defaultConfig.execution?.workDir, '/tmp/autonomous-dev');
    });
    it('should have sensible merge defaults', () => {
        assert.strictEqual(defaultConfig.merge?.autoMerge, true);
        assert.strictEqual(defaultConfig.merge?.requireAllChecks, true);
        assert.strictEqual(defaultConfig.merge?.maxRetries, 3);
        assert.strictEqual(defaultConfig.merge?.conflictStrategy, 'rebase');
        assert.strictEqual(defaultConfig.merge?.mergeMethod, 'squash');
    });
    it('should have sensible evaluation defaults', () => {
        assert.strictEqual(defaultConfig.evaluation?.requireBuild, true);
        assert.strictEqual(defaultConfig.evaluation?.requireTests, true);
        assert.strictEqual(defaultConfig.evaluation?.requireHealthCheck, true);
        assert.strictEqual(defaultConfig.evaluation?.requireSmokeTests, false);
    });
    it('should have sensible logging defaults', () => {
        assert.strictEqual(defaultConfig.logging?.format, 'pretty');
        assert.strictEqual(defaultConfig.logging?.level, 'info');
        assert.strictEqual(defaultConfig.logging?.includeCorrelationId, true);
        assert.strictEqual(defaultConfig.logging?.includeTimestamp, true);
    });
    it('should have sensible circuit breaker defaults', () => {
        assert.strictEqual(defaultConfig.circuitBreaker?.failureThreshold, 5);
        assert.strictEqual(defaultConfig.circuitBreaker?.resetTimeoutMs, 60000);
        assert.strictEqual(defaultConfig.circuitBreaker?.baseDelayMs, 100);
        assert.strictEqual(defaultConfig.circuitBreaker?.maxDelayMs, 30000);
        assert.strictEqual(defaultConfig.circuitBreaker?.successThreshold, 1);
        assert.strictEqual(defaultConfig.circuitBreaker?.enabled, true);
    });
    it('should have sensible daemon defaults', () => {
        assert.strictEqual(defaultConfig.daemon?.loopIntervalMs, 60000);
        assert.strictEqual(defaultConfig.daemon?.pauseBetweenCycles, true);
    });
});
//# sourceMappingURL=index.test.js.map