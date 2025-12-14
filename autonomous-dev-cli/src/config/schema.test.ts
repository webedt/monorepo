/**
 * Tests for the Configuration Schema
 *
 * These tests verify:
 * - Schema validation for all configuration sections
 * - Default value handling
 * - Credential pattern rejection
 * - Range validation for numeric fields
 * - Type validation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';
import { ConfigSchema, validateNoCredentialsInConfig, defaultConfig, type Config } from './schema.js';

// Base config with all required fields for testing
const baseConfig = {
  repo: {
    owner: 'test-owner',
    name: 'test-repo',
  },
  credentials: {}, // Required but can be empty
  discovery: {
    tasksPerCycle: 5,
    maxOpenIssues: 10,
    excludePaths: [],
    issueLabel: 'autonomous-dev',
    maxDepth: 10,
    maxFiles: 10000,
  },
  execution: {
    parallelWorkers: 4,
    timeoutMinutes: 30,
    workDir: '/tmp/autonomous-dev',
  },
  evaluation: {
    requireBuild: true,
    requireTests: true,
    requireHealthCheck: false,
    requireSmokeTests: false,
    healthCheckUrls: [],
    smokeTestUrls: [],
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
  },
};

describe('ConfigSchema', () => {
  describe('repo section', () => {
    it('should require owner', () => {
      const config = {
        repo: {
          name: 'test-repo',
        },
        credentials: {},
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should require name', () => {
      const config = {
        repo: {
          owner: 'test-owner',
        },
        credentials: {},
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should use default baseBranch', () => {
      const config = {
        ...baseConfig,
      };

      const result = ConfigSchema.safeParse(config);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.repo.baseBranch, 'main');
      }
    });

    it('should accept custom baseBranch', () => {
      const config = {
        ...baseConfig,
        repo: {
          owner: 'test-owner',
          name: 'test-repo',
          baseBranch: 'develop',
        },
      };

      const result = ConfigSchema.safeParse(config);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.repo.baseBranch, 'develop');
      }
    });
  });

  describe('discovery section', () => {
    it('should use default tasksPerCycle', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      assert.strictEqual(result.success, true);
      if (result.success) {
        assert.strictEqual(result.data.discovery.tasksPerCycle, 5);
      }
    });

    it('should reject tasksPerCycle below minimum', () => {
      const config = {
        ...baseConfig,
        discovery: { tasksPerCycle: 0 },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should reject tasksPerCycle above maximum', () => {
      const config = {
        ...baseConfig,
        discovery: { tasksPerCycle: 11 },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should accept tasksPerCycle in valid range', () => {
      [1, 5, 10].forEach(tasksPerCycle => {
        const config = {
          ...baseConfig,
          discovery: { tasksPerCycle },
        };

        const result = ConfigSchema.safeParse(config);
        assert.strictEqual(result.success, true, `Failed for tasksPerCycle: ${tasksPerCycle}`);
      });
    });

    it('should use default maxOpenIssues', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.discovery.maxOpenIssues, 10);
      }
    });

    it('should reject maxOpenIssues below minimum', () => {
      const config = {
        ...baseConfig,
        discovery: { maxOpenIssues: 0 },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should use default excludePaths', () => {
      // Create a config without excludePaths to test defaults
      const configWithoutExcludePaths = {
        ...baseConfig,
        discovery: {
          ...baseConfig.discovery,
          excludePaths: undefined,
        },
      };
      const result = ConfigSchema.safeParse(configWithoutExcludePaths);

      if (result.success) {
        // Check that default excludePaths are applied
        assert.ok(Array.isArray(result.data.discovery.excludePaths));
      }
    });

    it('should use default issueLabel', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.discovery.issueLabel, 'autonomous-dev');
      }
    });

    it('should validate maxDepth range (1-20)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        discovery: { maxDepth: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        discovery: { maxDepth: 21 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        discovery: { maxDepth: 10 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should validate maxFiles range (100-50000)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        discovery: { maxFiles: 50 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        discovery: { maxFiles: 60000 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        discovery: { maxFiles: 5000 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });
  });

  describe('cache section', () => {
    it('should use default enabled value', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.cache.enabled, true);
      }
    });

    it('should validate maxEntries range (1-1000)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        cache: { maxEntries: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        cache: { maxEntries: 1001 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        cache: { maxEntries: 100 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should validate ttlMinutes range (1-1440)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        cache: { ttlMinutes: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum (more than 24 hours)
      config = {
        ...baseConfig,
        cache: { ttlMinutes: 1441 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        cache: { ttlMinutes: 60 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should validate maxSizeMB range (10-1000)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        cache: { maxSizeMB: 5 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        cache: { maxSizeMB: 1001 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);
    });

    it('should use default cacheDir', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.cache.cacheDir, '.autonomous-dev-cache');
      }
    });
  });

  describe('execution section', () => {
    it('should validate parallelWorkers range (1-10)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        execution: { parallelWorkers: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        execution: { parallelWorkers: 11 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        execution: { parallelWorkers: 4 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should validate timeoutMinutes range (5-120)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        execution: { timeoutMinutes: 3 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        execution: { timeoutMinutes: 121 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        execution: { timeoutMinutes: 30 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should use default workDir', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.execution.workDir, '/tmp/autonomous-dev');
      }
    });
  });

  describe('evaluation section', () => {
    it('should use default values', () => {
      const config = {
        repo: { owner: 'test', name: 'repo' },
      };

      const result = ConfigSchema.safeParse(config);

      if (result.success) {
        assert.strictEqual(result.data.evaluation.requireBuild, true);
        assert.strictEqual(result.data.evaluation.requireTests, true);
        assert.strictEqual(result.data.evaluation.requireHealthCheck, true);
        assert.strictEqual(result.data.evaluation.requireSmokeTests, false);
      }
    });

    it('should accept health check URLs', () => {
      const config = {
        ...baseConfig,
        evaluation: {
          ...baseConfig.evaluation,
          healthCheckUrls: ['http://localhost:3000/health', 'http://localhost:8080/status'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, true);
    });

    it('should accept smoke test URLs', () => {
      const config = {
        ...baseConfig,
        evaluation: {
          ...baseConfig.evaluation,
          smokeTestUrls: ['http://localhost:3000/api/test'],
        },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, true);
    });
  });

  describe('merge section', () => {
    it('should validate conflictStrategy enum', () => {
      const validStrategies = ['rebase', 'merge', 'manual'];
      const invalidStrategies = ['invalid', 'auto', 'fast-forward'];

      validStrategies.forEach(strategy => {
        const config = {
          ...baseConfig,
          merge: { ...baseConfig.merge, conflictStrategy: strategy },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, true, `Failed for strategy: ${strategy}`);
      });

      invalidStrategies.forEach(strategy => {
        const config = {
          ...baseConfig,
          merge: { ...baseConfig.merge, conflictStrategy: strategy },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, false, `Should fail for strategy: ${strategy}`);
      });
    });

    it('should validate mergeMethod enum', () => {
      const validMethods = ['merge', 'squash', 'rebase'];
      const invalidMethods = ['invalid', 'fast-forward'];

      validMethods.forEach(method => {
        const config = {
          ...baseConfig,
          merge: { ...baseConfig.merge, mergeMethod: method },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, true, `Failed for method: ${method}`);
      });

      invalidMethods.forEach(method => {
        const config = {
          ...baseConfig,
          merge: { ...baseConfig.merge, mergeMethod: method },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, false, `Should fail for method: ${method}`);
      });
    });

    it('should validate maxRetries range (1-5)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        merge: { ...baseConfig.merge, maxRetries: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        merge: { ...baseConfig.merge, maxRetries: 6 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        merge: { ...baseConfig.merge, maxRetries: 3 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });
  });

  describe('daemon section', () => {
    it('should reject negative loopIntervalMs', () => {
      const config = {
        ...baseConfig,
        daemon: { loopIntervalMs: -1 },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, false);
    });

    it('should accept zero loopIntervalMs', () => {
      const config = {
        ...baseConfig,
        daemon: { loopIntervalMs: 0 },
      };

      const result = ConfigSchema.safeParse(config);
      assert.strictEqual(result.success, true);
    });

    it('should use default loopIntervalMs', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.daemon.loopIntervalMs, 60000);
      }
    });
  });

  describe('logging section', () => {
    it('should validate format enum', () => {
      const validFormats = ['pretty', 'json'];
      const invalidFormats = ['invalid', 'xml', 'plain'];

      validFormats.forEach(format => {
        const config = {
          ...baseConfig,
          logging: { format },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, true, `Failed for format: ${format}`);
      });

      invalidFormats.forEach(format => {
        const config = {
          ...baseConfig,
          logging: { format },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, false, `Should fail for format: ${format}`);
      });
    });

    it('should validate level enum', () => {
      const validLevels = ['debug', 'info', 'warn', 'error'];
      const invalidLevels = ['invalid', 'trace', 'verbose'];

      validLevels.forEach(level => {
        const config = {
          ...baseConfig,
          logging: { level },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, true, `Failed for level: ${level}`);
      });

      invalidLevels.forEach(level => {
        const config = {
          ...baseConfig,
          logging: { level },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, false, `Should fail for level: ${level}`);
      });
    });
  });

  describe('circuitBreaker section', () => {
    it('should validate failureThreshold range (1-20)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        circuitBreaker: { failureThreshold: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        circuitBreaker: { failureThreshold: 21 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        circuitBreaker: { failureThreshold: 5 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });

    it('should validate resetTimeoutMs range (10000-300000)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        circuitBreaker: { resetTimeoutMs: 5000 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        circuitBreaker: { resetTimeoutMs: 400000 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        circuitBreaker: { resetTimeoutMs: 60000 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });
  });

  describe('pullRequest section', () => {
    it('should use default values', () => {
      const result = ConfigSchema.safeParse(baseConfig);

      if (result.success) {
        assert.strictEqual(result.data.pullRequest.useDraftPRs, false);
        assert.strictEqual(result.data.pullRequest.autoAssignReviewers, true);
        assert.strictEqual(result.data.pullRequest.generateDescription, true);
        assert.strictEqual(result.data.pullRequest.addCategoryLabels, true);
      }
    });

    it('should validate defaultPriority enum', () => {
      const validPriorities = ['low', 'medium', 'high', 'critical'];
      const invalidPriorities = ['invalid', 'urgent', 'normal'];

      validPriorities.forEach(priority => {
        const config = {
          ...baseConfig,
          pullRequest: { defaultPriority: priority },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, true, `Failed for priority: ${priority}`);
      });

      invalidPriorities.forEach(priority => {
        const config = {
          ...baseConfig,
          pullRequest: { defaultPriority: priority },
        };
        assert.strictEqual(ConfigSchema.safeParse(config).success, false, `Should fail for priority: ${priority}`);
      });
    });

    it('should validate maxReviewers range (1-15)', () => {
      // Below minimum
      let config: any = {
        ...baseConfig,
        pullRequest: { maxReviewers: 0 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Above maximum
      config = {
        ...baseConfig,
        pullRequest: { maxReviewers: 16 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, false);

      // Within range
      config = {
        ...baseConfig,
        pullRequest: { maxReviewers: 5 },
      };
      assert.strictEqual(ConfigSchema.safeParse(config).success, true);
    });
  });
});

describe('validateNoCredentialsInConfig', () => {
  it('should return empty array for clean config', () => {
    const config = {
      repo: {
        owner: 'test',
        name: 'repo',
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.deepStrictEqual(warnings, []);
  });

  it('should detect Anthropic API keys', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        claudeAuth: {
          accessToken: 'sk-ant-api03-xxx',
          refreshToken: 'test',
        },
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.ok(warnings.length > 0);
    assert.ok(warnings.some(w => w.includes('credential')));
  });

  it('should detect GitHub personal access tokens', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        githubToken: 'ghp_xxxxxxxxxxxxxxxxxxxx',
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.ok(warnings.length > 0);
  });

  it('should detect GitHub OAuth tokens', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        githubToken: 'gho_xxxxxxxxxxxxxxxxxxxx',
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.ok(warnings.length > 0);
  });

  it('should detect GitHub PATs', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        githubToken: 'github_pat_xxxxxxxxxxxxxxxxxxxx',
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.ok(warnings.length > 0);
  });

  it('should detect Bearer tokens', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        claudeAuth: {
          accessToken: 'Bearer some_token_here',
          refreshToken: 'test',
        },
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.ok(warnings.length > 0);
  });

  it('should not flag short strings', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      credentials: {
        githubToken: 'short', // Too short to be a real token
      },
    };

    const warnings = validateNoCredentialsInConfig(config);
    assert.deepStrictEqual(warnings, []);
  });

  it('should check nested objects', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
      nested: {
        deep: {
          token: 'ghp_xxxxxxxxxxxxxxxxxxxx',
        },
      },
    };

    const warnings = validateNoCredentialsInConfig(config as any);
    assert.ok(warnings.length > 0);
  });
});

describe('defaultConfig', () => {
  it('should have all default sections', () => {
    assert.ok(defaultConfig.discovery);
    assert.ok(defaultConfig.cache);
    assert.ok(defaultConfig.execution);
    assert.ok(defaultConfig.evaluation);
    assert.ok(defaultConfig.merge);
    assert.ok(defaultConfig.pullRequest);
    assert.ok(defaultConfig.daemon);
    assert.ok(defaultConfig.logging);
    assert.ok(defaultConfig.circuitBreaker);
  });

  it('should have valid discovery defaults', () => {
    assert.strictEqual(defaultConfig.discovery?.tasksPerCycle, 5);
    assert.strictEqual(defaultConfig.discovery?.maxOpenIssues, 10);
    assert.ok(Array.isArray(defaultConfig.discovery?.excludePaths));
    assert.strictEqual(defaultConfig.discovery?.issueLabel, 'autonomous-dev');
  });

  it('should have valid cache defaults', () => {
    assert.strictEqual(defaultConfig.cache?.enabled, true);
    assert.strictEqual(defaultConfig.cache?.maxEntries, 100);
    assert.strictEqual(defaultConfig.cache?.ttlMinutes, 30);
  });

  it('should have valid execution defaults', () => {
    assert.strictEqual(defaultConfig.execution?.parallelWorkers, 4);
    assert.strictEqual(defaultConfig.execution?.timeoutMinutes, 30);
  });

  it('should have valid merge defaults', () => {
    assert.strictEqual(defaultConfig.merge?.autoMerge, true);
    assert.strictEqual(defaultConfig.merge?.mergeMethod, 'squash');
    assert.strictEqual(defaultConfig.merge?.conflictStrategy, 'rebase');
  });

  it('should have valid logging defaults', () => {
    assert.strictEqual(defaultConfig.logging?.format, 'pretty');
    assert.strictEqual(defaultConfig.logging?.level, 'info');
    assert.strictEqual(defaultConfig.logging?.enableStructuredFileLogging, false);
  });
});

describe('Config type', () => {
  it('should match schema output type', () => {
    const config = {
      repo: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
      },
    };

    const result = ConfigSchema.safeParse(config);

    if (result.success) {
      const typedConfig: Config = result.data;
      assert.strictEqual(typedConfig.repo.owner, 'test-owner');
      assert.strictEqual(typedConfig.repo.name, 'test-repo');
    }
  });
});

describe('Full config validation', () => {
  it('should validate a complete valid config', () => {
    const fullConfig = {
      repo: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
      },
      credentials: {}, // Required but can be empty
      discovery: {
        tasksPerCycle: 3,
        maxOpenIssues: 5,
        excludePaths: ['node_modules', 'dist'],
        issueLabel: 'auto-dev',
        maxDepth: 10,
        maxFiles: 5000,
      },
      cache: {
        enabled: true,
        maxEntries: 50,
        ttlMinutes: 60,
        maxSizeMB: 100,
        cacheDir: '.cache',
        persistToDisk: true,
        useGitInvalidation: true,
        enableIncrementalAnalysis: true,
        warmOnStartup: false,
      },
      execution: {
        parallelWorkers: 2,
        timeoutMinutes: 60,
        workDir: '/tmp/work',
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
        mergeMethod: 'squash' as const,
        conflictStrategy: 'rebase' as const,
        maxRetries: 3,
        requireAllChecks: true,
      },
      daemon: {
        loopIntervalMs: 30000,
        pauseBetweenCycles: true,
      },
      logging: {
        format: 'json' as const,
        level: 'info' as const,
        includeCorrelationId: true,
        includeTimestamp: true,
        enableStructuredFileLogging: false,
        structuredLogDir: './logs',
        maxLogFileSizeBytes: 10 * 1024 * 1024,
        maxLogFiles: 5,
        includeMetrics: true,
      },
      circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        baseDelayMs: 100,
        maxDelayMs: 30000,
        successThreshold: 1,
        enabled: true,
      },
    };

    const result = ConfigSchema.safeParse(fullConfig);
    assert.strictEqual(result.success, true);
  });

  it('should fail with multiple invalid fields', () => {
    const invalidConfig = {
      repo: {
        // Missing owner
        name: 'test-repo',
      },
      discovery: {
        tasksPerCycle: 100, // Invalid: too high
        maxDepth: 0, // Invalid: too low
      },
      merge: {
        maxRetries: 10, // Invalid: too high
        mergeMethod: 'invalid', // Invalid: not in enum
      },
    };

    const result = ConfigSchema.safeParse(invalidConfig);
    assert.strictEqual(result.success, false);
  });
});
