/**
 * Tests for the Session Path Helper module.
 * Covers URL parsing, session path generation, and validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseRepoUrl,
  generateSessionPath,
  parseSessionPath,
  sessionPathToDir,
  validateSessionPath
} from '../src/utils/helpers/sessionPathHelper.js';

describe('Session Path Helper Module', () => {
  describe('parseRepoUrl', () => {
    describe('HTTPS format', () => {
      it('should parse standard HTTPS URL', () => {
        const result = parseRepoUrl('https://github.com/owner/repo');

        assert.strictEqual(result.owner, 'owner');
        assert.strictEqual(result.repo, 'repo');
      });

      it('should parse HTTPS URL with .git suffix', () => {
        const result = parseRepoUrl('https://github.com/myorg/myrepo.git');

        assert.strictEqual(result.owner, 'myorg');
        assert.strictEqual(result.repo, 'myrepo');
      });

      it('should handle hyphenated owner and repo names', () => {
        const result = parseRepoUrl('https://github.com/my-org/my-repo');

        assert.strictEqual(result.owner, 'my-org');
        assert.strictEqual(result.repo, 'my-repo');
      });

      it('should handle repo names with dots', () => {
        const result = parseRepoUrl('https://github.com/owner/repo.name');

        assert.strictEqual(result.owner, 'owner');
        assert.strictEqual(result.repo, 'repo.name');
      });

      it('should handle numeric repo names', () => {
        const result = parseRepoUrl('https://github.com/org123/repo456');

        assert.strictEqual(result.owner, 'org123');
        assert.strictEqual(result.repo, 'repo456');
      });
    });

    describe('SSH format', () => {
      it('should parse SSH URL', () => {
        const result = parseRepoUrl('git@github.com:owner/repo.git');

        assert.strictEqual(result.owner, 'owner');
        assert.strictEqual(result.repo, 'repo');
      });

      it('should parse SSH URL without .git suffix', () => {
        const result = parseRepoUrl('git@github.com:myorg/myrepo');

        assert.strictEqual(result.owner, 'myorg');
        assert.strictEqual(result.repo, 'myrepo');
      });

      it('should handle hyphenated names in SSH format', () => {
        const result = parseRepoUrl('git@github.com:my-org/my-repo.git');

        assert.strictEqual(result.owner, 'my-org');
        assert.strictEqual(result.repo, 'my-repo');
      });
    });

    describe('error handling', () => {
      it('should throw for invalid URL format', () => {
        assert.throws(
          () => parseRepoUrl('invalid-url'),
          /Invalid GitHub repository URL/
        );
      });

      it('should throw for non-GitHub URL', () => {
        assert.throws(
          () => parseRepoUrl('https://gitlab.com/owner/repo'),
          /Invalid GitHub repository URL/
        );
      });

      it('should throw for malformed HTTPS URL', () => {
        assert.throws(
          () => parseRepoUrl('https://github.com/'),
          /Invalid GitHub repository URL/
        );
      });

      it('should throw for URL missing repo', () => {
        assert.throws(
          () => parseRepoUrl('https://github.com/owner'),
          /Invalid GitHub repository URL/
        );
      });
    });
  });

  describe('generateSessionPath', () => {
    it('should generate correct path format', () => {
      const path = generateSessionPath('owner', 'repo', 'main');

      assert.strictEqual(path, 'owner__repo__main');
    });

    it('should sanitize slashes in branch name', () => {
      const path = generateSessionPath('owner', 'repo', 'feature/new-feature');

      assert.strictEqual(path, 'owner__repo__feature-new-feature');
      assert.ok(!path.includes('/'));
    });

    it('should handle multiple slashes in branch', () => {
      const path = generateSessionPath('org', 'project', 'user/feature/auth');

      assert.strictEqual(path, 'org__project__user-feature-auth');
    });

    it('should handle hyphenated names', () => {
      const path = generateSessionPath('my-org', 'my-repo', 'my-branch');

      assert.strictEqual(path, 'my-org__my-repo__my-branch');
    });

    it('should handle underscored names', () => {
      const path = generateSessionPath('my_org', 'my_repo', 'my_branch');

      assert.strictEqual(path, 'my_org__my_repo__my_branch');
    });

    it('should handle dots in names', () => {
      const path = generateSessionPath('owner', 'repo.js', 'v1.2.3');

      assert.strictEqual(path, 'owner__repo.js__v1.2.3');
    });

    it('should sanitize double underscores in branch', () => {
      const path = generateSessionPath('owner', 'repo', 'branch__test');

      // Double underscores should be replaced to avoid conflicts with separator
      assert.strictEqual(path, 'owner__repo__branch-test');
    });

    it('should handle special characters', () => {
      const path = generateSessionPath('owner', 'repo', 'feature@123!');

      // Special chars should be replaced with dashes
      assert.ok(!path.includes('@'));
      assert.ok(!path.includes('!'));
    });
  });

  describe('parseSessionPath', () => {
    it('should parse valid session path', () => {
      const result = parseSessionPath('owner__repo__main');

      assert.strictEqual(result.owner, 'owner');
      assert.strictEqual(result.repo, 'repo');
      assert.strictEqual(result.branch, 'main');
    });

    it('should parse path with hyphenated names', () => {
      const result = parseSessionPath('my-org__my-repo__feature-branch');

      assert.strictEqual(result.owner, 'my-org');
      assert.strictEqual(result.repo, 'my-repo');
      assert.strictEqual(result.branch, 'feature-branch');
    });

    it('should parse path with sanitized branch name', () => {
      const result = parseSessionPath('owner__repo__feature-user-auth');

      assert.strictEqual(result.owner, 'owner');
      assert.strictEqual(result.repo, 'repo');
      assert.strictEqual(result.branch, 'feature-user-auth');
    });

    it('should throw for invalid format (missing parts)', () => {
      assert.throws(
        () => parseSessionPath('owner__repo'),
        /Invalid session path format/
      );
    });

    it('should throw for invalid format (too many parts)', () => {
      assert.throws(
        () => parseSessionPath('owner__repo__branch__extra'),
        /Invalid session path format/
      );
    });

    it('should throw for path without separator', () => {
      assert.throws(
        () => parseSessionPath('owner-repo-branch'),
        /Invalid session path format/
      );
    });
  });

  describe('sessionPathToDir', () => {
    it('should return path unchanged (passthrough)', () => {
      const path = 'owner__repo__branch';
      const dir = sessionPathToDir(path);

      assert.strictEqual(dir, path);
    });

    it('should preserve sanitized paths', () => {
      const path = 'owner__repo__feature-branch';
      const dir = sessionPathToDir(path);

      assert.strictEqual(dir, 'owner__repo__feature-branch');
    });
  });

  describe('validateSessionPath', () => {
    it('should not throw for valid path', () => {
      assert.doesNotThrow(() => validateSessionPath('owner__repo__branch'));
    });

    it('should not throw for path with hyphens', () => {
      assert.doesNotThrow(() => validateSessionPath('my-org__my-repo__my-branch'));
    });

    it('should throw for path containing slash', () => {
      assert.throws(
        () => validateSessionPath('owner__repo__feature/branch'),
        /must not contain "\/" characters/
      );
    });

    it('should throw for empty path', () => {
      assert.throws(
        () => validateSessionPath(''),
        /required and cannot be empty/
      );
    });

    it('should throw for whitespace-only path', () => {
      assert.throws(
        () => validateSessionPath('   '),
        /required and cannot be empty/
      );
    });

    it('should throw for path with nested slashes', () => {
      assert.throws(
        () => validateSessionPath('owner/repo/branch'),
        /must not contain "\/" characters/
      );
    });
  });

  describe('round-trip conversion', () => {
    it('should parse URL and generate valid session path', () => {
      const { owner, repo } = parseRepoUrl('https://github.com/myorg/myrepo');
      const path = generateSessionPath(owner, repo, 'main');
      const parsed = parseSessionPath(path);

      assert.strictEqual(parsed.owner, owner);
      assert.strictEqual(parsed.repo, repo);
      assert.strictEqual(parsed.branch, 'main');
    });

    it('should handle complex workflow', () => {
      const { owner, repo } = parseRepoUrl('https://github.com/test-org/test-repo.git');
      const path = generateSessionPath(owner, repo, 'feature/user/authentication');

      validateSessionPath(path);
      const parsed = parseSessionPath(path);

      assert.strictEqual(parsed.owner, owner);
      assert.strictEqual(parsed.repo, repo);
      assert.strictEqual(parsed.branch, 'feature-user-authentication');
    });

    it('should preserve data through generate->parse cycle', () => {
      const original = { owner: 'owner', repo: 'repo', branch: 'main' };
      const path = generateSessionPath(original.owner, original.repo, original.branch);
      const result = parseSessionPath(path);

      assert.deepStrictEqual(result, original);
    });
  });

  describe('edge cases', () => {
    it('should handle very long branch names', () => {
      const longBranch = 'feature/' + 'a'.repeat(200);
      const path = generateSessionPath('owner', 'repo', longBranch);

      assert.ok(path.length > 200);
      assert.ok(!path.includes('/'));
      validateSessionPath(path);
    });

    it('should handle branch names with numbers only', () => {
      const path = generateSessionPath('owner', 'repo', '12345');

      assert.strictEqual(path, 'owner__repo__12345');
    });

    it('should handle single character components', () => {
      const path = generateSessionPath('a', 'b', 'c');

      assert.strictEqual(path, 'a__b__c');
    });

    it('should handle version-like branches', () => {
      const path = generateSessionPath('owner', 'repo', 'v1.2.3-beta.1');

      assert.ok(path.includes('v1.2.3-beta.1'));
    });

    it('should handle release branches', () => {
      const path = generateSessionPath('owner', 'repo', 'release/2024.01');

      assert.strictEqual(path, 'owner__repo__release-2024.01');
    });

    it('should handle GitHub Actions branches', () => {
      const path = generateSessionPath('owner', 'repo', 'dependabot/npm_and_yarn/lodash-4.17.21');

      assert.ok(!path.includes('/'));
      assert.ok(path.includes('dependabot-npm_and_yarn-lodash-4.17.21'));
    });
  });
});

describe('Session Path Integration', () => {
  it('should work with typical GitHub workflow', () => {
    // Simulate: Clone repo -> Create feature branch -> Generate session path
    const repoUrl = 'https://github.com/etdofresh/webedt.git';
    const { owner, repo } = parseRepoUrl(repoUrl);
    const featureBranch = 'feature/issue-402-add-tests';

    const sessionPath = generateSessionPath(owner, repo, featureBranch);

    // Validate the result
    validateSessionPath(sessionPath);
    assert.ok(!sessionPath.includes('/'));
    assert.ok(sessionPath.startsWith('etdofresh__webedt__'));

    // Parse it back
    const parsed = parseSessionPath(sessionPath);
    assert.strictEqual(parsed.owner, 'etdofresh');
    assert.strictEqual(parsed.repo, 'webedt');
    assert.strictEqual(parsed.branch, 'feature-issue-402-add-tests');
  });

  it('should handle SSH clones', () => {
    const repoUrl = 'git@github.com:organization/private-repo.git';
    const { owner, repo } = parseRepoUrl(repoUrl);
    const branch = 'bugfix/critical-fix';

    const sessionPath = generateSessionPath(owner, repo, branch);
    validateSessionPath(sessionPath);

    assert.strictEqual(sessionPath, 'organization__private-repo__bugfix-critical-fix');
  });
});
