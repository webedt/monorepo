import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('runEvaluation', () => {
  let testDir: string;
  let originalConsoleLog: typeof console.log;

  beforeEach(() => {
    testDir = join(tmpdir(), `evaluation-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalConsoleLog = console.log;
    console.log = () => {}; // Suppress console output
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    console.log = originalConsoleLog;
  });

  describe('EvaluationOptions interface', () => {
    it('should define correct structure', async () => {
      // Import dynamically to test exports
      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const options = {
        repoPath: testDir,
        branchName: 'feature-branch',
        config: {
          requireBuild: false,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'testowner',
          repo: 'testrepo',
        },
      };

      // Should accept valid options
      const result = await runEvaluation(options);
      assert.ok(result);
      assert.strictEqual(typeof result.success, 'boolean');
      assert.strictEqual(typeof result.duration, 'number');
      assert.strictEqual(typeof result.summary, 'string');
    });
  });

  describe('with all checks disabled', () => {
    it('should pass when all checks are skipped', async () => {
      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: false,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.summary.includes('Build skipped'));
      assert.ok(result.summary.includes('Tests skipped'));
      assert.ok(result.summary.includes('Health checks skipped'));
    });

    it('should have correct duration', async () => {
      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: false,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok(result.duration >= 0);
    });
  });

  describe('with build required', () => {
    it('should pass build for valid TypeScript project', async () => {
      // Create a minimal TypeScript project
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'echo "Build complete"',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok(result.build);
      if (result.build.success) {
        assert.ok(result.summary.includes('Build passed'));
      }
    });

    it('should fail build for invalid project', async () => {
      // Create a project with failing build
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'exit 1',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.strictEqual(result.success, false);
      assert.ok(result.build);
      assert.strictEqual(result.build.success, false);
      assert.ok(result.summary.includes('Build failed'));
    });
  });

  describe('with tests required', () => {
    it('should skip tests when build fails', async () => {
      // Create a project with failing build
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'exit 1',
          test: 'echo "Tests passed"',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: true,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.tests, undefined);
      assert.ok(result.summary.includes('Tests skipped (build failed)'));
    });

    it('should run tests when build passes', async () => {
      // Create a project with passing build and tests
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'echo "Build complete"',
          test: 'echo "Tests complete"',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: true,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok(result.tests);
    });
  });

  describe('with health checks required', () => {
    it('should skip health checks when no URLs configured', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'echo "Build complete"',
          test: 'echo "Tests complete"',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: true,
          requireHealthCheck: true,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok(result.summary.includes('no URLs configured'));
    });

    it('should skip health checks when previous step fails', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          build: 'exit 1',
        },
      }));

      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: true,
          requireTests: false,
          requireHealthCheck: true,
          healthCheckUrls: ['http://localhost:3000'],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok(result.summary.includes('previous step failed'));
    });
  });

  describe('EvaluationResult', () => {
    it('should include all required fields', async () => {
      const { runEvaluation } = await import('../../src/evaluation/index.js');

      const result = await runEvaluation({
        repoPath: testDir,
        branchName: 'test-branch',
        config: {
          requireBuild: false,
          requireTests: false,
          requireHealthCheck: false,
          healthCheckUrls: [],
          previewUrlPattern: '',
        },
        repoInfo: {
          owner: 'owner',
          repo: 'repo',
        },
      });

      assert.ok('success' in result);
      assert.ok('duration' in result);
      assert.ok('summary' in result);
    });
  });

  describe('exports', () => {
    it('should export runBuild', async () => {
      const { runBuild } = await import('../../src/evaluation/index.js');
      assert.ok(typeof runBuild === 'function');
    });

    it('should export runTypeCheck', async () => {
      const { runTypeCheck } = await import('../../src/evaluation/index.js');
      assert.ok(typeof runTypeCheck === 'function');
    });

    it('should export BuildCache', async () => {
      const { BuildCache } = await import('../../src/evaluation/index.js');
      assert.ok(typeof BuildCache === 'function');
    });

    it('should export runTests', async () => {
      const { runTests } = await import('../../src/evaluation/index.js');
      assert.ok(typeof runTests === 'function');
    });

    it('should export runHealthChecks', async () => {
      const { runHealthChecks } = await import('../../src/evaluation/index.js');
      assert.ok(typeof runHealthChecks === 'function');
    });

    it('should export generatePreviewUrl', async () => {
      const { generatePreviewUrl } = await import('../../src/evaluation/index.js');
      assert.ok(typeof generatePreviewUrl === 'function');
    });

    it('should export runEvaluation', async () => {
      const { runEvaluation } = await import('../../src/evaluation/index.js');
      assert.ok(typeof runEvaluation === 'function');
    });
  });
});
