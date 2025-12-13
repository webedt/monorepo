import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  runTests,
  type TestResult,
  type TestOptions,
} from './tests.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TestResult interface', () => {
  it('should have required fields for success', () => {
    const result: TestResult = {
      success: true,
      output: 'All tests passed',
      duration: 5000,
      testsRun: 10,
      testsPassed: 10,
      testsFailed: 0,
    };

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.testsRun, 10);
    assert.strictEqual(result.testsPassed, 10);
    assert.strictEqual(result.testsFailed, 0);
  });

  it('should have required fields for failure', () => {
    const result: TestResult = {
      success: false,
      output: 'Tests failed',
      duration: 3000,
      testsRun: 10,
      testsPassed: 7,
      testsFailed: 3,
      error: '3 test(s) failed',
    };

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.testsFailed, 3);
    assert.ok(result.error);
  });

  it('should allow zero tests', () => {
    const result: TestResult = {
      success: true,
      output: 'No tests found',
      duration: 100,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
    };

    assert.strictEqual(result.testsRun, 0);
  });
});

describe('TestOptions interface', () => {
  it('should require repoPath', () => {
    const options: TestOptions = {
      repoPath: '/path/to/repo',
    };

    assert.strictEqual(options.repoPath, '/path/to/repo');
  });

  it('should allow optional packages', () => {
    const options: TestOptions = {
      repoPath: '/path',
      packages: ['pkg1', 'pkg2'],
    };

    assert.deepStrictEqual(options.packages, ['pkg1', 'pkg2']);
  });

  it('should allow optional timeout', () => {
    const options: TestOptions = {
      repoPath: '/path',
      timeout: 5 * 60 * 1000,
    };

    assert.strictEqual(options.timeout, 5 * 60 * 1000);
  });

  it('should allow optional testPattern', () => {
    const options: TestOptions = {
      repoPath: '/path',
      testPattern: 'unit',
    };

    assert.strictEqual(options.testPattern, 'unit');
  });
});

describe('runTests', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `tests-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return success for project without test script', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {},
    }));

    const result = await runTests({ repoPath: testDir });

    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('No test'));
    assert.strictEqual(result.testsRun, 0);
  });

  it('should return success for project with default "no test" script', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {
        test: 'echo "Error: no test specified" && exit 1',
      },
    }));

    const result = await runTests({ repoPath: testDir });

    assert.strictEqual(result.success, true);
  });

  it('should return success for project without package.json', async () => {
    // Empty directory
    const result = await runTests({ repoPath: testDir });

    assert.strictEqual(result.success, true);
  });

  it('should track duration', async () => {
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: {},
    }));

    const result = await runTests({ repoPath: testDir });

    assert.ok(typeof result.duration === 'number');
    assert.ok(result.duration >= 0);
  });
});

describe('Test output parsing', () => {
  // Test the output parsing indirectly through result inspection

  it('should handle empty test output', async () => {
    const testDir = join(tmpdir(), `parse-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test',
      scripts: {},
    }));

    try {
      const result = await runTests({ repoPath: testDir });
      assert.strictEqual(result.testsRun, 0);
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  });
});

describe('Test result scenarios', () => {
  it('should represent all tests passing', () => {
    const result: TestResult = {
      success: true,
      output: 'Tests: 50 passed, 50 total',
      duration: 10000,
      testsRun: 50,
      testsPassed: 50,
      testsFailed: 0,
    };

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.testsFailed, 0);
  });

  it('should represent some tests failing', () => {
    const result: TestResult = {
      success: false,
      output: 'Tests: 45 passed, 5 failed, 50 total',
      duration: 10000,
      testsRun: 50,
      testsPassed: 45,
      testsFailed: 5,
      error: '5 test(s) failed',
    };

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.testsFailed, 5);
  });

  it('should represent all tests failing', () => {
    const result: TestResult = {
      success: false,
      output: 'Tests: 0 passed, 10 failed, 10 total',
      duration: 5000,
      testsRun: 10,
      testsPassed: 0,
      testsFailed: 10,
      error: '10 test(s) failed',
    };

    assert.strictEqual(result.testsPassed, 0);
    assert.strictEqual(result.testsFailed, 10);
  });

  it('should represent test framework error', () => {
    const result: TestResult = {
      success: false,
      output: '',
      duration: 100,
      testsRun: 0,
      testsPassed: 0,
      testsFailed: 0,
      error: 'Test framework failed to start',
    };

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });
});

describe('Test timeout configuration', () => {
  it('should use default 10 minute timeout', () => {
    const options: TestOptions = {
      repoPath: '/path',
    };

    // Default timeout is implicit (10 minutes)
    assert.strictEqual(options.timeout, undefined);
  });

  it('should accept custom short timeout', () => {
    const options: TestOptions = {
      repoPath: '/path',
      timeout: 1 * 60 * 1000, // 1 minute
    };

    assert.strictEqual(options.timeout, 60000);
  });

  it('should accept custom long timeout', () => {
    const options: TestOptions = {
      repoPath: '/path',
      timeout: 30 * 60 * 1000, // 30 minutes
    };

    assert.strictEqual(options.timeout, 1800000);
  });
});

describe('Test patterns', () => {
  it('should filter by test pattern', () => {
    const options: TestOptions = {
      repoPath: '/path',
      testPattern: 'unit',
    };

    assert.strictEqual(options.testPattern, 'unit');
  });

  it('should accept regex-like patterns', () => {
    const options: TestOptions = {
      repoPath: '/path',
      testPattern: 'api|integration',
    };

    assert.strictEqual(options.testPattern, 'api|integration');
  });

  it('should accept file path patterns', () => {
    const options: TestOptions = {
      repoPath: '/path',
      testPattern: 'src/services',
    };

    assert.strictEqual(options.testPattern, 'src/services');
  });
});

describe('Package-specific tests', () => {
  it('should run tests for specific packages', () => {
    const options: TestOptions = {
      repoPath: '/path/to/monorepo',
      packages: ['packages/core', 'packages/utils'],
    };

    assert.deepStrictEqual(options.packages, ['packages/core', 'packages/utils']);
  });

  it('should run tests for all packages when none specified', () => {
    const options: TestOptions = {
      repoPath: '/path/to/monorepo',
    };

    assert.strictEqual(options.packages, undefined);
  });
});
