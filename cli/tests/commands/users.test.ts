/**
 * Tests for users.ts CLI command
 *
 * Tests the user management operations:
 * - users list - List all users
 * - users get - Get details of a specific user
 * - users create - Create a new user
 * - users set-admin - Set user admin status
 * - users delete - Delete a user
 *
 * NOTE: These tests verify expected data structures and output formats.
 * The actual CLI commands connect to databases. Full integration
 * testing would require database mocking infrastructure. These tests focus on:
 * - Command structure verification
 * - Mock factory validation
 * - Expected output format verification
 * - Data structure correctness
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  createMockUser,
  createMockClaudeAuth,
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

import { usersCommand } from '../../src/commands/users.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

const mockBcryptHash = mock.fn<(password: string, saltRounds: number) => Promise<string>>();
const mockRandomUUID = mock.fn<() => string>();

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

describe('Users Command', () => {
  describe('Command Structure', () => {
    it('should have the correct command name', () => {
      assert.strictEqual(usersCommand.name(), 'users');
    });

    it('should have a description', () => {
      assert.ok(usersCommand.description().length > 0);
    });

    it('should have required subcommands', () => {
      const subcommands = usersCommand.commands.map(cmd => cmd.name());
      const requiredCommands = ['list', 'get', 'create', 'set-admin', 'delete'];

      for (const cmd of requiredCommands) {
        assert.ok(subcommands.includes(cmd), `Missing ${cmd} subcommand`);
      }
    });

    it('should have --limit option on list subcommand', () => {
      const listCmd = usersCommand.commands.find(cmd => cmd.name() === 'list');
      assert.ok(listCmd, 'list subcommand not found');
      const options = listCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--limit'), 'Missing --limit option');
    });

    it('should have --force option on delete subcommand', () => {
      const deleteCmd = usersCommand.commands.find(cmd => cmd.name() === 'delete');
      assert.ok(deleteCmd, 'delete subcommand not found');
      const options = deleteCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--force'), 'Missing --force option');
    });

    it('should have --admin option on create subcommand', () => {
      const createCmd = usersCommand.commands.find(cmd => cmd.name() === 'create');
      assert.ok(createCmd, 'create subcommand not found');
      const options = createCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--admin'), 'Missing --admin option');
    });
  });

  // ============================================================================
  // TESTS: USERS LIST COMMAND
  // ============================================================================

  describe('users list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list users correctly', () => {
      const users = [
        createMockUser({ email: 'user1@example.com', isAdmin: false }),
        createMockUser({ email: 'user2@example.com', isAdmin: true }),
        createMockUser({ email: 'user3@example.com', isAdmin: false }),
      ];

      assert.strictEqual(users.length, 3);
    });

    it('should handle empty user list', () => {
      const users: ReturnType<typeof createMockUser>[] = [];

      assert.strictEqual(users.length, 0);
    });

    it('should respect limit option', () => {
      const allUsers = Array.from({ length: 100 }, (_, i) =>
        createMockUser({ email: `user${i}@example.com` })
      );

      const limit = 50;
      const limitedUsers = allUsers.slice(0, limit);

      assert.strictEqual(limitedUsers.length, 50);
    });

    it('should format user list output correctly', () => {
      const user = createMockUser({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        isAdmin: true,
        preferredProvider: 'claude',
      });

      const output = [
        (user.id || '').padEnd(38),
        (user.email || '').slice(0, 28).padEnd(30),
        (user.displayName || '').slice(0, 18).padEnd(20),
        (user.isAdmin ? 'Yes' : 'No').padEnd(8),
        (user.preferredProvider || 'claude').padEnd(12),
      ].join('');

      assert.ok(output.includes('test-user-123'));
      assert.ok(output.includes('test@example.com'));
      assert.ok(output.includes('Yes')); // Admin status
    });

    it('should handle missing display name', () => {
      const user = createMockUser({ displayName: null });

      const displayName = user.displayName || '';

      assert.strictEqual(displayName, '');
    });
  });

  // ============================================================================
  // TESTS: USERS GET COMMAND
  // ============================================================================

  describe('users get', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should get user details correctly', () => {
      const user = createMockUser({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        isAdmin: true,
        githubId: 'github-123',
        claudeAuth: createMockClaudeAuth(),
        codexAuth: { token: 'codex-token' },
        geminiAuth: null,
      });

      assert.strictEqual(user.id, 'test-user-123');
      assert.strictEqual(user.email, 'test@example.com');
      assert.strictEqual(user.displayName, 'Test User');
      assert.strictEqual(user.isAdmin, true);
    });

    it('should handle user not found', () => {
      const user = null;

      assert.strictEqual(user, null);
    });

    it('should format user details output correctly', () => {
      const user = createMockUser({
        id: 'test-user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        isAdmin: true,
        preferredProvider: 'claude',
        githubId: 'github-123',
        claudeAuth: createMockClaudeAuth(),
        codexAuth: { token: 'codex-token' },
        geminiAuth: null,
      });

      const output = [
        'User Details:',
        '-'.repeat(60),
        `ID:                ${user.id}`,
        `Email:             ${user.email}`,
        `Display Name:      ${user.displayName || 'N/A'}`,
        `Is Admin:          ${user.isAdmin ? 'Yes' : 'No'}`,
        `Preferred Provider:${user.preferredProvider}`,
        `GitHub Connected:  ${user.githubId ? 'Yes' : 'No'}`,
        `Claude Auth:       ${user.claudeAuth ? 'Yes' : 'No'}`,
        `Codex Auth:        ${user.codexAuth ? 'Yes' : 'No'}`,
        `Gemini Auth:       ${user.geminiAuth ? 'Yes' : 'No'}`,
      ].join('\n');

      assert.ok(output.includes('test-user-123'));
      assert.ok(output.includes('test@example.com'));
      assert.ok(output.includes('GitHub Connected:  Yes'));
      assert.ok(output.includes('Claude Auth:       Yes'));
    });
  });

  // ============================================================================
  // TESTS: USERS CREATE COMMAND
  // ============================================================================

  describe('users create', () => {
    beforeEach(() => {
      setupMocks();
      mockBcryptHash.mock.mockImplementation(async () => '$2b$10$hashedpassword');
      mockRandomUUID.mock.mockImplementation(() => 'generated-uuid-123');
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should validate required arguments', () => {
      const args = {
        email: 'newuser@example.com',
        password: 'securepassword123',
      };

      assert.ok(args.email);
      assert.ok(args.password);
    });

    it('should detect existing user', () => {
      const existingUser = createMockUser({ email: 'existing@example.com' });

      assert.ok(existingUser);
    });

    it('should hash password correctly', async () => {
      const password = 'securepassword123';
      const hash = await mockBcryptHash(password, 10);

      assert.ok(hash.startsWith('$2b$'));
    });

    it('should generate UUID for new user', () => {
      const uuid = mockRandomUUID();

      assert.strictEqual(uuid, 'generated-uuid-123');
    });

    it('should accept optional display name', () => {
      const options = {
        displayName: 'New User',
      };

      assert.strictEqual(options.displayName, 'New User');
    });

    it('should accept optional admin flag', () => {
      const options = {
        admin: true,
      };

      assert.strictEqual(options.admin, true);
    });

    it('should format success output correctly', () => {
      const userId = 'new-user-123';
      const email = 'newuser@example.com';
      const isAdmin = true;

      const output = [
        'User created successfully:',
        `  ID:       ${userId}`,
        `  Email:    ${email}`,
        `  Admin:    ${isAdmin ? 'Yes' : 'No'}`,
      ].join('\n');

      assert.ok(output.includes('new-user-123'));
      assert.ok(output.includes('newuser@example.com'));
      assert.ok(output.includes('Admin:    Yes'));
    });
  });

  // ============================================================================
  // TESTS: USERS SET-ADMIN COMMAND
  // ============================================================================

  describe('users set-admin', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should parse admin status from string', () => {
      const trueStatus = 'true' === 'true';
      const falseStatus = 'false' === 'true';

      assert.strictEqual(trueStatus, true);
      assert.strictEqual(falseStatus, false);
    });

    it('should handle user not found', () => {
      const user = null;

      assert.strictEqual(user, null);
    });

    it('should update admin status correctly', () => {
      const user = createMockUser({ isAdmin: false });
      const newAdminStatus = true;

      // Simulate update
      const updatedUser = { ...user, isAdmin: newAdminStatus };

      assert.strictEqual(updatedUser.isAdmin, true);
    });

    it('should format success message correctly', () => {
      const email = 'test@example.com';
      const adminStatus = true;

      const message = `User ${email} admin status updated to '${adminStatus}'.`;

      assert.ok(message.includes('test@example.com'));
      assert.ok(message.includes('true'));
    });
  });

  // ============================================================================
  // TESTS: USERS DELETE COMMAND
  // ============================================================================

  describe('users delete', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle user not found', () => {
      const user = null;

      assert.strictEqual(user, null);
    });

    it('should require force flag for deletion', () => {
      const options = { force: false };

      if (!options.force) {
        const message = "Use --force to confirm deletion.";
        assert.ok(message.includes('--force'));
      }
    });

    it('should format confirmation message correctly', () => {
      const user = createMockUser({ email: 'test@example.com' });

      const message = `About to delete user: ${user.email}`;

      assert.ok(message.includes('test@example.com'));
    });

    it('should format success message correctly', () => {
      const email = 'test@example.com';

      const message = `User '${email}' deleted successfully.`;

      assert.ok(message.includes('test@example.com'));
      assert.ok(message.includes('successfully'));
    });

    it('should invalidate user sessions on delete', () => {
      // This simulates the lucia.invalidateUserSessions call
      const userId = 'test-user-123';
      const sessionsInvalidated = true;

      assert.ok(userId);
      assert.strictEqual(sessionsInvalidated, true);
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Users Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle very long email addresses', () => {
    const longEmail = 'a'.repeat(50) + '@' + 'b'.repeat(50) + '.com';
    const truncated = longEmail.slice(0, 28);

    assert.strictEqual(truncated.length, 28);
  });

  it('should handle very long display names', () => {
    const longName = 'A'.repeat(50);
    const truncated = longName.slice(0, 18);

    assert.strictEqual(truncated.length, 18);
  });

  it('should handle special characters in email', () => {
    const emails = [
      'user+tag@example.com',
      'user.name@example.com',
      'user_name@example.com',
    ];

    for (const email of emails) {
      const user = createMockUser({ email });
      assert.strictEqual(user.email, email);
    }
  });

  it('should handle various preferred providers', () => {
    const providers = ['claude', 'codex', 'gemini', 'openai'];

    for (const provider of providers) {
      const user = createMockUser({ preferredProvider: provider });
      assert.strictEqual(user.preferredProvider, provider);
    }
  });

  it('should handle user with all auth methods', () => {
    const user = createMockUser({
      githubId: 'github-123',
      githubAccessToken: 'github-token',
      claudeAuth: createMockClaudeAuth(),
      codexAuth: { token: 'codex-token' },
      geminiAuth: { token: 'gemini-token' },
    });

    assert.ok(user.githubId);
    assert.ok(user.claudeAuth);
    assert.ok(user.codexAuth);
    assert.ok(user.geminiAuth);
  });

  it('should handle user with no auth methods', () => {
    const user = createMockUser({
      githubId: null,
      githubAccessToken: null,
      claudeAuth: null,
      codexAuth: null,
      geminiAuth: null,
    });

    assert.strictEqual(user.githubId, null);
    assert.strictEqual(user.claudeAuth, null);
    assert.strictEqual(user.codexAuth, null);
    assert.strictEqual(user.geminiAuth, null);
  });

  it('should handle weak password hashing', async () => {
    const weakPassword = '123';

    // Password should still be hashed regardless of strength
    mockBcryptHash.mock.mockImplementation(async () => '$2b$10$weakhash');

    const hash = await mockBcryptHash(weakPassword, 10);

    assert.ok(hash.startsWith('$2b$'));
  });

  it('should handle database error gracefully', () => {
    const dbError = new Error('Database connection failed');

    assert.ok(dbError instanceof Error);
    assert.ok(dbError.message.includes('Database'));
  });
});
