/**
 * Tests for path validation utilities.
 * Covers path traversal prevention, null byte detection, and character validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  MAX_PATH_LENGTH,
  SAFE_PATH_REGEX,
  TRAVERSAL_PATTERN,
  CURRENT_DIR_PATTERN,
  validatePath,
  assertValidPath,
  isValidPath,
  validateBranchPath,
  isValidBranchPath,
} from '../../src/utils/validators/pathValidation.js';

describe('Path Validation', () => {
  describe('Constants', () => {
    it('should have MAX_PATH_LENGTH of 1000', () => {
      assert.strictEqual(MAX_PATH_LENGTH, 1000);
    });

    it('SAFE_PATH_REGEX should match valid path characters', () => {
      assert.ok(SAFE_PATH_REGEX.test('abc123'));
      assert.ok(SAFE_PATH_REGEX.test('file.txt'));
      assert.ok(SAFE_PATH_REGEX.test('path/to/file'));
      assert.ok(SAFE_PATH_REGEX.test('file-name_v2.js'));
    });

    it('SAFE_PATH_REGEX should reject invalid characters', () => {
      assert.ok(!SAFE_PATH_REGEX.test('file name')); // space
      assert.ok(!SAFE_PATH_REGEX.test('file@name')); // @
      assert.ok(!SAFE_PATH_REGEX.test('file#name')); // #
      assert.ok(!SAFE_PATH_REGEX.test('file$name')); // $
      assert.ok(!SAFE_PATH_REGEX.test('file%name')); // %
      assert.ok(!SAFE_PATH_REGEX.test('file\x00name')); // null byte
    });

    it('TRAVERSAL_PATTERN should detect directory traversal', () => {
      assert.ok(TRAVERSAL_PATTERN.test('../'));
      assert.ok(TRAVERSAL_PATTERN.test('..\\'));
      assert.ok(TRAVERSAL_PATTERN.test('/..'));
      assert.ok(TRAVERSAL_PATTERN.test('foo/../bar'));
      assert.ok(TRAVERSAL_PATTERN.test('foo/..'));
      assert.ok(!TRAVERSAL_PATTERN.test('foo/bar'));
      assert.ok(!TRAVERSAL_PATTERN.test('foo.bar'));
      assert.ok(!TRAVERSAL_PATTERN.test('foo..bar')); // consecutive dots within name is OK
    });

    it('CURRENT_DIR_PATTERN should detect current directory references', () => {
      assert.ok(CURRENT_DIR_PATTERN.test('./'));
      assert.ok(CURRENT_DIR_PATTERN.test('/./'));
      assert.ok(CURRENT_DIR_PATTERN.test('foo/./bar'));
      assert.ok(CURRENT_DIR_PATTERN.test('/.'));
      assert.ok(!CURRENT_DIR_PATTERN.test('foo/bar'));
      assert.ok(!CURRENT_DIR_PATTERN.test('file.txt'));
    });
  });

  describe('validatePath', () => {
    describe('valid paths', () => {
      it('should accept simple file names', () => {
        const result = validatePath('file.txt');
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.error, undefined);
      });

      it('should accept paths with directories', () => {
        assert.strictEqual(validatePath('src/components/Button.tsx').valid, true);
        assert.strictEqual(validatePath('path/to/file.js').valid, true);
      });

      it('should accept paths with dots in filenames', () => {
        assert.strictEqual(validatePath('file.test.ts').valid, true);
        assert.strictEqual(validatePath('config.dev.json').valid, true);
      });

      it('should accept paths with underscores and hyphens', () => {
        assert.strictEqual(validatePath('my_file-name.ts').valid, true);
        assert.strictEqual(validatePath('src/my-component_v2/index.ts').valid, true);
      });
    });

    describe('empty and undefined paths', () => {
      it('should reject empty string', () => {
        const result = validatePath('');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path is required');
      });

      it('should handle null-like values gracefully', () => {
        // TypeScript would catch this, but runtime should handle it
        const result = validatePath(null as unknown as string);
        assert.strictEqual(result.valid, false);
      });
    });

    describe('null bytes', () => {
      it('should reject paths with null bytes', () => {
        const result = validatePath('file\x00.txt');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains null bytes');
      });

      it('should reject paths with null bytes in the middle', () => {
        const result = validatePath('path/to\x00/file.txt');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains null bytes');
      });
    });

    describe('excessive length', () => {
      it('should reject paths exceeding 1000 characters', () => {
        const longPath = 'a'.repeat(1001);
        const result = validatePath(longPath);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error?.includes('maximum length'));
      });

      it('should accept paths at exactly 1000 characters', () => {
        const maxPath = 'a'.repeat(1000);
        const result = validatePath(maxPath);
        assert.strictEqual(result.valid, true);
      });
    });

    describe('directory traversal patterns', () => {
      it('should reject ../ at start', () => {
        const result = validatePath('../etc/passwd');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains directory traversal patterns');
      });

      it('should reject ../ in the middle', () => {
        const result = validatePath('foo/../bar');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains directory traversal patterns');
      });

      it('should reject multiple traversals', () => {
        const result = validatePath('../../../etc/passwd');
        assert.strictEqual(result.valid, false);
      });

      it('should reject backslash traversal', () => {
        const result = validatePath('foo\\..\\bar');
        assert.strictEqual(result.valid, false);
      });

      it('should reject /.. at end', () => {
        const result = validatePath('foo/..');
        assert.strictEqual(result.valid, false);
      });
    });

    describe('current directory references', () => {
      it('should reject ./ at start', () => {
        const result = validatePath('./config');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains current directory references');
      });

      it('should reject /./ in the middle', () => {
        const result = validatePath('foo/./bar');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains current directory references');
      });

      it('should reject single dot', () => {
        const result = validatePath('.');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains current directory references');
      });
    });

    describe('invalid characters', () => {
      it('should reject paths with spaces', () => {
        const result = validatePath('path with spaces');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path contains invalid characters');
      });

      it('should reject paths with special characters', () => {
        assert.strictEqual(validatePath('file@name').valid, false);
        assert.strictEqual(validatePath('file#name').valid, false);
        assert.strictEqual(validatePath('file$name').valid, false);
        assert.strictEqual(validatePath('file%name').valid, false);
        assert.strictEqual(validatePath('file&name').valid, false);
        assert.strictEqual(validatePath('file*name').valid, false);
      });

      it('should reject paths with shell metacharacters', () => {
        assert.strictEqual(validatePath('file;rm -rf /').valid, false);
        assert.strictEqual(validatePath('file|cat /etc/passwd').valid, false);
        assert.strictEqual(validatePath('file$(whoami)').valid, false);
        assert.strictEqual(validatePath('file`whoami`').valid, false);
      });
    });

    describe('leading slashes', () => {
      it('should reject absolute paths', () => {
        const result = validatePath('/etc/passwd');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path cannot start with a slash');
      });

      it('should reject paths starting with slash', () => {
        const result = validatePath('/foo/bar');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Path cannot start with a slash');
      });
    });
  });

  describe('assertValidPath', () => {
    it('should not throw for valid paths', () => {
      assert.doesNotThrow(() => assertValidPath('src/index.ts'));
      assert.doesNotThrow(() => assertValidPath('file.txt'));
    });

    it('should throw for invalid paths', () => {
      assert.throws(() => assertValidPath('../etc/passwd'), {
        message: 'Path contains directory traversal patterns',
      });
    });

    it('should throw with correct error message', () => {
      assert.throws(() => assertValidPath(''), {
        message: 'Path is required',
      });
    });
  });

  describe('isValidPath', () => {
    it('should return true for valid paths', () => {
      assert.strictEqual(isValidPath('src/components/Button.tsx'), true);
      assert.strictEqual(isValidPath('file.txt'), true);
    });

    it('should return false for invalid paths', () => {
      assert.strictEqual(isValidPath('../etc/passwd'), false);
      assert.strictEqual(isValidPath('./config'), false);
      assert.strictEqual(isValidPath('/absolute/path'), false);
      assert.strictEqual(isValidPath(''), false);
    });
  });

  describe('validateBranchPath', () => {
    describe('valid branch names', () => {
      it('should accept simple branch names', () => {
        assert.strictEqual(validateBranchPath('main').valid, true);
        assert.strictEqual(validateBranchPath('develop').valid, true);
      });

      it('should accept branch names with slashes', () => {
        assert.strictEqual(validateBranchPath('feature/new-feature').valid, true);
        assert.strictEqual(validateBranchPath('release/v1.2.3').valid, true);
        assert.strictEqual(validateBranchPath('hotfix/bug-123').valid, true);
      });

      it('should accept branch names with dots', () => {
        assert.strictEqual(validateBranchPath('release-1.0.0').valid, true);
        assert.strictEqual(validateBranchPath('v2.0.0-beta').valid, true);
      });
    });

    describe('invalid branch names', () => {
      it('should reject empty branch names', () => {
        const result = validateBranchPath('');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name is required');
      });

      it('should reject branch names with null bytes', () => {
        const result = validateBranchPath('branch\x00name');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name contains null bytes');
      });

      it('should reject directory traversal in branch names', () => {
        const result = validateBranchPath('../admin');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name contains directory traversal patterns');
      });

      it('should reject current directory references in branch names', () => {
        const result = validateBranchPath('./hidden');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name contains current directory references');
      });

      it('should reject branch names with invalid characters', () => {
        assert.strictEqual(validateBranchPath('branch name').valid, false);
        assert.strictEqual(validateBranchPath('branch;rm').valid, false);
        assert.strictEqual(validateBranchPath('branch$var').valid, false);
      });

      it('should reject branch names starting with slash', () => {
        const result = validateBranchPath('/feature/test');
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, 'Branch name cannot start with a slash');
      });
    });

    describe('edge cases', () => {
      it('should reject excessively long branch names', () => {
        const longBranch = 'a'.repeat(1001);
        const result = validateBranchPath(longBranch);
        assert.strictEqual(result.valid, false);
        assert.ok(result.error?.includes('maximum length'));
      });

      it('should accept branch names at max length', () => {
        const maxBranch = 'a'.repeat(1000);
        const result = validateBranchPath(maxBranch);
        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('isValidBranchPath', () => {
    it('should return true for valid branch names', () => {
      assert.strictEqual(isValidBranchPath('main'), true);
      assert.strictEqual(isValidBranchPath('feature/test'), true);
    });

    it('should return false for invalid branch names', () => {
      assert.strictEqual(isValidBranchPath('../admin'), false);
      assert.strictEqual(isValidBranchPath('/feature'), false);
      assert.strictEqual(isValidBranchPath(''), false);
    });
  });

  describe('Security edge cases', () => {
    it('should reject encoded traversal attempts (already rejected by char check)', () => {
      // URL-encoded ../ would be %2e%2e%2f - rejected by invalid chars
      assert.strictEqual(validatePath('%2e%2e%2f').valid, false);
    });

    it('should reject unicode normalization attacks (rejected by char check)', () => {
      // Unicode dots would be rejected by invalid chars
      assert.strictEqual(validatePath('．．/etc').valid, false); // fullwidth dots
    });

    it('should handle consecutive dots in filenames (allowed)', () => {
      // foo..bar is valid - dots in the middle of a name
      assert.strictEqual(validatePath('foo..bar').valid, true);
      assert.strictEqual(validatePath('file...ext').valid, true);
    });

    it('should reject single dot followed by slash', () => {
      assert.strictEqual(validatePath('./').valid, false);
    });

    it('should reject paths trying to escape via double encoding', () => {
      // %252e would be %-encoded and rejected by char check
      assert.strictEqual(validatePath('%252e%252e/').valid, false);
    });
  });
});
