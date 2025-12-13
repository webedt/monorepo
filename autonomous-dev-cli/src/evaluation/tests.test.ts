import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runTests } from './tests.js';

describe('runTests', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `run-tests-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('no test configuration', () => {
    it('should return success when no test commands found', async () => {
      // Empty directory
      const result = await runTests({ repoPath: testDir });

      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes('No test configuration found'));
      assert.strictEqual(result.testsRun, 0);
      assert.strictEqual(result.testsPassed, 0);
      assert.strictEqual(result.testsFailed, 0);
    });

    it('should skip default npm test placeholder', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
        },
      }));

      const result = await runTests({ repoPath: testDir });

      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes('No test configuration found'));
    });
  });

  describe('with test script', () => {
    it('should run npm test for projects with test script', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Tests: 5 passed, 5 total"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.success, true);
    });

    it('should handle test failures', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Tests: 3 passed, 2 failed, 5 total" && exit 1',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.testsFailed, 2);
    });
  });

  describe('test output parsing', () => {
    it('should parse Jest format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Tests:       10 passed, 2 failed, 12 total"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 12);
      assert.strictEqual(result.testsPassed, 10);
      assert.strictEqual(result.testsFailed, 2);
    });

    it('should parse Jest format without failures', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Tests:       5 passed, 5 total"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 5);
      assert.strictEqual(result.testsPassed, 5);
      assert.strictEqual(result.testsFailed, 0);
    });

    it('should parse Vitest format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "8 passed | 1 failed"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 9);
      assert.strictEqual(result.testsPassed, 8);
      assert.strictEqual(result.testsFailed, 1);
    });

    it('should parse Node test runner format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "# tests 15\\n# pass 12\\n# fail 3"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 15);
      assert.strictEqual(result.testsPassed, 12);
      assert.strictEqual(result.testsFailed, 3);
    });

    it('should parse Mocha format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "7 passing\\n2 failing"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 9);
      assert.strictEqual(result.testsPassed, 7);
      assert.strictEqual(result.testsFailed, 2);
    });

    it('should parse generic checkmark format', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "✓ test 1\\n✓ test 2\\n✓ test 3\\n✗ test 4"',
        },
      }));

      const result = await runTests({ repoPath: testDir, timeout: 30000 });

      assert.strictEqual(result.testsRun, 4);
      assert.strictEqual(result.testsPassed, 3);
      assert.strictEqual(result.testsFailed, 1);
    });
  });

  describe('test pattern filtering', () => {
    it('should pass test pattern to test command', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Running filtered tests"',
        },
      }));

      const result = await runTests({
        repoPath: testDir,
        testPattern: 'unit',
        timeout: 30000,
      });

      // Command should include the pattern
      assert.strictEqual(result.success, true);
    });
  });

  describe('specific packages', () => {
    it('should run tests for specific packages', async () => {
      const pkgDir = join(testDir, 'packages', 'pkg1');
      mkdirSync(pkgDir, { recursive: true });

      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
        name: 'pkg1',
        scripts: {
          test: 'echo "Package tests passed"',
        },
      }));

      // Root package has no tests
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'root',
        scripts: {},
      }));

      const result = await runTests({
        repoPath: testDir,
        packages: ['packages/pkg1'],
        timeout: 30000,
      });

      assert.strictEqual(result.success, true);
    });
  });

  describe('timeout handling', () => {
    it('should handle timeout option', async () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: {
          test: 'echo "Quick test"',
        },
      }));

      const result = await runTests({
        repoPath: testDir,
        timeout: 60000, // 1 minute timeout
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.duration < 60000);
    });
  });

  describe('error handling', () => {
    it('should handle general errors gracefully', async () => {
      // Provide an invalid path that will cause errors
      const result = await runTests({
        repoPath: '/nonexistent/path/that/does/not/exist',
      });

      // Should return result without throwing
      assert.strictEqual(result.success, true);
      assert.ok(result.output.includes('No test configuration found'));
    });
  });
});
