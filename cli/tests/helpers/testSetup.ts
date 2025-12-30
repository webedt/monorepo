/**
 * Test setup utilities for CLI command tests
 *
 * Provides helpers for setting up test environments, mocking modules,
 * and capturing console output during tests.
 */

import { mock } from 'node:test';

import type { MockConsole } from './mocks.js';
import { createMockConsole, createMockProcessExit } from './mocks.js';

// ============================================================================
// GLOBAL TEST STATE
// ============================================================================

let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let originalProcessExit: typeof process.exit;
let mockConsole: MockConsole | null = null;
let mockExit: ReturnType<typeof createMockProcessExit> | null = null;

// ============================================================================
// CONSOLE CAPTURE
// ============================================================================

/**
 * Start capturing console output
 */
export function captureConsole(): MockConsole {
  if (!mockConsole) {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    mockConsole = createMockConsole();
    console.log = mockConsole.log;
    console.error = mockConsole.error;
  }
  return mockConsole;
}

/**
 * Stop capturing console output and restore original
 */
export function restoreConsole(): void {
  if (mockConsole) {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    mockConsole = null;
  }
}

/**
 * Get the current mock console (if capturing)
 */
export function getMockConsole(): MockConsole | null {
  return mockConsole;
}

// ============================================================================
// PROCESS.EXIT CAPTURE
// ============================================================================

/**
 * Start capturing process.exit calls
 */
export function captureProcessExit(): ReturnType<typeof createMockProcessExit> {
  if (!mockExit) {
    originalProcessExit = process.exit;
    mockExit = createMockProcessExit();
    process.exit = mockExit.exit;
  }
  return mockExit;
}

/**
 * Stop capturing process.exit and restore original
 */
export function restoreProcessExit(): void {
  if (mockExit) {
    process.exit = originalProcessExit;
    mockExit = null;
  }
}

/**
 * Get the last exit code (if any)
 */
export function getExitCode(): number | null {
  return mockExit?.exitCode ?? null;
}

// ============================================================================
// TEST ENVIRONMENT SETUP
// ============================================================================

/**
 * Set up a clean test environment
 */
export function setupTestEnvironment(): {
  console: MockConsole;
  exit: ReturnType<typeof createMockProcessExit>;
} {
  const console = captureConsole();
  const exit = captureProcessExit();
  return { console, exit };
}

/**
 * Clean up test environment
 */
export function teardownTestEnvironment(): void {
  restoreConsole();
  restoreProcessExit();
  mock.reset();
}

// ============================================================================
// ENVIRONMENT VARIABLE HELPERS
// ============================================================================

const savedEnv: Record<string, string | undefined> = {};

/**
 * Set environment variables for testing (saves originals for restoration)
 */
export function setTestEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key];
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Restore original environment variables
 */
export function restoreTestEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  // Clear saved env
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
}

// ============================================================================
// COMMAND EXECUTION HELPERS
// ============================================================================

/**
 * Result of running a command action
 */
export interface CommandResult {
  output: string;
  errorOutput: string;
  exitCode: number | null;
  error?: Error;
}

/**
 * Run a command action and capture results
 *
 * This helper sets up console capture, runs the action, and returns the results.
 * It handles process.exit() calls gracefully.
 */
export async function runCommandAction(
  action: () => Promise<void>
): Promise<CommandResult> {
  const { console: mockCon, exit: mockExit } = setupTestEnvironment();
  mockCon.reset();

  let error: Error | undefined;

  try {
    await action();
  } catch (err) {
    // Check if it's a process.exit error
    if (err instanceof Error && err.message.startsWith('process.exit(')) {
      // Expected - process.exit was called
    } else {
      error = err as Error;
    }
  }

  const result: CommandResult = {
    output: mockCon.getOutput(),
    errorOutput: mockCon.getErrorOutput(),
    exitCode: mockExit.exitCode,
    error,
  };

  teardownTestEnvironment();

  return result;
}

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/**
 * Check if output contains a string (case-insensitive)
 */
export function outputContains(result: CommandResult, text: string): boolean {
  const combined = (result.output + '\n' + result.errorOutput).toLowerCase();
  return combined.includes(text.toLowerCase());
}

/**
 * Check if output matches a pattern
 */
export function outputMatches(result: CommandResult, pattern: RegExp): boolean {
  const combined = result.output + '\n' + result.errorOutput;
  return pattern.test(combined);
}
