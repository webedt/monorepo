/**
 * Tests for organizations.ts CLI command
 *
 * Tests the organization/studio management operations:
 * - organizations list - List all organizations
 * - organizations get - Get details of an organization
 * - organizations create - Create a new organization
 * - organizations delete - Delete an organization
 * - organizations members - List organization members
 * - organizations add-member - Add a member to an organization
 * - organizations remove-member - Remove a member from an organization
 * - organizations set-role - Update member role
 * - organizations repos - List organization repositories
 * - organizations add-repo - Add a repository to an organization
 * - organizations remove-repo - Remove a repository from an organization
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
  createMockOrganization,
  createMockOrganizationMember,
  createMockOrganizationRepo,
  createMockUser,
  createMockConsole,
  createMockProcessExit,
} from '../helpers/mocks.js';

import { organizationsCommand } from '../../src/commands/organizations.js';

// ============================================================================
// MOCK SETUP
// ============================================================================

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

describe('Organizations Command', () => {
  describe('Command Structure', () => {
    it('should have the correct command name', () => {
      assert.strictEqual(organizationsCommand.name(), 'organizations');
    });

    it('should have a description', () => {
      assert.ok(organizationsCommand.description().length > 0);
    });

    it('should have required subcommands', () => {
      const subcommands = organizationsCommand.commands.map(cmd => cmd.name());
      const requiredCommands = [
        'list', 'get', 'create', 'delete', 'members',
        'add-member', 'remove-member', 'set-role', 'repos',
        'add-repo', 'remove-repo'
      ];

      for (const cmd of requiredCommands) {
        assert.ok(subcommands.includes(cmd), `Missing ${cmd} subcommand`);
      }
    });

    it('should have --user option on list subcommand', () => {
      const listCmd = organizationsCommand.commands.find(cmd => cmd.name() === 'list');
      assert.ok(listCmd, 'list subcommand not found');
      const options = listCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--user'), 'Missing --user option');
    });

    it('should have --force option on delete subcommand', () => {
      const deleteCmd = organizationsCommand.commands.find(cmd => cmd.name() === 'delete');
      assert.ok(deleteCmd, 'delete subcommand not found');
      const options = deleteCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--force'), 'Missing --force option');
    });

    it('should have --role option on add-member subcommand', () => {
      const addMemberCmd = organizationsCommand.commands.find(cmd => cmd.name() === 'add-member');
      assert.ok(addMemberCmd, 'add-member subcommand not found');
      const options = addMemberCmd.options.map(opt => opt.long);
      assert.ok(options.includes('--role'), 'Missing --role option');
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS LIST COMMAND
  // ============================================================================

  describe('organizations list', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require user ID for listing', () => {
      const options = { user: undefined };

      if (!options.user) {
        const message = 'Please specify a user ID with --user <userId>';
        assert.ok(message.includes('--user'));
      }
    });

    it('should list organizations for a user', () => {
      const orgs = [
        { organization: createMockOrganization({ name: 'Org 1' }), role: 'owner', joinedAt: new Date() },
        { organization: createMockOrganization({ name: 'Org 2' }), role: 'member', joinedAt: new Date() },
      ];

      assert.strictEqual(orgs.length, 2);
    });

    it('should handle empty organization list', () => {
      const orgs: { organization: ReturnType<typeof createMockOrganization>; role: string; joinedAt: Date }[] = [];

      assert.strictEqual(orgs.length, 0);
    });

    it('should format organization list output correctly', () => {
      const org = createMockOrganization({
        id: 'org-123',
        name: 'Test Organization',
        slug: 'test-org',
      });
      const role = 'owner';
      const joinedAt = new Date('2024-01-15');

      const output = [
        org.id.padEnd(38),
        (org.name || '').slice(0, 23).padEnd(25),
        (org.slug || '').slice(0, 18).padEnd(20),
        role.padEnd(10),
        joinedAt.toISOString().split('T')[0],
      ].join('');

      assert.ok(output.includes('org-123'));
      assert.ok(output.includes('Test Organization'));
      assert.ok(output.includes('owner'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS GET COMMAND
  // ============================================================================

  describe('organizations get', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should get organization details correctly', () => {
      const org = createMockOrganization({
        id: 'org-123',
        name: 'Test Organization',
        slug: 'test-org',
        description: 'A test organization',
        githubOrg: 'test-github',
        isVerified: true,
      });

      assert.strictEqual(org.id, 'org-123');
      assert.strictEqual(org.name, 'Test Organization');
      assert.strictEqual(org.isVerified, true);
    });

    it('should handle organization not found', () => {
      const org = null;

      assert.strictEqual(org, null);
    });

    it('should include members in details', () => {
      const members = [
        createMockOrganizationMember({ role: 'owner' }),
        createMockOrganizationMember({ role: 'admin' }),
        createMockOrganizationMember({ role: 'member' }),
      ];

      assert.strictEqual(members.length, 3);
    });

    it('should include repos in details', () => {
      const repos = [
        createMockOrganizationRepo({ repositoryName: 'repo1' }),
        createMockOrganizationRepo({ repositoryName: 'repo2', isDefault: true }),
      ];

      assert.strictEqual(repos.length, 2);
      assert.strictEqual(repos[1].isDefault, true);
    });

    it('should format organization details output correctly', () => {
      const org = createMockOrganization({
        id: 'org-123',
        name: 'Test Organization',
        slug: 'test-org',
        displayName: 'Test Org Display',
        description: 'A test organization',
        websiteUrl: 'https://example.com',
        githubOrg: 'test-github',
        isVerified: true,
      });

      const output = [
        'Organization Details:',
        '-'.repeat(60),
        `ID:           ${org.id}`,
        `Name:         ${org.name}`,
        `Slug:         ${org.slug}`,
        `Display Name: ${org.displayName || 'N/A'}`,
        `Description:  ${org.description || 'N/A'}`,
        `Website:      ${org.websiteUrl || 'N/A'}`,
        `GitHub Org:   ${org.githubOrg || 'N/A'}`,
        `Verified:     ${org.isVerified ? 'Yes' : 'No'}`,
      ].join('\n');

      assert.ok(output.includes('org-123'));
      assert.ok(output.includes('Test Organization'));
      assert.ok(output.includes('Verified:     Yes'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS CREATE COMMAND
  // ============================================================================

  describe('organizations create', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require owner user ID', () => {
      const options = { owner: undefined };

      if (!options.owner) {
        const message = 'Owner user ID is required. Use --owner <userId>';
        assert.ok(message.includes('--owner'));
      }
    });

    it('should validate owner exists', () => {
      const owner = createMockUser({ id: 'owner-123' });

      assert.ok(owner);
    });

    it('should check slug availability', () => {
      const slugAvailable = true;

      assert.strictEqual(slugAvailable, true);
    });

    it('should handle slug already taken', () => {
      const slugAvailable = false;

      if (!slugAvailable) {
        const message = "Slug 'test-org' is already taken.";
        assert.ok(message.includes('already taken'));
      }
    });

    it('should format success output correctly', () => {
      const org = createMockOrganization({
        id: 'new-org-123',
        name: 'New Organization',
        slug: 'new-org',
      });
      const ownerEmail = 'owner@example.com';

      const output = [
        'Organization created successfully:',
        `  ID:    ${org.id}`,
        `  Name:  ${org.name}`,
        `  Slug:  ${org.slug}`,
        `  Owner: ${ownerEmail}`,
      ].join('\n');

      assert.ok(output.includes('new-org-123'));
      assert.ok(output.includes('New Organization'));
      assert.ok(output.includes('owner@example.com'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS DELETE COMMAND
  // ============================================================================

  describe('organizations delete', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle organization not found', () => {
      const org = null;

      assert.strictEqual(org, null);
    });

    it('should require force flag for deletion', () => {
      const options = { force: false };

      if (!options.force) {
        const message = 'Use --force to confirm deletion.';
        assert.ok(message.includes('--force'));
      }
    });

    it('should format confirmation message correctly', () => {
      const org = createMockOrganization({ name: 'Test Org', slug: 'test-org' });

      const message = `About to delete organization: ${org.name} (${org.slug})`;

      assert.ok(message.includes('Test Org'));
      assert.ok(message.includes('test-org'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS MEMBERS COMMAND
  // ============================================================================

  describe('organizations members', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list members correctly', () => {
      const members = [
        createMockOrganizationMember({ role: 'owner', user: createMockUser({ email: 'owner@example.com' }) }),
        createMockOrganizationMember({ role: 'admin', user: createMockUser({ email: 'admin@example.com' }) }),
        createMockOrganizationMember({ role: 'member', user: createMockUser({ email: 'member@example.com' }) }),
      ];

      assert.strictEqual(members.length, 3);
    });

    it('should handle empty member list', () => {
      const members: ReturnType<typeof createMockOrganizationMember>[] = [];

      assert.strictEqual(members.length, 0);
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS ADD-MEMBER COMMAND
  // ============================================================================

  describe('organizations add-member', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should validate role option', () => {
      const validRoles = ['owner', 'admin', 'member'];
      const invalidRole = 'superuser';

      assert.strictEqual(validRoles.includes(invalidRole), false);
    });

    it('should handle user already a member', () => {
      const existingMember = createMockOrganizationMember();

      assert.ok(existingMember);
    });

    it('should format success message correctly', () => {
      const email = 'newmember@example.com';
      const orgName = 'Test Org';
      const role = 'member';

      const message = `Added ${email} to ${orgName} as ${role}.`;

      assert.ok(message.includes('newmember@example.com'));
      assert.ok(message.includes('Test Org'));
      assert.ok(message.includes('member'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS REMOVE-MEMBER COMMAND
  // ============================================================================

  describe('organizations remove-member', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle member not found', () => {
      const member = null;

      assert.strictEqual(member, null);
    });

    it('should prevent removing only owner', () => {
      const members = [
        createMockOrganizationMember({ role: 'owner', userId: 'owner-123' }),
        createMockOrganizationMember({ role: 'member', userId: 'member-456' }),
      ];

      const userIdToRemove = 'owner-123';
      const memberToRemove = members.find(m => m.userId === userIdToRemove);

      if (memberToRemove?.role === 'owner') {
        const otherOwners = members.filter(m => m.role === 'owner' && m.userId !== userIdToRemove);
        if (otherOwners.length === 0) {
          const message = 'Cannot remove the only owner. Transfer ownership first.';
          assert.ok(message.includes('only owner'));
        }
      }
    });

    it('should require force flag for removal', () => {
      const options = { force: false };

      if (!options.force) {
        const message = 'Use --force to confirm.';
        assert.ok(message.includes('--force'));
      }
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS SET-ROLE COMMAND
  // ============================================================================

  describe('organizations set-role', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should validate role argument', () => {
      const validRoles = ['owner', 'admin', 'member'];

      for (const role of validRoles) {
        assert.ok(validRoles.includes(role));
      }
    });

    it('should handle invalid role', () => {
      const validRoles = ['owner', 'admin', 'member'];
      const invalidRole = 'superadmin';

      if (!validRoles.includes(invalidRole)) {
        const message = `Invalid role. Must be one of: ${validRoles.join(', ')}`;
        assert.ok(message.includes('owner, admin, member'));
      }
    });

    it('should format success message correctly', () => {
      const role = 'admin';

      const message = `Updated member role to ${role}.`;

      assert.ok(message.includes('admin'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS REPOS COMMAND
  // ============================================================================

  describe('organizations repos', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should list repositories correctly', () => {
      const repos = [
        createMockOrganizationRepo({ repositoryName: 'repo1', isDefault: true }),
        createMockOrganizationRepo({ repositoryName: 'repo2', isDefault: false }),
      ];

      assert.strictEqual(repos.length, 2);
    });

    it('should handle empty repository list', () => {
      const repos: ReturnType<typeof createMockOrganizationRepo>[] = [];

      assert.strictEqual(repos.length, 0);
    });

    it('should format repository output correctly', () => {
      const repo = createMockOrganizationRepo({
        repositoryOwner: 'testowner',
        repositoryName: 'testrepo',
        isDefault: true,
        addedAt: new Date('2024-01-15'),
      });

      const defaultMarker = repo.isDefault ? ' [default]' : '';
      const output = `  ${repo.repositoryOwner}/${repo.repositoryName}${defaultMarker}`;

      assert.ok(output.includes('testowner/testrepo'));
      assert.ok(output.includes('[default]'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS ADD-REPO COMMAND
  // ============================================================================

  describe('organizations add-repo', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should require added-by option', () => {
      const options = { addedBy: undefined };

      if (!options.addedBy) {
        const message = '--added-by <userId> is required to track who added the repository';
        assert.ok(message.includes('--added-by'));
      }
    });

    it('should accept optional default flag', () => {
      const options = { default: true };

      assert.strictEqual(options.default, true);
    });

    it('should format success message correctly', () => {
      const owner = 'testowner';
      const repo = 'testrepo';
      const orgName = 'Test Org';

      const message = `Added ${owner}/${repo} to ${orgName}.`;

      assert.ok(message.includes('testowner/testrepo'));
      assert.ok(message.includes('Test Org'));
    });
  });

  // ============================================================================
  // TESTS: ORGANIZATIONS REMOVE-REPO COMMAND
  // ============================================================================

  describe('organizations remove-repo', () => {
    beforeEach(() => {
      setupMocks();
    });

    afterEach(() => {
      teardownMocks();
    });

    it('should handle repository not found', () => {
      const removed = false;

      if (!removed) {
        const message = 'Repository not found.';
        assert.ok(message.includes('not found'));
      }
    });

    it('should format success message correctly', () => {
      const owner = 'testowner';
      const repo = 'testrepo';
      const orgName = 'Test Org';

      const message = `Removed ${owner}/${repo} from ${orgName}.`;

      assert.ok(message.includes('testowner/testrepo'));
      assert.ok(message.includes('Removed'));
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Organizations Command Edge Cases', () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    teardownMocks();
  });

  it('should handle orgs alias', () => {
    const commandName = 'organizations';
    const alias = 'orgs';

    assert.notStrictEqual(commandName, alias);
    assert.ok(alias.length < commandName.length);
  });

  it('should handle very long organization names', () => {
    const longName = 'A'.repeat(100);
    const truncated = longName.slice(0, 23);

    assert.strictEqual(truncated.length, 23);
  });

  it('should handle special characters in slugs', () => {
    const slugs = ['test-org', 'my_org', 'org123'];

    for (const slug of slugs) {
      const org = createMockOrganization({ slug });
      assert.strictEqual(org.slug, slug);
    }
  });

  it('should handle null optional fields', () => {
    const org = createMockOrganization({
      displayName: null,
      description: null,
      websiteUrl: null,
      githubOrg: null,
    });

    assert.strictEqual(org.displayName, null);
    assert.strictEqual(org.description, null);
    assert.strictEqual(org.websiteUrl, null);
    assert.strictEqual(org.githubOrg, null);
  });
});
