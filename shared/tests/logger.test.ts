/**
 * Tests for the Logger module.
 * Covers log formatting, context handling, and error output.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { logger, type LogContext } from '../src/utils/logging/logger.js';

describe('Logger Module', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: ReturnType<typeof mock.fn>;
  let consoleWarnSpy: ReturnType<typeof mock.fn>;
  let consoleErrorSpy: ReturnType<typeof mock.fn>;
  let originalConsoleLog: typeof console.log;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalEnv = { ...process.env };

    // Capture original console methods
    originalConsoleLog = console.log;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;

    // Create spies
    consoleLogSpy = mock.fn();
    consoleWarnSpy = mock.fn();
    consoleErrorSpy = mock.fn();

    // Replace console methods (cast to any to bypass strict type checking for mocks)
    console.log = consoleLogSpy as any;
    console.warn = consoleWarnSpy as any;
    console.error = consoleErrorSpy as any;
  });

  afterEach(() => {
    process.env = originalEnv;
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  describe('info logging', () => {
    it('should log info messages to console.log', () => {
      logger.info('Test info message');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 1);
      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('INFO'));
      assert.ok(loggedMessage.includes('Test info message'));
    });

    it('should include timestamp in info logs', () => {
      logger.info('Timestamp test');

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      // ISO timestamp format check
      assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(loggedMessage));
    });

    it('should format context with component', () => {
      logger.info('Test message', { component: 'TestComponent' });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('component=TestComponent'));
    });

    it('should format context with sessionId (truncated)', () => {
      logger.info('Test message', { sessionId: 'abcdefgh-1234-5678-9012' });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      // Session ID should be truncated to first 8 characters
      assert.ok(loggedMessage.includes('session=abcdefgh'));
      assert.ok(!loggedMessage.includes('abcdefgh-1234'));
    });

    it('should format context with provider', () => {
      logger.info('Test message', { provider: 'claude' });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('provider=claude'));
    });

    it('should format context with all standard fields', () => {
      logger.info('Test message', {
        component: 'GitHelper',
        sessionId: '12345678-abcd-efgh',
        provider: 'codex'
      });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('component=GitHelper'));
      assert.ok(loggedMessage.includes('session=12345678'));
      assert.ok(loggedMessage.includes('provider=codex'));
    });

    it('should include custom context fields', () => {
      logger.info('Test message', {
        component: 'Test',
        customField: 'customValue',
        numericField: 42
      });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('customField=customValue'));
      assert.ok(loggedMessage.includes('numericField=42'));
    });

    it('should handle empty context', () => {
      logger.info('Test message', {});

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('Test message'));
      // Should not have context brackets when no context
      assert.ok(!loggedMessage.includes('['));
    });

    it('should handle undefined context', () => {
      logger.info('Test message');

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('Test message'));
    });
  });

  describe('warn logging', () => {
    it('should log warn messages to console.warn', () => {
      logger.warn('Test warning');

      assert.strictEqual(consoleWarnSpy.mock.callCount(), 1);
      const loggedMessage = consoleWarnSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('WARN'));
      assert.ok(loggedMessage.includes('Test warning'));
    });

    it('should include context in warn messages', () => {
      logger.warn('Warning with context', { component: 'WarnTest' });

      const loggedMessage = consoleWarnSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('component=WarnTest'));
    });
  });

  describe('error logging', () => {
    it('should log error messages to console.error', () => {
      logger.error('Test error');

      assert.strictEqual(consoleErrorSpy.mock.callCount(), 1);
      const loggedMessage = consoleErrorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('ERROR'));
      assert.ok(loggedMessage.includes('Test error'));
    });

    it('should log Error object message', () => {
      const testError = new Error('Test error details');
      logger.error('Something went wrong', testError);

      // First call is the main message, second is the error details
      assert.ok(consoleErrorSpy.mock.callCount() >= 2);
      const errorMessage = consoleErrorSpy.mock.calls[1].arguments[0] as string;
      assert.ok(errorMessage.includes('Error: Test error details'));
    });

    it('should log stack trace when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      const testError = new Error('Debug error');
      logger.error('Error with stack', testError);

      // Should have 3 calls: main message, error message, stack
      assert.ok(consoleErrorSpy.mock.callCount() >= 3);
      const stackMessage = consoleErrorSpy.mock.calls[2].arguments[0] as string;
      assert.ok(stackMessage.includes('Stack:'));
    });

    it('should not log stack trace when LOG_LEVEL is not debug', () => {
      delete process.env.LOG_LEVEL;
      const testError = new Error('No debug error');
      logger.error('Error without stack', testError);

      // Should only have 2 calls: main message, error message
      assert.strictEqual(consoleErrorSpy.mock.callCount(), 2);
    });

    it('should handle non-Error objects', () => {
      logger.error('Error with object', { code: 500, details: 'Server error' });

      assert.ok(consoleErrorSpy.mock.callCount() >= 2);
      const detailsMessage = consoleErrorSpy.mock.calls[1].arguments[0] as string;
      assert.ok(detailsMessage.includes('Details:'));
      assert.ok(detailsMessage.includes('500'));
    });

    it('should handle string error details', () => {
      logger.error('Error with string', 'Simple error string');

      assert.ok(consoleErrorSpy.mock.callCount() >= 2);
      const detailsMessage = consoleErrorSpy.mock.calls[1].arguments[0] as string;
      assert.ok(detailsMessage.includes('Simple error string'));
    });

    it('should include context in error messages', () => {
      logger.error('Error with context', undefined, { component: 'ErrorHandler' });

      const loggedMessage = consoleErrorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('component=ErrorHandler'));
    });

    it('should handle error with both Error object and context', () => {
      const testError = new Error('Combined error');
      logger.error('Full error', testError, { component: 'Combined', sessionId: '12345678' });

      const mainMessage = consoleErrorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(mainMessage.includes('component=Combined'));
      assert.ok(mainMessage.includes('session=12345678'));
    });
  });

  describe('debug logging', () => {
    it('should log debug messages when LOG_LEVEL is debug', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('Debug message');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 1);
      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('DEBUG'));
      assert.ok(loggedMessage.includes('Debug message'));
    });

    it('should not log debug messages when LOG_LEVEL is not debug', () => {
      delete process.env.LOG_LEVEL;
      logger.debug('Debug message');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 0);
    });

    it('should not log debug messages when LOG_LEVEL is info', () => {
      process.env.LOG_LEVEL = 'info';
      logger.debug('Debug message');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 0);
    });

    it('should include context in debug messages when enabled', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('Debug with context', { component: 'DebugTest' });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('component=DebugTest'));
    });
  });

  describe('log level formatting', () => {
    it('should pad INFO to 5 characters', () => {
      logger.info('Test');

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('INFO '));
    });

    it('should pad WARN to 5 characters', () => {
      logger.warn('Test');

      const loggedMessage = consoleWarnSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('WARN '));
    });

    it('should not pad ERROR (already 5 characters)', () => {
      logger.error('Test');

      const loggedMessage = consoleErrorSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('ERROR'));
    });

    it('should pad DEBUG to 5 characters when enabled', () => {
      process.env.LOG_LEVEL = 'debug';
      logger.debug('Test');

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('DEBUG'));
    });
  });

  describe('edge cases', () => {
    it('should handle empty string message', () => {
      logger.info('');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 1);
    });

    it('should handle message with special characters', () => {
      logger.info('Message with "quotes" and \'apostrophes\' and <brackets>');

      assert.strictEqual(consoleLogSpy.mock.callCount(), 1);
      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('"quotes"'));
    });

    it('should handle context with undefined values', () => {
      logger.info('Test', { component: 'Test', undefinedField: undefined });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('undefinedField=undefined'));
    });

    it('should handle context with null values', () => {
      const context: LogContext = { component: 'Test', nullField: null };
      logger.info('Test', context);

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      assert.ok(loggedMessage.includes('nullField=null'));
    });

    it('should handle very long session IDs', () => {
      const longSessionId = 'a'.repeat(100);
      logger.info('Test', { sessionId: longSessionId });

      const loggedMessage = consoleLogSpy.mock.calls[0].arguments[0] as string;
      // Should only show first 8 characters
      assert.ok(loggedMessage.includes('session=aaaaaaaa'));
      assert.ok(!loggedMessage.includes('a'.repeat(50)));
    });
  });
});

describe('LogContext Type', () => {
  it('should allow standard fields', () => {
    const context: LogContext = {
      component: 'TestComponent',
      sessionId: 'test-session',
      provider: 'claude'
    };

    assert.strictEqual(context.component, 'TestComponent');
    assert.strictEqual(context.sessionId, 'test-session');
    assert.strictEqual(context.provider, 'claude');
  });

  it('should allow custom fields', () => {
    const context: LogContext = {
      customString: 'string value',
      customNumber: 123,
      customBoolean: true,
      customArray: [1, 2, 3],
      customObject: { nested: 'value' }
    };

    assert.strictEqual(context['customString'], 'string value');
    assert.strictEqual(context['customNumber'], 123);
  });

  it('should allow empty context', () => {
    const context: LogContext = {};
    assert.strictEqual(Object.keys(context).length, 0);
  });
});
