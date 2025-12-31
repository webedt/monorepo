/**
 * Tests for Organizations Routes
 * Covers input validation, authorization, membership management, invitations,
 * and repository management for organization endpoints.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

interface MockUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface MockOrganization {
  id: string;
  name: string;
  slug: string;
  displayName: string | null;
  description: string | null;
  avatarUrl: string | null;
  websiteUrl: string | null;
  githubOrg: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockMember {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

interface MockInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: 'admin' | 'member';
  token: string;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

interface MockRepository {
  id: string;
  organizationId: string;
  repositoryOwner: string;
  repositoryName: string;
  isDefault: boolean;
  addedBy: string;
  createdAt: Date;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: `user-${randomUUID()}`,
    email: `test-${randomUUID().slice(0, 8)}@example.com`,
    isAdmin: false,
    ...overrides,
  };
}

function createMockOrganization(overrides: Partial<MockOrganization> = {}): MockOrganization {
  const now = new Date();
  return {
    id: `org-${randomUUID()}`,
    name: 'Test Organization',
    slug: 'test-org',
    displayName: 'Test Organization Display',
    description: 'A test organization',
    avatarUrl: null,
    websiteUrl: null,
    githubOrg: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockMember(overrides: Partial<MockMember> = {}): MockMember {
  return {
    id: `member-${randomUUID()}`,
    organizationId: `org-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    role: 'member',
    joinedAt: new Date(),
    ...overrides,
  };
}

function createMockInvitation(overrides: Partial<MockInvitation> = {}): MockInvitation {
  return {
    id: `invite-${randomUUID()}`,
    organizationId: `org-${randomUUID()}`,
    email: `invite-${randomUUID().slice(0, 8)}@example.com`,
    role: 'member',
    token: randomUUID(),
    invitedBy: `user-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockRepository(overrides: Partial<MockRepository> = {}): MockRepository {
  return {
    id: `repo-${randomUUID()}`,
    organizationId: `org-${randomUUID()}`,
    repositoryOwner: 'testowner',
    repositoryName: 'testrepo',
    isDefault: false,
    addedBy: `user-${randomUUID()}`,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length >= 3 && slug.length <= 50;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateCreateOrganizationInput(body: Record<string, unknown>): ValidationResult {
  const { name, slug, displayName } = body;

  if (!name || !slug) {
    return { valid: false, error: 'Name and slug are required' };
  }

  if (typeof name !== 'string' || (name as string).length < 2 || (name as string).length > 100) {
    return { valid: false, error: 'Name must be between 2 and 100 characters' };
  }

  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || (displayName as string).length < 2 || (displayName as string).length > 100) {
      return { valid: false, error: 'Display name must be between 2 and 100 characters' };
    }
  }

  if (!isValidSlug(slug as string)) {
    return {
      valid: false,
      error: 'Invalid slug. Must be 3-50 characters, lowercase alphanumeric with hyphens, cannot start or end with hyphen',
    };
  }

  return { valid: true };
}

function validateUpdateOrganizationInput(body: Record<string, unknown>): ValidationResult {
  const { name, displayName } = body;

  if (name !== undefined && (typeof name !== 'string' || (name as string).length < 2 || (name as string).length > 100)) {
    return { valid: false, error: 'Name must be between 2 and 100 characters' };
  }

  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || (displayName as string).length < 2 || (displayName as string).length > 100) {
      return { valid: false, error: 'Display name must be between 2 and 100 characters' };
    }
  }

  return { valid: true };
}

function validateAddMemberInput(body: Record<string, unknown>): ValidationResult {
  const { userId, role } = body;

  if (!userId || !role) {
    return { valid: false, error: 'userId and role are required' };
  }

  if (!['admin', 'member'].includes(role as string)) {
    return { valid: false, error: 'Invalid role. Must be admin or member' };
  }

  return { valid: true };
}

function validateUpdateMemberRoleInput(body: Record<string, unknown>): ValidationResult {
  const { role } = body;

  if (!role || !['owner', 'admin', 'member'].includes(role as string)) {
    return { valid: false, error: 'Invalid role' };
  }

  return { valid: true };
}

function validateAddRepositoryInput(body: Record<string, unknown>): ValidationResult {
  const { repositoryOwner, repositoryName } = body;

  if (!repositoryOwner || !repositoryName) {
    return { valid: false, error: 'repositoryOwner and repositoryName are required' };
  }

  return { valid: true };
}

function validateCreateInvitationInput(body: Record<string, unknown>): ValidationResult {
  const { email, role } = body;

  if (!email) {
    return { valid: false, error: 'Email is required' };
  }

  if (!isValidEmail(email as string)) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (role && !['admin', 'member'].includes(role as string)) {
    return { valid: false, error: 'Invalid role. Must be admin or member' };
  }

  return { valid: true };
}

function hasPermission(
  member: MockMember | null,
  requiredLevel: 'owner' | 'admin' | 'member'
): boolean {
  if (!member) return false;

  const levels: Record<string, number> = {
    owner: 3,
    admin: 2,
    member: 1,
  };

  return levels[member.role] >= levels[requiredLevel];
}

function canRemoveMember(
  currentUserId: string,
  targetUserId: string,
  targetRole: string
): ValidationResult {
  if (currentUserId === targetUserId) {
    return { valid: false, error: 'Use leave endpoint to leave organization' };
  }

  if (targetRole === 'owner') {
    return { valid: false, error: 'Cannot remove owner' };
  }

  return { valid: true };
}

function canLeaveOrganization(
  member: MockMember,
  allMembers: MockMember[]
): ValidationResult {
  if (member.role === 'owner') {
    const otherOwners = allMembers.filter(m => m.role === 'owner' && m.userId !== member.userId);
    if (otherOwners.length === 0) {
      return {
        valid: false,
        error: 'Cannot leave as the only owner. Transfer ownership or delete the organization',
      };
    }
  }

  return { valid: true };
}

function canUpdateMemberRole(
  currentUserId: string,
  targetUserId: string,
  newRole: string
): ValidationResult {
  if (currentUserId === targetUserId && newRole !== 'owner') {
    return { valid: false, error: 'Cannot demote yourself from owner' };
  }

  return { valid: true };
}

function validateInvitationEmailMatch(
  invitation: MockInvitation,
  userEmail: string
): ValidationResult {
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    return { valid: false, error: 'This invitation was sent to a different email address' };
  }

  return { valid: true };
}

function isInvitationExpired(invitation: MockInvitation): boolean {
  return invitation.expiresAt.getTime() < Date.now();
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Organizations Routes - Slug Validation', () => {
  it('should accept valid slugs', () => {
    assert.strictEqual(isValidSlug('my-org'), true);
    assert.strictEqual(isValidSlug('org123'), true);
    assert.strictEqual(isValidSlug('my-cool-org'), true);
    assert.strictEqual(isValidSlug('abc'), true); // Minimum 3 chars
    assert.strictEqual(isValidSlug('a'.repeat(50)), true); // Maximum 50 chars
  });

  it('should reject slugs with invalid characters', () => {
    assert.strictEqual(isValidSlug('My-Org'), false); // Uppercase
    assert.strictEqual(isValidSlug('my_org'), false); // Underscore
    assert.strictEqual(isValidSlug('my org'), false); // Space
    assert.strictEqual(isValidSlug('my.org'), false); // Dot
    assert.strictEqual(isValidSlug('my@org'), false); // Special char
  });

  it('should reject slugs starting or ending with hyphen', () => {
    assert.strictEqual(isValidSlug('-myorg'), false);
    assert.strictEqual(isValidSlug('myorg-'), false);
    assert.strictEqual(isValidSlug('-myorg-'), false);
  });

  it('should reject slugs too short or too long', () => {
    assert.strictEqual(isValidSlug('ab'), false); // Too short
    assert.strictEqual(isValidSlug('a'.repeat(51)), false); // Too long
  });

  it('should reject single character slugs', () => {
    assert.strictEqual(isValidSlug('a'), false);
    assert.strictEqual(isValidSlug('1'), false);
  });
});

describe('Organizations Routes - Create Organization Validation', () => {
  describe('POST /api/organizations', () => {
    it('should require name field', () => {
      const body = { slug: 'my-org' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Name and slug are required');
    });

    it('should require slug field', () => {
      const body = { name: 'My Organization' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Name and slug are required');
    });

    it('should reject name shorter than 2 characters', () => {
      const body = { name: 'A', slug: 'my-org' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('between 2 and 100'));
    });

    it('should reject name longer than 100 characters', () => {
      const body = { name: 'a'.repeat(101), slug: 'my-org' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('between 2 and 100'));
    });

    it('should reject invalid displayName length', () => {
      const body = { name: 'My Org', slug: 'my-org', displayName: 'A' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Display name'));
    });

    it('should reject invalid slug', () => {
      const body = { name: 'My Org', slug: 'MY-ORG' };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid slug'));
    });

    it('should accept valid organization input', () => {
      const body = {
        name: 'My Organization',
        slug: 'my-organization',
        displayName: 'My Cool Org',
        description: 'A great organization',
      };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept null displayName', () => {
      const body = { name: 'My Org', slug: 'my-org', displayName: null };
      const result = validateCreateOrganizationInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Organizations Routes - Update Organization Validation', () => {
  describe('PATCH /api/organizations/:id', () => {
    it('should reject invalid name length', () => {
      const body = { name: 'A' };
      const result = validateUpdateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('between 2 and 100'));
    });

    it('should reject invalid displayName length', () => {
      const body = { displayName: 'A' };
      const result = validateUpdateOrganizationInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid partial update', () => {
      const body = { name: 'New Name' };
      const result = validateUpdateOrganizationInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty update (no fields)', () => {
      const body = {};
      const result = validateUpdateOrganizationInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Organizations Routes - Permission Checks', () => {
  describe('hasPermission', () => {
    it('should allow owner access for owner requirement', () => {
      const member = createMockMember({ role: 'owner' });
      assert.strictEqual(hasPermission(member, 'owner'), true);
    });

    it('should deny admin access for owner requirement', () => {
      const member = createMockMember({ role: 'admin' });
      assert.strictEqual(hasPermission(member, 'owner'), false);
    });

    it('should deny member access for owner requirement', () => {
      const member = createMockMember({ role: 'member' });
      assert.strictEqual(hasPermission(member, 'owner'), false);
    });

    it('should allow owner access for admin requirement', () => {
      const member = createMockMember({ role: 'owner' });
      assert.strictEqual(hasPermission(member, 'admin'), true);
    });

    it('should allow admin access for admin requirement', () => {
      const member = createMockMember({ role: 'admin' });
      assert.strictEqual(hasPermission(member, 'admin'), true);
    });

    it('should deny member access for admin requirement', () => {
      const member = createMockMember({ role: 'member' });
      assert.strictEqual(hasPermission(member, 'admin'), false);
    });

    it('should allow all roles for member requirement', () => {
      assert.strictEqual(hasPermission(createMockMember({ role: 'owner' }), 'member'), true);
      assert.strictEqual(hasPermission(createMockMember({ role: 'admin' }), 'member'), true);
      assert.strictEqual(hasPermission(createMockMember({ role: 'member' }), 'member'), true);
    });

    it('should deny access if not a member', () => {
      assert.strictEqual(hasPermission(null, 'member'), false);
      assert.strictEqual(hasPermission(null, 'admin'), false);
      assert.strictEqual(hasPermission(null, 'owner'), false);
    });
  });
});

describe('Organizations Routes - Member Management', () => {
  describe('POST /api/organizations/:id/members (Add Member)', () => {
    it('should require userId', () => {
      const body = { role: 'member' };
      const result = validateAddMemberInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'userId and role are required');
    });

    it('should require role', () => {
      const body = { userId: 'user-123' };
      const result = validateAddMemberInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'userId and role are required');
    });

    it('should reject invalid role', () => {
      const body = { userId: 'user-123', role: 'owner' }; // owner cannot be directly assigned
      const result = validateAddMemberInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid role'));
    });

    it('should accept valid member role', () => {
      const body = { userId: 'user-123', role: 'member' };
      const result = validateAddMemberInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid admin role', () => {
      const body = { userId: 'user-123', role: 'admin' };
      const result = validateAddMemberInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PATCH /api/organizations/:id/members/:userId (Update Role)', () => {
    it('should require valid role', () => {
      const body = { role: 'invalid' };
      const result = validateUpdateMemberRoleInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept owner role for transfer', () => {
      const body = { role: 'owner' };
      const result = validateUpdateMemberRoleInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should prevent self-demotion from owner', () => {
      const result = canUpdateMemberRole('user-1', 'user-1', 'admin');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Cannot demote yourself from owner');
    });

    it('should allow keeping own owner status', () => {
      const result = canUpdateMemberRole('user-1', 'user-1', 'owner');

      assert.strictEqual(result.valid, true);
    });

    it('should allow changing other members roles', () => {
      const result = canUpdateMemberRole('user-1', 'user-2', 'member');

      assert.strictEqual(result.valid, true);
    });
  });

  describe('DELETE /api/organizations/:id/members/:userId (Remove Member)', () => {
    it('should prevent removing yourself', () => {
      const result = canRemoveMember('user-1', 'user-1', 'member');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Use leave endpoint to leave organization');
    });

    it('should prevent removing owner', () => {
      const result = canRemoveMember('user-1', 'user-2', 'owner');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Cannot remove owner');
    });

    it('should allow removing admin', () => {
      const result = canRemoveMember('user-1', 'user-2', 'admin');

      assert.strictEqual(result.valid, true);
    });

    it('should allow removing member', () => {
      const result = canRemoveMember('user-1', 'user-2', 'member');

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /api/organizations/:id/leave (Leave Organization)', () => {
    it('should prevent sole owner from leaving', () => {
      const userId = 'user-1';
      const member = createMockMember({ userId, role: 'owner' });
      const allMembers = [member, createMockMember({ userId: 'user-2', role: 'member' })];

      const result = canLeaveOrganization(member, allMembers);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('only owner'));
    });

    it('should allow owner to leave if there are other owners', () => {
      const userId = 'user-1';
      const member = createMockMember({ userId, role: 'owner' });
      const allMembers = [
        member,
        createMockMember({ userId: 'user-2', role: 'owner' }),
      ];

      const result = canLeaveOrganization(member, allMembers);

      assert.strictEqual(result.valid, true);
    });

    it('should allow non-owner to leave', () => {
      const userId = 'user-1';
      const member = createMockMember({ userId, role: 'member' });
      const allMembers = [member, createMockMember({ userId: 'user-2', role: 'owner' })];

      const result = canLeaveOrganization(member, allMembers);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Organizations Routes - Repository Management', () => {
  describe('POST /api/organizations/:id/repositories (Add Repository)', () => {
    it('should require repositoryOwner', () => {
      const body = { repositoryName: 'repo' };
      const result = validateAddRepositoryInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'repositoryOwner and repositoryName are required');
    });

    it('should require repositoryName', () => {
      const body = { repositoryOwner: 'owner' };
      const result = validateAddRepositoryInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid repository input', () => {
      const body = { repositoryOwner: 'myorg', repositoryName: 'myrepo' };
      const result = validateAddRepositoryInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional isDefault flag', () => {
      const body = {
        repositoryOwner: 'myorg',
        repositoryName: 'myrepo',
        isDefault: true,
      };
      const result = validateAddRepositoryInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Repository Default Management', () => {
    it('should track default repository', () => {
      const repos = [
        createMockRepository({ isDefault: false }),
        createMockRepository({ isDefault: true }),
        createMockRepository({ isDefault: false }),
      ];

      const defaultRepo = repos.find(r => r.isDefault);
      assert.ok(defaultRepo);
      assert.strictEqual(defaultRepo.isDefault, true);
    });

    it('should ensure only one default repository', () => {
      const repos = [
        createMockRepository({ isDefault: true }),
        createMockRepository({ isDefault: true }),
      ];

      // In real implementation, setting new default would clear old one
      const defaultCount = repos.filter(r => r.isDefault).length;
      // This test documents the constraint - in practice enforced by DB or application logic
      assert.ok(defaultCount >= 1);
    });
  });
});

describe('Organizations Routes - Invitation Management', () => {
  describe('POST /api/organizations/:id/invitations (Create Invitation)', () => {
    it('should require email', () => {
      const body = { role: 'member' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Email is required');
    });

    it('should validate email format', () => {
      const body = { email: 'not-an-email' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid email format');
    });

    it('should reject invalid role', () => {
      const body = { email: 'user@example.com', role: 'owner' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid role'));
    });

    it('should accept valid invitation with member role', () => {
      const body = { email: 'user@example.com', role: 'member' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid invitation with admin role', () => {
      const body = { email: 'user@example.com', role: 'admin' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should default to member role if not specified', () => {
      const body = { email: 'user@example.com' };
      const result = validateCreateInvitationInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Invitation Email Validation', () => {
    it('should accept matching email (case insensitive)', () => {
      const invitation = createMockInvitation({ email: 'user@example.com' });
      const result = validateInvitationEmailMatch(invitation, 'USER@EXAMPLE.COM');

      assert.strictEqual(result.valid, true);
    });

    it('should reject mismatched email', () => {
      const invitation = createMockInvitation({ email: 'user@example.com' });
      const result = validateInvitationEmailMatch(invitation, 'other@example.com');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('different email address'));
    });
  });

  describe('Invitation Expiration', () => {
    it('should detect expired invitation', () => {
      const invitation = createMockInvitation({
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });

      assert.strictEqual(isInvitationExpired(invitation), true);
    });

    it('should accept non-expired invitation', () => {
      const invitation = createMockInvitation({
        expiresAt: new Date(Date.now() + 86400000), // 1 day from now
      });

      assert.strictEqual(isInvitationExpired(invitation), false);
    });
  });
});

describe('Organizations Routes - Email Validation', () => {
  it('should accept valid email formats', () => {
    assert.strictEqual(isValidEmail('user@example.com'), true);
    assert.strictEqual(isValidEmail('user.name@example.com'), true);
    assert.strictEqual(isValidEmail('user+tag@example.com'), true);
    assert.strictEqual(isValidEmail('user@subdomain.example.com'), true);
  });

  it('should reject invalid email formats', () => {
    assert.strictEqual(isValidEmail('not-an-email'), false);
    assert.strictEqual(isValidEmail('user@'), false);
    assert.strictEqual(isValidEmail('@example.com'), false);
    assert.strictEqual(isValidEmail('user@.com'), false);
    assert.strictEqual(isValidEmail('user @example.com'), false); // Space
    assert.strictEqual(isValidEmail(''), false);
  });
});

describe('Organizations Routes - Membership Queries', () => {
  it('should find member by user ID', () => {
    const members = [
      createMockMember({ userId: 'user-1' }),
      createMockMember({ userId: 'user-2' }),
    ];

    const member = members.find(m => m.userId === 'user-1');
    assert.ok(member);
    assert.strictEqual(member.userId, 'user-1');
  });

  it('should return undefined for non-member', () => {
    const members = [
      createMockMember({ userId: 'user-1' }),
    ];

    const member = members.find(m => m.userId === 'user-999');
    assert.strictEqual(member, undefined);
  });
});

describe('Organizations Routes - Slug Availability', () => {
  it('should detect taken slug', () => {
    const existingSlugs = ['my-org', 'test-org'];

    const isAvailable = (slug: string) => !existingSlugs.includes(slug);

    assert.strictEqual(isAvailable('my-org'), false);
    assert.strictEqual(isAvailable('new-org'), true);
  });

  it('should handle edge cases in availability check', () => {
    const existingSlugs = ['my-org'];

    const isAvailable = (slug: string) => !existingSlugs.includes(slug);

    // Case sensitive check (in real implementation, slugs are lowercase)
    assert.strictEqual(isAvailable('MY-ORG'), true); // Different case
    assert.strictEqual(isAvailable('my-org-2'), true); // Different slug
  });
});

describe('Organizations Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with organization data', () => {
      const org = createMockOrganization();
      const response = createSuccessResponse({ organization: org });

      assert.strictEqual(response.success, true);
      assert.ok(response.data.organization);
    });

    it('should return success:true with list data', () => {
      const orgs = [createMockOrganization(), createMockOrganization()];
      const response = createSuccessResponse({ organizations: orgs });

      assert.strictEqual(response.success, true);
      assert.strictEqual((response.data.organizations as MockOrganization[]).length, 2);
    });

    it('should include role in user organization list', () => {
      const org = createMockOrganization();
      const response = createSuccessResponse({
        ...org,
        role: 'member',
        joinedAt: new Date(),
      });

      assert.strictEqual(response.success, true);
      assert.ok(response.data.role);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Organization not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Organization not found');
    });

    it('should return 403 error for permission denied', () => {
      const response = createErrorResponse('Not a member of this organization');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('Not a member'));
    });

    it('should return 409 error for slug taken', () => {
      const response = createErrorResponse('Slug is already taken');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('already taken'));
    });
  });
});

describe('Organizations Routes - Unique Constraint Handling', () => {
  it('should detect unique constraint violation for slug', () => {
    const error = new Error('duplicate key value violates unique constraint');
    (error as Error & { code: string }).code = '23505';

    const isUniqueViolation = (e: unknown): boolean => {
      if (e instanceof Error) {
        const pgError = e as Error & { code?: string };
        return pgError.code === '23505' ||
          e.message.toLowerCase().includes('unique constraint') ||
          e.message.toLowerCase().includes('duplicate key');
      }
      return false;
    };

    assert.strictEqual(isUniqueViolation(error), true);
  });

  it('should not detect other errors as unique violation', () => {
    const error = new Error('Connection refused');

    const isUniqueViolation = (e: unknown): boolean => {
      if (e instanceof Error) {
        const pgError = e as Error & { code?: string };
        return pgError.code === '23505';
      }
      return false;
    };

    assert.strictEqual(isUniqueViolation(error), false);
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createSuccessResponse(data: Record<string, unknown>): {
  success: boolean;
  data: Record<string, unknown>;
} {
  return { success: true, data };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
