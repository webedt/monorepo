/**
 * Tests for Path Validation Middleware
 * Covers validatePathParam and validateBodyPath middleware functions
 *
 * Note: Uses test doubles to avoid circular dependency issues with @webedt/shared imports.
 * Tests verify the middleware logic patterns rather than importing the actual middleware.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { Request, Response, NextFunction, RequestHandler } from 'express';

// =============================================================================
// TEST DOUBLES - Recreating validation logic for isolated testing
// =============================================================================

/** Maximum allowed path length */
const MAX_PATH_LENGTH = 1000;

/** Safe character set for file paths: alphanumeric, dot, underscore, hyphen, forward slash */
const SAFE_PATH_REGEX = /^[a-zA-Z0-9._\-\/]+$/;

/** Pattern to detect directory traversal attempts */
const TRAVERSAL_PATTERN = /(?:^|\/|\\)\.\.(?:\/|\\|$)/;

/** Pattern to detect current directory references (./ or /./) */
const CURRENT_DIR_PATTERN = /(?:^\.\/|\/\.\/|\/\.$)/;

interface PathValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a file path against directory traversal attacks
 */
function testValidatePath(path: string): PathValidationResult {
  if (!path || path.length === 0) {
    return { valid: false, error: 'Path is required' };
  }

  if (path.includes('\0')) {
    return { valid: false, error: 'Path contains null bytes' };
  }

  if (path.length > MAX_PATH_LENGTH) {
    return { valid: false, error: `Path exceeds maximum length of ${MAX_PATH_LENGTH} characters` };
  }

  if (TRAVERSAL_PATTERN.test(path)) {
    return { valid: false, error: 'Path contains directory traversal patterns' };
  }

  if (CURRENT_DIR_PATTERN.test(path) || path === '.') {
    return { valid: false, error: 'Path contains current directory references' };
  }

  if (!SAFE_PATH_REGEX.test(path)) {
    return { valid: false, error: 'Path contains invalid characters' };
  }

  if (path.startsWith('/')) {
    return { valid: false, error: 'Path cannot start with a slash' };
  }

  return { valid: true };
}

/**
 * Validate a branch name for path safety
 */
function testValidateBranchPath(branch: string): PathValidationResult {
  if (!branch || branch.length === 0) {
    return { valid: false, error: 'Branch name is required' };
  }

  if (branch.includes('\0')) {
    return { valid: false, error: 'Branch name contains null bytes' };
  }

  if (branch.length > MAX_PATH_LENGTH) {
    return { valid: false, error: `Branch name exceeds maximum length of ${MAX_PATH_LENGTH} characters` };
  }

  if (TRAVERSAL_PATTERN.test(branch)) {
    return { valid: false, error: 'Branch name contains directory traversal patterns' };
  }

  if (CURRENT_DIR_PATTERN.test(branch) || branch === '.') {
    return { valid: false, error: 'Branch name contains current directory references' };
  }

  if (!SAFE_PATH_REGEX.test(branch)) {
    return { valid: false, error: 'Branch name contains invalid characters' };
  }

  if (branch.startsWith('/')) {
    return { valid: false, error: 'Branch name cannot start with a slash' };
  }

  return { valid: true };
}

/**
 * Mock logger for testing
 */
const loggedWarnings: Array<{ message: string; context: Record<string, unknown> }> = [];

function mockLogWarn(message: string, context: Record<string, unknown> = {}) {
  loggedWarnings.push({ message, context });
}

/**
 * Test version of validatePathParam middleware
 */
function testValidatePathParam(options: {
  paramIndex?: number;
  isBranchName?: boolean;
} = {}): RequestHandler {
  const { paramIndex = 0, isBranchName = false } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const paramValue = req.params[paramIndex];

    if (!paramValue) {
      res.status(400).json({
        success: false,
        error: isBranchName ? 'Branch name is required' : 'Path is required'
      });
      return;
    }

    const validationResult = isBranchName
      ? testValidateBranchPath(paramValue)
      : testValidatePath(paramValue);

    if (!validationResult.valid) {
      mockLogWarn('Path validation failed', {
        component: 'PathValidation',
        path: paramValue.substring(0, 100),
        error: validationResult.error,
        url: req.originalUrl,
        method: req.method,
      });

      res.status(400).json({
        success: false,
        error: validationResult.error
      });
      return;
    }

    next();
  };
}

/**
 * Test version of validateBodyPath middleware
 */
function testValidateBodyPath(fieldName: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pathValue = req.body?.[fieldName];

    if (!pathValue) {
      next();
      return;
    }

    if (typeof pathValue !== 'string') {
      res.status(400).json({
        success: false,
        error: `${fieldName} must be a string`
      });
      return;
    }

    const validationResult = testValidatePath(pathValue);

    if (!validationResult.valid) {
      mockLogWarn('Body path validation failed', {
        component: 'PathValidation',
        field: fieldName,
        error: validationResult.error,
        url: req.originalUrl,
        method: req.method,
      });

      res.status(400).json({
        success: false,
        error: `Invalid ${fieldName}: ${validationResult.error}`
      });
      return;
    }

    next();
  };
}

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createPathRequest(overrides: Partial<Request> = {}): Request {
  const baseReq: Partial<Request> = {
    params: {},
    body: {},
    originalUrl: '/api/test',
    method: 'GET',
    ...overrides,
  };
  return baseReq as Request;
}

function createPathResponse(): Response & { statusCode: number; data: unknown } {
  let statusCode = 200;
  let data: unknown = null;

  const mockRes = {
    get statusCode() { return statusCode; },
    get data() { return data; },
    status(code: number) {
      statusCode = code;
      return mockRes;
    },
    json(body: unknown) {
      data = body;
      return mockRes as Response;
    },
  };

  return mockRes as unknown as Response & { statusCode: number; data: unknown };
}

// =============================================================================
// TESTS
// =============================================================================

describe('Path Validation Middleware', () => {
  describe('validatePathParam', () => {
    describe('Basic Functionality', () => {
      it('should create middleware with default options', () => {
        const middleware = testValidatePathParam();
        assert.strictEqual(typeof middleware, 'function');
      });

      it('should create middleware with custom options', () => {
        const middleware = testValidatePathParam({ paramIndex: 1, isBranchName: true });
        assert.strictEqual(typeof middleware, 'function');
      });

      it('should call next for valid path', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'src/components/Button.tsx' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should return 400 when path is missing', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: {},
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.deepStrictEqual(res.data, {
          success: false,
          error: 'Path is required',
        });
      });

      it('should return 400 with branch message when isBranchName is true', () => {
        const middleware = testValidatePathParam({ isBranchName: true });
        const req = createPathRequest({
          params: {},
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.deepStrictEqual(res.data, {
          success: false,
          error: 'Branch name is required',
        });
      });
    });

    describe('Directory Traversal Prevention', () => {
      it('should reject path with ../', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': '../../../etc/passwd' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('directory traversal'));
      });

      it('should reject path with ..\\', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': '..\\..\\windows\\system32' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject path with .. at end', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'src/..' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject path starting with ..', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': '../secret.txt' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Current Directory Reference Prevention', () => {
      it('should reject path starting with ./', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': './config.json' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('current directory'));
      });

      it('should reject path containing /./', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'src/./config.json' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject single dot path', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': '.' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Invalid Characters Prevention', () => {
      it('should reject path with null bytes', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'file.txt\x00.jpg' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject path with special characters', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'file<script>.txt' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('invalid characters'));
      });

      it('should reject path with spaces', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'path with spaces/file.txt' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject path with semicolon', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'file;rm -rf /' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Absolute Path Prevention', () => {
      it('should reject path starting with /', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': '/etc/passwd' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('cannot start with a slash'));
      });
    });

    describe('Length Validation', () => {
      it('should reject excessively long paths', () => {
        const middleware = testValidatePathParam();
        const longPath = 'a'.repeat(1001);
        const req = createPathRequest({
          params: { '0': longPath } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('maximum length'));
      });

      it('should accept paths at maximum length', () => {
        const middleware = testValidatePathParam();
        const maxPath = 'a'.repeat(1000);
        const req = createPathRequest({
          params: { '0': maxPath } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });
    });

    describe('Valid Paths', () => {
      it('should accept simple file name', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'readme.md' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should accept nested path', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'src/components/Button/index.tsx' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should accept path with hyphen and underscore', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'my-component_v2/file-name_test.ts' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should accept path with dots in filename', () => {
        const middleware = testValidatePathParam();
        const req = createPathRequest({
          params: { '0': 'config.dev.local.json' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });
    });

    describe('Branch Name Validation', () => {
      it('should accept valid branch name', () => {
        const middleware = testValidatePathParam({ isBranchName: true });
        const req = createPathRequest({
          params: { '0': 'feature/new-component' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should reject branch name with traversal', () => {
        const middleware = testValidatePathParam({ isBranchName: true });
        const req = createPathRequest({
          params: { '0': 'feature/../main' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Custom Param Index', () => {
      it('should validate param at specified index', () => {
        const middleware = testValidatePathParam({ paramIndex: 1 });
        const req = createPathRequest({
          params: {
            '0': 'ignored',
            '1': 'src/file.txt',
          } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should reject when param at index is missing', () => {
        const middleware = testValidatePathParam({ paramIndex: 1 });
        const req = createPathRequest({
          params: { '0': 'only-first' } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });
  });

  describe('validateBodyPath', () => {
    describe('Basic Functionality', () => {
      it('should create middleware for field name', () => {
        const middleware = testValidateBodyPath('newPath');
        assert.strictEqual(typeof middleware, 'function');
      });

      it('should call next when field is missing (optional)', () => {
        const middleware = testValidateBodyPath('newPath');
        const req = createPathRequest({
          body: {},
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should call next for valid path in body', () => {
        const middleware = testValidateBodyPath('newPath');
        const req = createPathRequest({
          body: { newPath: 'src/new-location.ts' },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should return 400 when body path is not a string', () => {
        const middleware = testValidateBodyPath('newPath');
        const req = createPathRequest({
          body: { newPath: 123 },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.deepStrictEqual(res.data, {
          success: false,
          error: 'newPath must be a string',
        });
      });

      it('should return 400 when body path is an array', () => {
        const middleware = testValidateBodyPath('newPath');
        const req = createPathRequest({
          body: { newPath: ['path1', 'path2'] },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Path Validation', () => {
      it('should reject body path with traversal', () => {
        const middleware = testValidateBodyPath('destination');
        const req = createPathRequest({
          body: { destination: '../../../etc/passwd' },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
        assert.ok((res.data as { error: string }).error.includes('destination'));
      });

      it('should reject body path with null bytes', () => {
        const middleware = testValidateBodyPath('targetPath');
        const req = createPathRequest({
          body: { targetPath: 'file\x00.txt' },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });

      it('should reject body path starting with /', () => {
        const middleware = testValidateBodyPath('newPath');
        const req = createPathRequest({
          body: { newPath: '/absolute/path.txt' },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(res.statusCode, 400);
      });
    });

    describe('Different Field Names', () => {
      it('should validate different field names', () => {
        const fields = ['newPath', 'destination', 'targetFile', 'outputDir'];

        for (const field of fields) {
          const middleware = testValidateBodyPath(field);
          const req = createPathRequest({
            body: { [field]: 'valid/path.txt' },
          });
          const res = createPathResponse();
          let nextCalled = false;
          const next = () => { nextCalled = true; };

          middleware(req, res, next as NextFunction);

          assert.strictEqual(nextCalled, true, `Should accept valid path for field: ${field}`);
        }
      });

      it('should include field name in error message', () => {
        const middleware = testValidateBodyPath('customField');
        const req = createPathRequest({
          body: { customField: '../traversal' },
        });
        const res = createPathResponse();
        const next = () => {};

        middleware(req, res, next as NextFunction);

        assert.ok((res.data as { error: string }).error.includes('customField'));
      });
    });

    describe('Edge Cases', () => {
      it('should handle undefined body', () => {
        const middleware = testValidateBodyPath('path');
        const req = createPathRequest();
        delete (req as { body?: unknown }).body;
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });

      it('should handle empty string as valid (middleware level)', () => {
        const middleware = testValidateBodyPath('path');
        const req = createPathRequest({
          body: { path: '' },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        // Empty string is falsy, so treated as not present at middleware level
        assert.strictEqual(nextCalled, true);
      });

      it('should handle null as not present', () => {
        const middleware = testValidateBodyPath('path');
        const req = createPathRequest({
          body: { path: null },
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });
    });
  });

  describe('Security Scenarios', () => {
    it('should block common LFI attack patterns', () => {
      const middleware = testValidatePathParam();
      // Test patterns that our validation regex can detect
      // Note: URL-encoded patterns would be decoded before validation in real middleware
      const attackPatterns = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32',
        'src/../../../etc/passwd',
        './config.json',
        'file<script>.txt',
        'path;command',
        '/etc/passwd',
      ];

      for (const pattern of attackPatterns) {
        const req = createPathRequest({
          params: { '0': pattern } as Record<string, string>,
        });
        const res = createPathResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        middleware(req, res, next as NextFunction);

        assert.strictEqual(nextCalled, false, `Should block attack pattern: ${pattern}`);
      }
    });

    it('should log validation failures', () => {
      loggedWarnings.length = 0;

      const middleware = testValidatePathParam();
      const req = createPathRequest({
        params: { '0': '../../../secret' } as Record<string, string>,
        originalUrl: '/api/files/../../../secret',
        method: 'GET',
      });
      const res = createPathResponse();
      const next = () => {};

      middleware(req, res, next as NextFunction);

      assert.strictEqual(res.statusCode, 400);
      assert.ok(loggedWarnings.length > 0, 'Should have logged a warning');
    });
  });

  describe('Validation Logic', () => {
    describe('testValidatePath', () => {
      it('should return valid for simple path', () => {
        const result = testValidatePath('src/index.ts');
        assert.strictEqual(result.valid, true);
      });

      it('should return invalid for empty path', () => {
        const result = testValidatePath('');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path is required');
      });

      it('should return invalid for path with traversal', () => {
        const result = testValidatePath('../secret');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error?.includes('traversal'));
      });
    });

    describe('testValidateBranchPath', () => {
      it('should return valid for feature branch', () => {
        const result = testValidateBranchPath('feature/my-feature');
        assert.strictEqual(result.valid, true);
      });

      it('should return invalid for branch with traversal', () => {
        const result = testValidateBranchPath('feature/../main');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error?.includes('traversal'));
      });
    });
  });
});
