/**
 * Jest Setup File
 *
 * This file runs before each test suite to configure the test environment.
 * It sets up global mocks, extends expect matchers, and configures test utilities.
 *
 * Note: This file is only used when running tests with Jest (npm run test:jest).
 * The Node.js native test runner (npm test) does not use this file.
 */

// Set test environment
process.env.NODE_ENV = 'test';

// Store original console methods for restoration
const originalConsole = { ...console };

// Expose original console globally for tests that need it
(global as Record<string, unknown>).originalConsole = originalConsole;

// The following code only executes when Jest is present
// TypeScript will type-check this file even without Jest installed,
// so we need to use dynamic checks

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = global as any;

if (typeof globalAny.jest !== 'undefined') {
  // Increase timeout for integration tests
  globalAny.jest.setTimeout(30000);

  // Custom matchers for common assertions
  if (typeof globalAny.expect?.extend === 'function') {
    globalAny.expect.extend({
      /**
       * Check if a value is a valid ISO date string
       */
      toBeValidISODate(received: string) {
        const date = new Date(received);
        const isValid = !isNaN(date.getTime()) && received === date.toISOString();

        return {
          pass: isValid,
          message: () =>
            isValid
              ? `expected ${received} not to be a valid ISO date string`
              : `expected ${received} to be a valid ISO date string`,
        };
      },

      /**
       * Check if an error has a specific error code
       */
      toHaveErrorCode(received: Error & { code?: string }, expectedCode: string) {
        const hasCode = received.code === expectedCode;

        return {
          pass: hasCode,
          message: () =>
            hasCode
              ? `expected error not to have code ${expectedCode}`
              : `expected error to have code ${expectedCode}, but got ${received.code || 'no code'}`,
        };
      },

      /**
       * Check if an async function completes within a timeout
       */
      async toCompleteWithin(received: Promise<unknown>, timeoutMs: number) {
        const startTime = Date.now();
        try {
          await Promise.race([
            received,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), timeoutMs)
            ),
          ]);
          const elapsed = Date.now() - startTime;
          return {
            pass: elapsed <= timeoutMs,
            message: () =>
              `expected promise to complete within ${timeoutMs}ms, completed in ${elapsed}ms`,
          };
        } catch {
          return {
            pass: false,
            message: () =>
              `expected promise to complete within ${timeoutMs}ms, but it timed out or rejected`,
          };
        }
      },
    });
  }

  // Optionally suppress console output during tests
  if (process.env.SUPPRESS_CONSOLE_LOGS === 'true') {
    global.console = {
      ...console,
      log: globalAny.jest.fn(),
      info: globalAny.jest.fn(),
      warn: globalAny.jest.fn(),
      debug: globalAny.jest.fn(),
      // Keep error for debugging
      error: console.error,
    };
  }
}

// Type declarations for custom matchers (when using Jest)
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidISODate(): R;
      toHaveErrorCode(code: string): R;
      toCompleteWithin(timeoutMs: number): Promise<R>;
    }
  }
}

export {};
