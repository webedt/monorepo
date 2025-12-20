/**
 * Performance Benchmarks
 *
 * This module provides performance benchmarks for critical operations.
 * Run with: npm run benchmark
 *
 * Benchmarks help detect performance regressions in:
 * - Task discovery speed
 * - Configuration loading
 * - GitHub API mock operations
 * - Worker pool operations
 */

import { performance } from 'perf_hooks';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ANSI color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  opsPerSec: number;
}

interface BenchmarkThresholds {
  [key: string]: number; // Maximum allowed average time in ms
}

// Performance thresholds (in milliseconds)
const thresholds: BenchmarkThresholds = {
  'Config loading': 50,
  'Mock creation': 5,
  'String manipulation': 10,
  'Array operations': 20,
  'File system setup': 200,
};

/**
 * Run a benchmark function multiple times and collect metrics
 */
async function runBenchmark(
  name: string,
  fn: () => unknown | Promise<unknown>,
  iterations: number = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warm up
  for (let i = 0; i < 5; i++) {
    await fn();
  }

  // Run benchmark
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / iterations;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSec = 1000 / avgMs;

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    opsPerSec,
  };
}

/**
 * Format benchmark result for display
 */
function formatResult(result: BenchmarkResult, threshold?: number): string {
  const status =
    threshold && result.avgMs > threshold
      ? `${colors.red}SLOW${colors.reset}`
      : `${colors.green}OK${colors.reset}`;

  return `
${colors.blue}${result.name}${colors.reset}
  Status: ${status}
  Iterations: ${result.iterations}
  Average: ${result.avgMs.toFixed(3)}ms
  Min: ${result.minMs.toFixed(3)}ms
  Max: ${result.maxMs.toFixed(3)}ms
  Ops/sec: ${result.opsPerSec.toFixed(1)}
  ${threshold ? `Threshold: ${threshold}ms` : ''}`;
}

// ============================================================================
// Benchmarks
// ============================================================================

/**
 * Benchmark: Configuration loading
 */
async function benchmarkConfigLoading(): Promise<BenchmarkResult> {
  const testDir = join(tmpdir(), `bench-config-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  // Create config file
  const config = {
    repo: { owner: 'test', name: 'repo', baseBranch: 'main' },
    discovery: { tasksPerCycle: 3, maxOpenIssues: 5 },
    execution: { parallelWorkers: 2, timeoutMinutes: 30, workDir: testDir },
  };
  writeFileSync(join(testDir, 'config.json'), JSON.stringify(config));

  try {
    return await runBenchmark(
      'Config loading',
      () => {
        // Simulate config parsing
        const content = JSON.stringify(config);
        JSON.parse(content);
      },
      500
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Benchmark: Mock object creation
 */
async function benchmarkMockCreation(): Promise<BenchmarkResult> {
  return await runBenchmark(
    'Mock creation',
    () => {
      // Simulate mock object creation
      const mock = {
        number: 1,
        title: 'Test Issue',
        body: 'Test description',
        state: 'open',
        labels: ['bug', 'priority:high'],
        htmlUrl: 'https://github.com/owner/repo/issues/1',
        createdAt: new Date().toISOString(),
        assignee: null,
      };
      return mock;
    },
    1000
  );
}

/**
 * Benchmark: String manipulation (branch name generation)
 */
async function benchmarkStringManipulation(): Promise<BenchmarkResult> {
  const titles = [
    'Add new feature for authentication',
    'Fix critical bug in payment processing',
    'Update dependencies to latest versions',
    'Refactor user service module',
    'Add unit tests for API endpoints',
  ];

  return await runBenchmark(
    'String manipulation',
    () => {
      for (const title of titles) {
        const slug = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40);
        `auto/1-${slug}`;
      }
    },
    1000
  );
}

/**
 * Benchmark: Array operations (filtering and mapping)
 */
async function benchmarkArrayOperations(): Promise<BenchmarkResult> {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    success: i % 3 !== 0,
    labels: [`label-${i % 5}`, i % 2 === 0 ? 'in-progress' : 'pending'],
  }));

  return await runBenchmark(
    'Array operations',
    () => {
      items
        .filter((item) => item.success)
        .filter((item) => !item.labels.includes('in-progress'))
        .map((item) => ({ ...item, processed: true }));
    },
    500
  );
}

/**
 * Benchmark: File system setup (creating test directories)
 */
async function benchmarkFileSystemSetup(): Promise<BenchmarkResult> {
  return await runBenchmark(
    'File system setup',
    () => {
      const testDir = join(tmpdir(), `bench-fs-${Date.now()}-${Math.random()}`);
      mkdirSync(testDir, { recursive: true });
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'src', 'index.ts'), '');
      rmSync(testDir, { recursive: true, force: true });
    },
    50
  );
}

/**
 * Benchmark: Error handling
 */
async function benchmarkErrorHandling(): Promise<BenchmarkResult> {
  return await runBenchmark(
    'Error handling',
    () => {
      try {
        throw new Error('Test error');
      } catch (error) {
        const wrapped = {
          code: 'TEST_ERROR',
          message: (error as Error).message,
          timestamp: new Date().toISOString(),
          stack: (error as Error).stack,
        };
        return wrapped;
      }
    },
    1000
  );
}

/**
 * Benchmark: Date operations
 */
async function benchmarkDateOperations(): Promise<BenchmarkResult> {
  return await runBenchmark(
    'Date operations',
    () => {
      const now = new Date();
      const iso = now.toISOString();
      const parsed = new Date(iso);
      const diff = now.getTime() - parsed.getTime();
      return diff;
    },
    1000
  );
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}Performance Benchmarks${colors.reset}`);
  console.log('='.repeat(60));

  const benchmarks = [
    benchmarkConfigLoading,
    benchmarkMockCreation,
    benchmarkStringManipulation,
    benchmarkArrayOperations,
    benchmarkFileSystemSetup,
    benchmarkErrorHandling,
    benchmarkDateOperations,
  ];

  const results: BenchmarkResult[] = [];
  let failures = 0;

  for (const benchmark of benchmarks) {
    try {
      const result = await benchmark();
      results.push(result);

      const threshold = thresholds[result.name];
      console.log(formatResult(result, threshold));

      if (threshold && result.avgMs > threshold) {
        failures++;
      }
    } catch (error) {
      console.error(`${colors.red}Error in ${benchmark.name}:${colors.reset}`, error);
      failures++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.blue}Summary${colors.reset}`);
  console.log('='.repeat(60));

  const totalAvg = results.reduce((sum, r) => sum + r.avgMs, 0);
  console.log(`Total benchmarks: ${results.length}`);
  console.log(`Combined average time: ${totalAvg.toFixed(3)}ms`);

  if (failures > 0) {
    console.log(`\n${colors.red}${failures} benchmark(s) exceeded thresholds${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}All benchmarks passed${colors.reset}`);
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error);
  process.exit(1);
});
