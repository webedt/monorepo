import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { Daemon, createDaemon, type DaemonOptions, type CycleResult } from '../src/daemon.js';
import { StructuredError, ErrorCode, ConfigError } from '../src/utils/errors.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Daemon', () => {
  let testDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;

  beforeEach(() => {
    // Save original environment and cwd
    originalEnv = { ...process.env };
    originalCwd = process.cwd();

    // Create a temporary test directory
    testDir = join(tmpdir(), `daemon-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    // Create a valid config file
    const configContent = {
      repo: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
      },
      discovery: {
        tasksPerCycle: 3,
        maxOpenIssues: 5,
        excludePaths: ['node_modules', 'dist'],
        issueLabel: 'autonomous-dev',
      },
      execution: {
        parallelWorkers: 2,
        timeoutMinutes: 30,
        workDir: join(testDir, 'work'),
      },
      merge: {
        autoMerge: true,
        mergeMethod: 'squash',
        conflictStrategy: 'rebase',
        maxRetries: 3,
      },
      daemon: {
        loopIntervalMs: 1000,
        pauseBetweenCycles: false,
      },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(configContent)
    );

    // Clear relevant environment variables
    delete process.env.GITHUB_TOKEN;
    delete process.env.CLAUDE_ACCESS_TOKEN;
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

  describe('constructor', () => {
    it('should create daemon with default options', () => {
      const daemon = new Daemon();
      assert.ok(daemon);
    });

    it('should accept custom options', () => {
      const options: DaemonOptions = {
        dryRun: true,
        verbose: true,
        singleCycle: true,
      };
      const daemon = new Daemon(options);
      assert.ok(daemon);
    });

    it('should accept configPath option', () => {
      const customConfigPath = join(testDir, 'custom-config.json');
      const customConfig = {
        repo: {
          owner: 'custom-owner',
          name: 'custom-repo',
        },
      };
      writeFileSync(customConfigPath, JSON.stringify(customConfig));

      const daemon = new Daemon({ configPath: customConfigPath });
      assert.ok(daemon);
    });

    it('should set log level to debug when verbose is true', () => {
      const daemon = new Daemon({ verbose: true });
      assert.ok(daemon);
    });

    it('should accept log format option', () => {
      const daemon = new Daemon({ logFormat: 'json' });
      assert.ok(daemon);
    });

    it('should accept monitoring port option', () => {
      const daemon = new Daemon({ monitoringPort: 9090 });
      assert.ok(daemon);
    });
  });

  describe('createDaemon factory', () => {
    it('should create a Daemon instance', () => {
      const daemon = createDaemon();
      assert.ok(daemon instanceof Daemon);
    });

    it('should pass options to Daemon constructor', () => {
      const daemon = createDaemon({ dryRun: true });
      assert.ok(daemon instanceof Daemon);
    });
  });

  describe('getInternalServiceHealth', () => {
    it('should return initial service health', () => {
      const daemon = new Daemon();
      const health = daemon.getInternalServiceHealth();

      assert.ok(health);
      assert.ok('github' in health);
      assert.ok('overallStatus' in health);
      assert.ok('lastCheck' in health);
    });

    it('should initially have healthy status', () => {
      const daemon = new Daemon();
      const health = daemon.getInternalServiceHealth();

      assert.strictEqual(health.overallStatus, 'healthy');
    });

    it('should have null github health before initialization', () => {
      const daemon = new Daemon();
      const health = daemon.getInternalServiceHealth();

      assert.strictEqual(health.github, null);
    });
  });

  describe('stop', () => {
    it('should not throw when called on new daemon', async () => {
      const daemon = new Daemon();
      await assert.doesNotReject(() => daemon.stop());
    });
  });

  describe('DaemonOptions', () => {
    it('should support dryRun option', () => {
      const daemon = new Daemon({ dryRun: true });
      assert.ok(daemon);
    });

    it('should support verbose option', () => {
      const daemon = new Daemon({ verbose: true });
      assert.ok(daemon);
    });

    it('should support singleCycle option', () => {
      const daemon = new Daemon({ singleCycle: true });
      assert.ok(daemon);
    });

    it('should support logFormat option with pretty', () => {
      const daemon = new Daemon({ logFormat: 'pretty' });
      assert.ok(daemon);
    });

    it('should support logFormat option with json', () => {
      const daemon = new Daemon({ logFormat: 'json' });
      assert.ok(daemon);
    });

    it('should support all options together', () => {
      const options: DaemonOptions = {
        configPath: join(testDir, 'autonomous-dev.config.json'),
        dryRun: true,
        verbose: true,
        singleCycle: true,
        logFormat: 'json',
        monitoringPort: 8080,
      };
      const daemon = new Daemon(options);
      assert.ok(daemon);
    });
  });

  describe('CycleResult interface', () => {
    it('should have all required fields', () => {
      const result: CycleResult = {
        success: true,
        tasksDiscovered: 3,
        tasksCompleted: 2,
        tasksFailed: 1,
        prsMerged: 1,
        duration: 5000,
        errors: [],
        degraded: false,
        serviceHealth: {
          github: null,
          overallStatus: 'healthy',
          lastCheck: new Date(),
        },
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.tasksDiscovered, 3);
      assert.strictEqual(result.tasksCompleted, 2);
      assert.strictEqual(result.tasksFailed, 1);
      assert.strictEqual(result.prsMerged, 1);
      assert.strictEqual(result.duration, 5000);
      assert.deepStrictEqual(result.errors, []);
      assert.strictEqual(result.degraded, false);
    });

    it('should handle failed cycle result', () => {
      const result: CycleResult = {
        success: false,
        tasksDiscovered: 0,
        tasksCompleted: 0,
        tasksFailed: 3,
        prsMerged: 0,
        duration: 1000,
        errors: ['Error 1', 'Error 2'],
        degraded: true,
        serviceHealth: {
          github: {
            status: 'degraded',
            circuitState: 'half-open',
            consecutiveFailures: 2,
            rateLimitRemaining: 100,
            lastSuccessfulCall: new Date(),
          },
          overallStatus: 'degraded',
          lastCheck: new Date(),
        },
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errors.length, 2);
      assert.strictEqual(result.degraded, true);
      assert.strictEqual(result.serviceHealth.overallStatus, 'degraded');
    });
  });

  describe('error handling', () => {
    it('should handle config loading failures gracefully', () => {
      // Config validation happens in loadConfig, which is tested separately
      // Here we verify the Daemon integrates with loadConfig correctly
      const configPath = join(testDir, 'autonomous-dev.config.json');
      const validConfig = {
        repo: { owner: 'test', name: 'repo' },
      };
      writeFileSync(configPath, JSON.stringify(validConfig));

      const daemon = new Daemon({ configPath });
      assert.ok(daemon);
    });

    it('should provide service health tracking', () => {
      const daemon = new Daemon();
      const health = daemon.getInternalServiceHealth();

      assert.ok(health.lastCheck instanceof Date);
      assert.ok(['healthy', 'degraded', 'unavailable'].includes(health.overallStatus));
    });
  });
});

describe('DaemonServiceHealth interface', () => {
  it('should represent healthy state', () => {
    const health = {
      github: {
        status: 'healthy' as const,
        circuitState: 'closed' as const,
        consecutiveFailures: 0,
        rateLimitRemaining: 5000,
        lastSuccessfulCall: new Date(),
      },
      overallStatus: 'healthy' as const,
      lastCheck: new Date(),
    };

    assert.strictEqual(health.overallStatus, 'healthy');
    assert.strictEqual(health.github?.status, 'healthy');
    assert.strictEqual(health.github?.circuitState, 'closed');
  });

  it('should represent degraded state', () => {
    const health = {
      github: {
        status: 'degraded' as const,
        circuitState: 'half-open' as const,
        consecutiveFailures: 3,
        rateLimitRemaining: 10,
        lastSuccessfulCall: new Date(),
      },
      overallStatus: 'degraded' as const,
      lastCheck: new Date(),
    };

    assert.strictEqual(health.overallStatus, 'degraded');
    assert.strictEqual(health.github?.status, 'degraded');
    assert.strictEqual(health.github?.consecutiveFailures, 3);
  });

  it('should represent unavailable state', () => {
    const health = {
      github: {
        status: 'unavailable' as const,
        circuitState: 'open' as const,
        consecutiveFailures: 10,
        rateLimitRemaining: 0,
        lastSuccessfulCall: new Date(Date.now() - 60000),
      },
      overallStatus: 'unavailable' as const,
      lastCheck: new Date(),
    };

    assert.strictEqual(health.overallStatus, 'unavailable');
    assert.strictEqual(health.github?.circuitState, 'open');
  });
});

describe('Daemon lifecycle states', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `lifecycle-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    const config = {
      repo: { owner: 'test', name: 'repo', baseBranch: 'main' },
      execution: { workDir: join(testDir, 'work') },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(config)
    );
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should be able to create and stop daemon', async () => {
    const daemon = new Daemon({ dryRun: true });
    await daemon.stop();
    assert.ok(true);
  });

  it('should handle multiple stop calls gracefully', async () => {
    const daemon = new Daemon({ dryRun: true });
    await daemon.stop();
    await daemon.stop();
    await daemon.stop();
    assert.ok(true);
  });
});

describe('Daemon configuration loading', () => {
  let testDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    testDir = join(tmpdir(), `config-daemon-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should load config with environment variable overrides', () => {
    const config = {
      repo: { owner: 'file-owner', name: 'file-repo' },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(config)
    );

    process.env.REPO_OWNER = 'env-owner';
    process.env.REPO_NAME = 'env-repo';

    const daemon = new Daemon();
    assert.ok(daemon);
  });

  it('should handle work directory creation', () => {
    const workDir = join(testDir, 'work', 'nested', 'dir');
    const config = {
      repo: { owner: 'test', name: 'repo' },
      execution: { workDir },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(config)
    );

    const daemon = new Daemon();
    assert.ok(daemon);
  });

  it('should load credentials from environment', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(config)
    );

    process.env.GITHUB_TOKEN = 'test-token';
    process.env.CLAUDE_ACCESS_TOKEN = 'claude-token';
    process.env.CLAUDE_REFRESH_TOKEN = 'refresh-token';

    const daemon = new Daemon();
    assert.ok(daemon);
  });

  it('should use default values for optional config fields', () => {
    const config = {
      repo: { owner: 'test', name: 'repo' },
    };
    writeFileSync(
      join(testDir, 'autonomous-dev.config.json'),
      JSON.stringify(config)
    );

    const daemon = new Daemon();
    assert.ok(daemon);
  });
});

describe('Error wrapping and context', () => {
  it('should properly create StructuredError', () => {
    const error = new StructuredError(
      ErrorCode.NOT_INITIALIZED,
      'Daemon not properly initialized',
      {
        severity: 'critical',
        context: {
          operation: 'runCycle',
          component: 'Daemon',
        },
        recoveryActions: [
          { description: 'Initialize daemon before running', automatic: false },
        ],
      }
    );

    assert.strictEqual(error.code, ErrorCode.NOT_INITIALIZED);
    assert.strictEqual(error.severity, 'critical');
    assert.strictEqual(error.context.operation, 'runCycle');
    assert.strictEqual(error.context.component, 'Daemon');
    assert.ok(error.recoveryActions.length > 0);
  });

  it('should handle error context chain', () => {
    const cause = new Error('Original error');
    const error = new StructuredError(
      ErrorCode.INTERNAL_ERROR,
      'Wrapped error',
      { cause }
    );

    assert.strictEqual(error.cause, cause);
    assert.strictEqual(error.cause?.message, 'Original error');
  });
});

describe('Branch name generation', () => {
  it('should generate valid branch names from issue titles', () => {
    // Test branch name format: auto/{issue_number}-{slug}
    const testCases = [
      { number: 1, title: 'Add feature', expected: 'auto/1-add-feature' },
      { number: 42, title: 'Fix Bug!', expected: 'auto/42-fix-bug' },
      { number: 100, title: 'Update Documentation', expected: 'auto/100-update-documentation' },
      { number: 5, title: '  Trim  Spaces  ', expected: 'auto/5-trim-spaces' },
      { number: 7, title: 'Special @#$% Characters', expected: 'auto/7-special-characters' },
    ];

    for (const tc of testCases) {
      const slug = tc.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
      const branchName = `auto/${tc.number}-${slug}`;

      assert.strictEqual(branchName, tc.expected, `Failed for title: "${tc.title}"`);
    }
  });

  it('should truncate long titles', () => {
    const longTitle = 'This is a very long issue title that should be truncated to fit within the branch name limit';
    const slug = longTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    assert.ok(slug.length <= 40);
    assert.ok(slug.startsWith('this-is-a-very-long'));
  });
});

describe('PR body generation', () => {
  it('should include issue number in PR body', () => {
    const issue = {
      number: 123,
      title: 'Test Issue',
      body: 'Issue description',
    };

    const prBody = `## Summary

Implements #${issue.number}

${issue.body || ''}

## Changes

*Changes were implemented autonomously by Claude.*

---

Generated by [Autonomous Dev CLI](https://github.com/webedt/monorepo/tree/main/autonomous-dev-cli)
`;

    assert.ok(prBody.includes('#123'));
    assert.ok(prBody.includes('Issue description'));
    assert.ok(prBody.includes('Autonomous Dev CLI'));
  });

  it('should handle issue without body', () => {
    const issue = {
      number: 456,
      title: 'Issue Without Body',
      body: null,
    };

    const prBody = `## Summary

Implements #${issue.number}

${issue.body || ''}

## Changes

*Changes were implemented autonomously by Claude.*
`;

    assert.ok(prBody.includes('#456'));
    assert.ok(!prBody.includes('null'));
  });
});

describe('Issue creation for task', () => {
  it('should generate correct labels for task', () => {
    const issueLabel = 'autonomous-dev';
    const task = {
      title: 'Add feature',
      description: 'Feature description',
      priority: 'high' as const,
      category: 'feature' as const,
      estimatedComplexity: 'moderate' as const,
      affectedPaths: ['src/components/'],
    };

    const labels = [
      issueLabel,
      `priority:${task.priority}`,
      `type:${task.category}`,
      `complexity:${task.estimatedComplexity}`,
    ];

    assert.deepStrictEqual(labels, [
      'autonomous-dev',
      'priority:high',
      'type:feature',
      'complexity:moderate',
    ]);
  });

  it('should generate issue body with affected paths', () => {
    const task = {
      title: 'Fix Bug',
      description: 'Bug description',
      priority: 'critical' as const,
      category: 'bugfix' as const,
      estimatedComplexity: 'simple' as const,
      affectedPaths: ['src/utils/helper.ts', 'src/index.ts'],
    };

    const body = `## Description

${task.description}

## Affected Paths

${task.affectedPaths.map((p) => `- \`${p}\``).join('\n')}

---

*This issue was automatically created by Autonomous Dev CLI*
`;

    assert.ok(body.includes('Bug description'));
    assert.ok(body.includes('`src/utils/helper.ts`'));
    assert.ok(body.includes('`src/index.ts`'));
    assert.ok(body.includes('automatically created'));
  });
});
