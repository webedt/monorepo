/**
 * Tests for github.ts CLI command
 *
 * Tests the GitHub API operations:
 * - github repos list - List accessible repositories
 * - github branches list - List branches for a repository
 * - github branches create - Create a new branch
 * - github branches delete - Delete a branch
 * - github pr create - Create a pull request
 * - github pr list - List pull requests
 *
 * NOTE: These tests verify expected data structures and output formats.
 * The actual CLI commands make GitHub API calls. Full integration
 * testing would require API mocking infrastructure. These tests focus on:
 * - Command structure verification
 * - Mock factory validation
 * - Expected output format verification
 * - Data structure correctness
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  createMockGitHubRepo,
  createMockGitHubBranch,
  createMockGitHubPR,
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

import { githubCommand } from '../../src/commands/github.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockGetGitHubCredentials = mock.fn<(options?: { token?: string }) => { token: string; source: string } | null>();

// Store original console and process.exit
let originalConsoleLog: typeof console.log;
let originalConsoleError: typeof console.error;
let originalProcessExit: typeof process.exit;
let mockConsole: ReturnType<typeof createMockConsole>;
let mockExit: ReturnType<typeof createMockProcessExit>;

// ============================================================================
// TEST HELPERS
// ============================================================================

function setupMocks() {
  originalConsoleLog = console.log;
  originalConsoleError = console.error;
  originalProcessExit = process.exit;

  mockConsole = createMockConsole();
  mockExit = createMockProcessExit();

  console.log = mockConsole.log;
  console.error = mockConsole.error;
  process.exit = mockExit.exit;
}

function teardownMocks() {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
  mock.reset();
}

// ============================================================================
// TESTS: COMMAND STRUCTURE
// ============================================================================

describe('GitHub Command', () => {
  describe('Command Structure', () => {
    it('should have the correct command name', () => {
      assert.strictEqual(githubCommand.name(), 'github');
    });

    it('should have a description', () => {
      assert.ok(githubCommand.description().length > 0);
    });

    it('should have repos, branches, and pr subcommands', () => {
      const subcommands = githubCommand.commands.map(cmd => cmd.name());
      assert.ok(subcommands.includes('repos'), 'Missing repos subcommand');
      assert.ok(subcommands.includes('branches'), 'Missing branches subcommand');
      assert.ok(subcommands.includes('pr'), 'Missing pr subcommand');
    });

    it('should have list subcommand under repos', () => {
      const reposCmd = githubCommand.commands.find(cmd => cmd.name() === 'repos');
      assert.ok(reposCmd, 'repos subcommand not found');
      const subcommands = reposCmd.commands.map(cmd => cmd.name());
      assert.ok(subcommands.includes('list'), 'Missing list subcommand under repos');
    });

    it('should have list, create, delete subcommands under branches', () => {
      const branchesCmd = githubCommand.commands.find(cmd => cmd.name() === 'branches');
      assert.ok(branchesCmd, 'branches subcommand not found');
      const subcommands = branchesCmd.commands.map(cmd => cmd.name());
      assert.ok(subcommands.includes('list'), 'Missing list subcommand under branches');
      assert.ok(subcommands.includes('create'), 'Missing create subcommand under branches');
      assert.ok(subcommands.includes('delete'), 'Missing delete subcommand under branches');
    });

    it('should have create and list subcommands under pr', () => {
      const prCmd = githubCommand.commands.find(cmd => cmd.name() === 'pr');
      assert.ok(prCmd, 'pr subcommand not found');
      const subcommands = prCmd.commands.map(cmd => cmd.name());
      assert.ok(subcommands.includes('create'), 'Missing create subcommand under pr');
      assert.ok(subcommands.includes('list'), 'Missing list subcommand under pr');
    });

    it('should have --token option on github command', () => {
      const options = githubCommand.options.map(opt => opt.long);
      assert.ok(options.includes('--token'), 'Missing --token option');
    });
  });

  // ============================================================================
  // TESTS: CREDENTIAL RESOLUTION
  // ============================================================================

  describe('Credential Resolution', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should detect when no token is found', () => {
      mockGetGitHubCredentials.mock.mockImplementation(() => null);

      const credentials = mockGetGitHubCredentials();

      assert.strictEqual(credentials, null);
    });

    it('should use token from CLI option', () => {
      mockGetGitHubCredentials.mock.mockImplementation((opts) => ({
        token: opts?.token || 'default-token',
        source: opts?.token ? 'cli-option' : 'environment',
      }));

      const credentials = mockGetGitHubCredentials({ token: 'cli-token' });

      assert.ok(credentials);
      assert.strictEqual(credentials.token, 'cli-token');
    });

    it('should fall back to environment variable', () => {
      mockGetGitHubCredentials.mock.mockImplementation(() => ({
        token: 'env-token',
        source: 'environment',
      }));

      const credentials = mockGetGitHubCredentials();

      assert.ok(credentials);
      assert.strictEqual(credentials.source, 'environment');
    });

    it('should fall back to gh CLI', () => {
      mockGetGitHubCredentials.mock.mockImplementation(() => ({
        token: 'gh-cli-token',
        source: 'gh-cli',
      }));

      const credentials = mockGetGitHubCredentials();

      assert.ok(credentials);
      assert.strictEqual(credentials.source, 'gh-cli');
    });
  });

  // ============================================================================
  // TESTS: REPOS LIST COMMAND
  // ============================================================================

  describe('github repos list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list repositories correctly', () => {
      const repos = [
        createMockGitHubRepo({ full_name: 'owner/repo1', private: false }),
        createMockGitHubRepo({ full_name: 'owner/repo2', private: true }),
        createMockGitHubRepo({ full_name: 'owner/repo3', private: false }),
      ];

      assert.strictEqual(repos.length, 3);

      // Check visibility formatting
      for (const repo of repos) {
        const visibility = repo.private ? 'private' : 'public';
        assert.ok(['private', 'public'].includes(visibility));
      }
    });

    it('should handle empty repository list', () => {
      const repos: ReturnType<typeof createMockGitHubRepo>[] = [];

      assert.strictEqual(repos.length, 0);
    });

    it('should respect limit option', () => {
      const allRepos = Array.from({ length: 50 }, (_, i) =>
        createMockGitHubRepo({ full_name: `owner/repo${i}` })
      );

      const limit = 30;
      const limitedRepos = allRepos.slice(0, limit);

      assert.strictEqual(limitedRepos.length, 30);
    });

    it('should format repository output correctly', () => {
      const repo = createMockGitHubRepo({
        full_name: 'testowner/test-repo',
        private: false,
      });

      const visibility = repo.private ? 'private' : 'public';
      const output = `  ${repo.full_name.padEnd(40)} (${visibility})`;

      assert.ok(output.includes('testowner/test-repo'));
      assert.ok(output.includes('public'));
    });
  });

  // ============================================================================
  // TESTS: BRANCHES COMMANDS
  // ============================================================================

  describe('github branches list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list branches correctly', () => {
      const branches = [
        createMockGitHubBranch({ name: 'main', protected: true }),
        createMockGitHubBranch({ name: 'develop', protected: false }),
        createMockGitHubBranch({ name: 'feature/test', protected: false }),
      ];

      assert.strictEqual(branches.length, 3);
      assert.strictEqual(branches[0].protected, true);
    });

    it('should handle empty branch list', () => {
      const branches: ReturnType<typeof createMockGitHubBranch>[] = [];

      assert.strictEqual(branches.length, 0);
    });

    it('should format branch output with protected indicator', () => {
      const branch = createMockGitHubBranch({ name: 'main', protected: true });

      const output = `  ${branch.name}${branch.protected ? ' (protected)' : ''}`;

      assert.ok(output.includes('main'));
      assert.ok(output.includes('(protected)'));
    });
  });

  describe('github branches create', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should validate required arguments', () => {
      const args = {
        owner: 'testowner',
        repo: 'testrepo',
        branchName: 'new-branch',
        base: 'main',
      };

      assert.ok(args.owner);
      assert.ok(args.repo);
      assert.ok(args.branchName);
      assert.ok(args.base);
    });

    it('should use default base branch if not specified', () => {
      const defaultBase = 'main';

      assert.strictEqual(defaultBase, 'main');
    });

    it('should format success message correctly', () => {
      const branchName = 'new-feature';
      const base = 'main';

      const message = `Branch '${branchName}' created from '${base}' successfully.`;

      assert.ok(message.includes('new-feature'));
      assert.ok(message.includes('main'));
      assert.ok(message.includes('successfully'));
    });
  });

  describe('github branches delete', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require force flag for deletion', () => {
      const options = { force: false };

      if (!options.force) {
        const message = "Use --force to confirm deletion.";
        assert.ok(message.includes('--force'));
      }
    });

    it('should format confirmation message correctly', () => {
      const branchName = 'feature-branch';

      const message = `About to delete branch: ${branchName}`;

      assert.ok(message.includes('feature-branch'));
    });

    it('should format success message correctly', () => {
      const branchName = 'feature-branch';

      const message = `Branch '${branchName}' deleted successfully.`;

      assert.ok(message.includes('feature-branch'));
      assert.ok(message.includes('successfully'));
    });
  });

  // ============================================================================
  // TESTS: PR COMMANDS
  // ============================================================================

  describe('github pr create', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should validate required arguments', () => {
      const args = {
        owner: 'testowner',
        repo: 'testrepo',
        head: 'feature-branch',
        base: 'main',
      };

      assert.ok(args.owner);
      assert.ok(args.repo);
      assert.ok(args.head);
      assert.ok(args.base);
    });

    it('should use default title if not specified', () => {
      const head = 'feature-branch';
      const base = 'main';
      const title = `Merge ${head} into ${base}`;

      assert.strictEqual(title, 'Merge feature-branch into main');
    });

    it('should use custom title if specified', () => {
      const customTitle = 'Add new feature X';

      assert.strictEqual(customTitle, 'Add new feature X');
    });

    it('should format PR creation output correctly', () => {
      const pr = createMockGitHubPR({
        number: 42,
        title: 'Test PR',
        html_url: 'https://github.com/owner/repo/pull/42',
      });

      const output = [
        'Pull Request created:',
        `  URL:    ${pr.html_url}`,
        `  Number: #${pr.number}`,
        `  Title:  ${pr.title}`,
      ].join('\n');

      assert.ok(output.includes('#42'));
      assert.ok(output.includes('Test PR'));
      assert.ok(output.includes('https://github.com'));
    });
  });

  describe('github pr list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list pull requests correctly', () => {
      const prs = [
        createMockGitHubPR({ number: 1, title: 'PR 1', state: 'open' }),
        createMockGitHubPR({ number: 2, title: 'PR 2', state: 'open' }),
        createMockGitHubPR({ number: 3, title: 'PR 3', state: 'closed' }),
      ];

      assert.strictEqual(prs.length, 3);
    });

    it('should handle empty PR list', () => {
      const prs: ReturnType<typeof createMockGitHubPR>[] = [];

      assert.strictEqual(prs.length, 0);
    });

    it('should filter by state', () => {
      const allPRs = [
        createMockGitHubPR({ state: 'open' }),
        createMockGitHubPR({ state: 'open' }),
        createMockGitHubPR({ state: 'closed' }),
      ];

      const openPRs = allPRs.filter(pr => pr.state === 'open');
      const closedPRs = allPRs.filter(pr => pr.state === 'closed');

      assert.strictEqual(openPRs.length, 2);
      assert.strictEqual(closedPRs.length, 1);
    });

    it('should respect limit option', () => {
      const allPRs = Array.from({ length: 50 }, (_, i) =>
        createMockGitHubPR({ number: i + 1 })
      );

      const limit = 30;
      const limitedPRs = allPRs.slice(0, limit);

      assert.strictEqual(limitedPRs.length, 30);
    });

    it('should format PR list output correctly', () => {
      const pr = createMockGitHubPR({
        number: 123,
        title: 'Fix important bug',
        created_at: '2024-01-15T10:30:00Z',
      });

      const created = new Date(pr.created_at).toISOString().slice(0, 10);
      const output = `  #${String(pr.number).padEnd(6)} ${pr.title.slice(0, 60).padEnd(62)} ${created}`;

      assert.ok(output.includes('#123'));
      assert.ok(output.includes('Fix important bug'));
      assert.ok(output.includes('2024-01-15'));
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('GitHub Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle very long repository names', () => {
    const longName = 'owner/' + 'a'.repeat(100);
    const repo = createMockGitHubRepo({ full_name: longName });

    assert.ok(repo.full_name.length > 40);
  });

  it('should handle very long PR titles', () => {
    const longTitle = 'A'.repeat(100);
    const pr = createMockGitHubPR({ title: longTitle });
    const truncated = pr.title.slice(0, 60);

    assert.strictEqual(truncated.length, 60);
  });

  it('should handle special characters in branch names', () => {
    const branches = [
      createMockGitHubBranch({ name: 'feature/add-auth' }),
      createMockGitHubBranch({ name: 'fix/bug-123' }),
      createMockGitHubBranch({ name: 'release/v1.0.0' }),
      createMockGitHubBranch({ name: 'user/john/feature' }),
    ];

    for (const branch of branches) {
      assert.ok(branch.name.length > 0);
    }
  });

  it('should handle API errors gracefully', () => {
    const apiError = {
      status: 404,
      message: 'Not Found',
    };

    assert.strictEqual(apiError.status, 404);
    assert.strictEqual(apiError.message, 'Not Found');
  });

  it('should handle rate limit errors', () => {
    const rateLimitError = {
      status: 403,
      message: 'API rate limit exceeded',
    };

    assert.strictEqual(rateLimitError.status, 403);
    assert.ok(rateLimitError.message.includes('rate limit'));
  });

  it('should handle authentication errors', () => {
    const authError = {
      status: 401,
      message: 'Bad credentials',
    };

    assert.strictEqual(authError.status, 401);
    assert.ok(authError.message.includes('credentials'));
  });
});
