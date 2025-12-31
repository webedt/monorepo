/**
 * Tests for domain-specific error classes.
 * Covers error construction, static factory methods, type guards, and serialization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DomainError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ConflictError,
  isValidationError,
  isAuthenticationError,
  isAuthorizationError,
  isRateLimitError,
  isConflictError,
  isDomainError,
  convertUniqueConstraintToConflict,
} from '../src/utils/errorTypes.js';

import type { AnyDomainError, DatabaseError } from '../src/utils/errorTypes.js';

describe('ValidationError', () => {
  describe('Constructor', () => {
    it('should create error with message only', () => {
      const error = new ValidationError('Invalid input');

      assert.strictEqual(error.message, 'Invalid input');
      assert.strictEqual(error.field, undefined);
      assert.strictEqual(error.type, 'VALIDATION_ERROR');
      assert.strictEqual(error.statusCode, 400);
      assert.strictEqual(error.name, 'ValidationError');
    });

    it('should create error with message and field', () => {
      const error = new ValidationError('Invalid email', 'email');

      assert.strictEqual(error.message, 'Invalid email');
      assert.strictEqual(error.field, 'email');
      assert.deepStrictEqual(error.context, { field: 'email' });
    });

    it('should create error with message, field, and context', () => {
      const error = new ValidationError('Value too large', 'age', { max: 100, value: 150 });

      assert.strictEqual(error.field, 'age');
      assert.deepStrictEqual(error.context, { max: 100, value: 150, field: 'age' });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create required field error', () => {
      const error = ValidationError.required('username');

      assert.strictEqual(error.message, 'username is required');
      assert.strictEqual(error.field, 'username');
    });

    it('should create invalid format error without expected format', () => {
      const error = ValidationError.invalidFormat('email');

      assert.strictEqual(error.message, 'Invalid email format');
      assert.strictEqual(error.field, 'email');
    });

    it('should create invalid format error with expected format', () => {
      const error = ValidationError.invalidFormat('date', 'YYYY-MM-DD');

      assert.strictEqual(error.message, 'Invalid date format. Expected: YYYY-MM-DD');
      assert.deepStrictEqual(error.context, { expectedFormat: 'YYYY-MM-DD', field: 'date' });
    });

    it('should create out of range error with min and max', () => {
      const error = ValidationError.outOfRange('age', { min: 0, max: 120, value: -5 });

      assert.strictEqual(error.message, 'age must be between 0 and 120');
      assert.deepStrictEqual(error.context, { min: 0, max: 120, value: -5, field: 'age' });
    });

    it('should create out of range error with min only', () => {
      const error = ValidationError.outOfRange('count', { min: 1 });

      assert.strictEqual(error.message, 'count must be at least 1');
    });

    it('should create out of range error with max only', () => {
      const error = ValidationError.outOfRange('size', { max: 1000 });

      assert.strictEqual(error.message, 'size must be at most 1000');
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const error = new ValidationError('Invalid value', 'field1', { extra: 'data' });
      const json = error.toJSON();

      assert.deepStrictEqual(json, {
        type: 'VALIDATION_ERROR',
        message: 'Invalid value',
        context: { field: 'field1', extra: 'data' },
      });
    });
  });
});

describe('AuthenticationError', () => {
  describe('Constructor', () => {
    it('should create error with message only', () => {
      const error = new AuthenticationError('Auth failed');

      assert.strictEqual(error.message, 'Auth failed');
      assert.strictEqual(error.reason, undefined);
      assert.strictEqual(error.type, 'AUTHENTICATION_ERROR');
      assert.strictEqual(error.statusCode, 401);
    });

    it('should create error with reason', () => {
      const error = new AuthenticationError('Token expired', 'TOKEN_EXPIRED');

      assert.strictEqual(error.reason, 'TOKEN_EXPIRED');
      assert.deepStrictEqual(error.context, { reason: 'TOKEN_EXPIRED' });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create token expired error', () => {
      const error = AuthenticationError.tokenExpired();

      assert.strictEqual(error.message, 'Token has expired');
      assert.strictEqual(error.reason, 'TOKEN_EXPIRED');
    });

    it('should create invalid credentials error', () => {
      const error = AuthenticationError.invalidCredentials();

      assert.strictEqual(error.message, 'Invalid credentials');
      assert.strictEqual(error.reason, 'INVALID_CREDENTIALS');
    });

    it('should create session expired error', () => {
      const error = AuthenticationError.sessionExpired();

      assert.strictEqual(error.message, 'Session has expired');
      assert.strictEqual(error.reason, 'SESSION_EXPIRED');
    });

    it('should create not authenticated error', () => {
      const error = AuthenticationError.notAuthenticated();

      assert.strictEqual(error.message, 'Authentication required');
      assert.strictEqual(error.reason, 'NOT_AUTHENTICATED');
    });
  });
});

describe('AuthorizationError', () => {
  describe('Constructor', () => {
    it('should create error with message only', () => {
      const error = new AuthorizationError('Access denied');

      assert.strictEqual(error.message, 'Access denied');
      assert.strictEqual(error.requiredRole, undefined);
      assert.strictEqual(error.type, 'AUTHORIZATION_ERROR');
      assert.strictEqual(error.statusCode, 403);
    });

    it('should create error with required role', () => {
      const error = new AuthorizationError('Admin only', 'admin');

      assert.strictEqual(error.requiredRole, 'admin');
      assert.deepStrictEqual(error.context, { requiredRole: 'admin' });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create insufficient role error without resource', () => {
      const error = AuthorizationError.insufficientRole('admin');

      assert.strictEqual(error.message, 'admin access required');
      assert.strictEqual(error.requiredRole, 'admin');
    });

    it('should create insufficient role error with resource', () => {
      const error = AuthorizationError.insufficientRole('owner', 'organization');

      assert.strictEqual(error.message, 'owner access required for organization');
      assert.deepStrictEqual(error.context, { requiredRole: 'owner', resource: 'organization' });
    });

    it('should create resource access denied error', () => {
      const error = AuthorizationError.resourceAccessDenied('document', 'doc-123');

      assert.strictEqual(error.message, 'Access denied to document');
      assert.deepStrictEqual(error.context, { resource: 'document', resourceId: 'doc-123' });
    });

    it('should create not member error', () => {
      const error = AuthorizationError.notMember('organization');

      assert.strictEqual(error.message, 'Not a member of this organization');
    });
  });
});

describe('RateLimitError', () => {
  describe('Constructor', () => {
    it('should create error with message only', () => {
      const error = new RateLimitError('Too many requests');

      assert.strictEqual(error.message, 'Too many requests');
      assert.strictEqual(error.retryAfterSeconds, undefined);
      assert.strictEqual(error.type, 'RATE_LIMIT_ERROR');
      assert.strictEqual(error.statusCode, 429);
    });

    it('should create error with retry after seconds', () => {
      const error = new RateLimitError('Rate limited', 60);

      assert.strictEqual(error.retryAfterSeconds, 60);
      assert.deepStrictEqual(error.context, { retryAfterSeconds: 60 });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create limit exceeded error with basic info', () => {
      const error = RateLimitError.limitExceeded(30);

      assert.strictEqual(error.message, 'Rate limit exceeded');
      assert.strictEqual(error.retryAfterSeconds, 30);
    });

    it('should create limit exceeded error with full options', () => {
      const resetAt = new Date('2024-01-01T12:00:00Z');
      const error = RateLimitError.limitExceeded(60, {
        limit: 100,
        remaining: 0,
        resetAt,
      });

      assert.strictEqual(error.retryAfterSeconds, 60);
      assert.deepStrictEqual(error.context, {
        retryAfterSeconds: 60,
        limit: 100,
        remaining: 0,
        resetAt: '2024-01-01T12:00:00.000Z',
      });
    });

    it('should create error from retry-after header string', () => {
      const error = RateLimitError.fromRetryAfterHeader('120');

      assert.strictEqual(error.retryAfterSeconds, 120);
    });

    it('should create error from retry-after header number', () => {
      const error = RateLimitError.fromRetryAfterHeader(45);

      assert.strictEqual(error.retryAfterSeconds, 45);
    });

    it('should handle retry-after header of 0', () => {
      const error = RateLimitError.fromRetryAfterHeader('0');

      assert.strictEqual(error.retryAfterSeconds, 0);
    });

    it('should default to 60 for invalid retry-after header', () => {
      const error = RateLimitError.fromRetryAfterHeader('invalid');

      assert.strictEqual(error.retryAfterSeconds, 60);
    });
  });
});

describe('ConflictError', () => {
  describe('Constructor', () => {
    it('should create error with message only', () => {
      const error = new ConflictError('Conflict detected');

      assert.strictEqual(error.message, 'Conflict detected');
      assert.strictEqual(error.conflictType, undefined);
      assert.strictEqual(error.type, 'CONFLICT_ERROR');
      assert.strictEqual(error.statusCode, 409);
    });

    it('should create error with conflict type', () => {
      const error = new ConflictError('Already exists', 'ALREADY_EXISTS');

      assert.strictEqual(error.conflictType, 'ALREADY_EXISTS');
      assert.deepStrictEqual(error.context, { conflictType: 'ALREADY_EXISTS' });
    });
  });

  describe('Static Factory Methods', () => {
    it('should create unique violation error without value', () => {
      const error = ConflictError.uniqueViolation('email');

      assert.strictEqual(error.message, 'email is already taken');
      assert.strictEqual(error.conflictType, 'UNIQUE_VIOLATION');
    });

    it('should create unique violation error with value', () => {
      const error = ConflictError.uniqueViolation('slug', 'my-slug');

      assert.strictEqual(error.message, "slug 'my-slug' is already taken");
      assert.deepStrictEqual(error.context, {
        conflictType: 'UNIQUE_VIOLATION',
        field: 'slug',
        value: 'my-slug',
      });
    });

    it('should create version mismatch error', () => {
      const error = ConflictError.versionMismatch(1, 3);

      assert.strictEqual(error.message, 'Resource was modified by another request');
      assert.strictEqual(error.conflictType, 'VERSION_MISMATCH');
      assert.deepStrictEqual(error.context, {
        conflictType: 'VERSION_MISMATCH',
        expectedVersion: 1,
        actualVersion: 3,
      });
    });

    it('should create already exists error', () => {
      const error = ConflictError.alreadyExists('User');

      assert.strictEqual(error.message, 'User already exists');
      assert.strictEqual(error.conflictType, 'ALREADY_EXISTS');
    });

    it('should create from database error', () => {
      const dbError = {
        message: 'duplicate key',
        name: 'Error',
        code: '23505',
        constraint: 'users_email_unique',
        table: 'users',
        column: 'email',
      } as DatabaseError;

      const error = ConflictError.fromDatabaseError(dbError, 'Email already registered');

      assert.strictEqual(error.message, 'Email already registered');
      assert.strictEqual(error.conflictType, 'UNIQUE_VIOLATION');
      assert.deepStrictEqual(error.context, {
        conflictType: 'UNIQUE_VIOLATION',
        constraint: 'users_email_unique',
        table: 'users',
        column: 'email',
      });
    });
  });
});

describe('Type Guards', () => {
  const validationError = new ValidationError('test');
  const authenticationError = new AuthenticationError('test');
  const authorizationError = new AuthorizationError('test');
  const rateLimitError = new RateLimitError('test');
  const conflictError = new ConflictError('test');
  const regularError = new Error('test');

  describe('isValidationError', () => {
    it('should return true for ValidationError', () => {
      assert.strictEqual(isValidationError(validationError), true);
    });

    it('should return false for other errors', () => {
      assert.strictEqual(isValidationError(authenticationError), false);
      assert.strictEqual(isValidationError(regularError), false);
      assert.strictEqual(isValidationError(null), false);
    });
  });

  describe('isAuthenticationError', () => {
    it('should return true for AuthenticationError', () => {
      assert.strictEqual(isAuthenticationError(authenticationError), true);
    });

    it('should return false for other errors', () => {
      assert.strictEqual(isAuthenticationError(validationError), false);
      assert.strictEqual(isAuthenticationError(regularError), false);
    });
  });

  describe('isAuthorizationError', () => {
    it('should return true for AuthorizationError', () => {
      assert.strictEqual(isAuthorizationError(authorizationError), true);
    });

    it('should return false for other errors', () => {
      assert.strictEqual(isAuthorizationError(validationError), false);
      assert.strictEqual(isAuthorizationError(regularError), false);
    });
  });

  describe('isRateLimitError', () => {
    it('should return true for RateLimitError', () => {
      assert.strictEqual(isRateLimitError(rateLimitError), true);
    });

    it('should return false for other errors', () => {
      assert.strictEqual(isRateLimitError(validationError), false);
      assert.strictEqual(isRateLimitError(regularError), false);
    });
  });

  describe('isConflictError', () => {
    it('should return true for ConflictError', () => {
      assert.strictEqual(isConflictError(conflictError), true);
    });

    it('should return false for other errors', () => {
      assert.strictEqual(isConflictError(validationError), false);
      assert.strictEqual(isConflictError(regularError), false);
    });
  });

  describe('isDomainError', () => {
    it('should return true for all domain errors', () => {
      assert.strictEqual(isDomainError(validationError), true);
      assert.strictEqual(isDomainError(authenticationError), true);
      assert.strictEqual(isDomainError(authorizationError), true);
      assert.strictEqual(isDomainError(rateLimitError), true);
      assert.strictEqual(isDomainError(conflictError), true);
    });

    it('should return false for regular errors', () => {
      assert.strictEqual(isDomainError(regularError), false);
      assert.strictEqual(isDomainError(null), false);
      assert.strictEqual(isDomainError(undefined), false);
      assert.strictEqual(isDomainError('error string'), false);
    });
  });
});

describe('convertUniqueConstraintToConflict', () => {
  it('should convert database unique constraint error to ConflictError', () => {
    const dbError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'users_email_unique',
      table: 'users',
      column: 'email',
    });

    const result = convertUniqueConstraintToConflict(dbError, 'Email taken');

    assert.strictEqual(isConflictError(result), true);
    assert.strictEqual((result as ConflictError).message, 'Email taken');
  });

  it('should return original error if not unique constraint', () => {
    const regularError = new Error('Some other error');

    const result = convertUniqueConstraintToConflict(regularError);

    assert.strictEqual(result, regularError);
  });

  it('should return original error if not an Error instance', () => {
    const result = convertUniqueConstraintToConflict('string error');

    assert.strictEqual(result, 'string error');
  });
});

describe('Discriminated Union Exhaustiveness', () => {
  it('should allow exhaustive switch on error types', () => {
    function getStatusCode(error: AnyDomainError): number {
      switch (error.type) {
        case 'VALIDATION_ERROR':
          return 400;
        case 'AUTHENTICATION_ERROR':
          return 401;
        case 'AUTHORIZATION_ERROR':
          return 403;
        case 'RATE_LIMIT_ERROR':
          return 429;
        case 'CONFLICT_ERROR':
          return 409;
        default: {
          // This line ensures exhaustiveness - TypeScript will error if a case is missing
          const _exhaustive: never = error;
          return 500;
        }
      }
    }

    assert.strictEqual(getStatusCode(new ValidationError('test')), 400);
    assert.strictEqual(getStatusCode(new AuthenticationError('test')), 401);
    assert.strictEqual(getStatusCode(new AuthorizationError('test')), 403);
    assert.strictEqual(getStatusCode(new RateLimitError('test')), 429);
    assert.strictEqual(getStatusCode(new ConflictError('test')), 409);
  });
});

describe('Error Inheritance', () => {
  it('should be instanceof Error', () => {
    const error = new ValidationError('test');
    assert.strictEqual(error instanceof Error, true);
  });

  it('should be instanceof DomainError', () => {
    const error = new ValidationError('test');
    assert.strictEqual(error instanceof DomainError, true);
  });

  it('should have proper stack trace', () => {
    const error = new ValidationError('test');
    assert.ok(error.stack);
    assert.ok(error.stack.includes('ValidationError'));
  });
});
