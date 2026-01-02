/**
 * Organization Query Helpers
 *
 * Composable query utilities for organizations, members, and related operations.
 * Reduces duplication in organization routes and services.
 */

import { eq, and, gt, desc, asc, sql, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  db,
  organizations,
  organizationMembers,
  organizationRepositories,
  organizationInvitations,
  users,
} from '../index.js';
import type {
  Organization,
  OrganizationMember,
  OrganizationRepository,
  OrganizationInvitation,
  OrganizationRole,
} from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  combineConditions,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// Import existing types to avoid duplication
import type { OrganizationMemberWithUser, UserOrganization } from '../../organizations/AOrganizationService.js';

// Re-export for convenience
export type { OrganizationMemberWithUser, UserOrganization };

/**
 * Organization filter options
 */
export interface OrganizationFilterOptions {
  /** Filter by verified status */
  isVerified?: boolean;
  /** Filter by linked GitHub org */
  hasGithubOrg?: boolean;
}

/**
 * Member filter options
 */
export interface MemberFilterOptions {
  /** Filter by role */
  role?: OrganizationRole | OrganizationRole[];
}

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build WHERE conditions for organization queries
 */
export function buildOrganizationConditions(
  options: OrganizationFilterOptions
): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.isVerified !== undefined) {
    conditions.push(eq(organizations.isVerified, options.isVerified));
  }

  if (options.hasGithubOrg !== undefined) {
    if (options.hasGithubOrg) {
      conditions.push(sql`${organizations.githubOrg} IS NOT NULL`);
    } else {
      conditions.push(sql`${organizations.githubOrg} IS NULL`);
    }
  }

  return combineConditions(...conditions);
}

/**
 * Build WHERE conditions for member queries
 */
export function buildMemberConditions(
  organizationId: string,
  options?: MemberFilterOptions
): SQL {
  const conditions: SQL[] = [
    eq(organizationMembers.organizationId, organizationId),
  ];

  if (options?.role) {
    if (Array.isArray(options.role)) {
      conditions.push(inArray(organizationMembers.role, options.role));
    } else {
      conditions.push(eq(organizationMembers.role, options.role));
    }
  }

  return and(...conditions)!;
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find an organization by ID
 */
export async function findOrganizationById(
  id: string
): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);

  return org ?? null;
}

/**
 * Find an organization by slug
 */
export async function findOrganizationBySlug(
  slug: string
): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  return org ?? null;
}

/**
 * Find a member by organization and user ID
 */
export async function findMember(
  organizationId: string,
  userId: string
): Promise<OrganizationMember | null> {
  const [member] = await db
    .select()
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId)
      )
    )
    .limit(1);

  return member ?? null;
}

/**
 * Find an invitation by token
 */
export async function findInvitationByToken(
  token: string
): Promise<OrganizationInvitation | null> {
  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.token, token))
    .limit(1);

  return invitation ?? null;
}

/**
 * Find an invitation by ID
 */
export async function findInvitationById(
  id: string
): Promise<OrganizationInvitation | null> {
  const [invitation] = await db
    .select()
    .from(organizationInvitations)
    .where(eq(organizationInvitations.id, id))
    .limit(1);

  return invitation ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List organizations with optional filtering and pagination
 */
export async function listOrganizations(
  options?: OrganizationFilterOptions & { pagination?: PaginationOptions }
): Promise<PaginatedResult<Organization>> {
  const { pagination, ...filterOptions } = options ?? {};
  const { limit, offset } = getPaginationParams(pagination);

  const conditions = buildOrganizationConditions(filterOptions);

  const data = await db
    .select()
    .from(organizations)
    .where(conditions)
    .orderBy(desc(organizations.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations)
    .where(conditions);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List organizations for a user (all organizations user is a member of)
 */
export async function listUserOrganizations(
  userId: string
): Promise<UserOrganization[]> {
  const memberships = await db
    .select({
      organization: organizations,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
    .where(eq(organizationMembers.userId, userId))
    .orderBy(desc(organizationMembers.joinedAt));

  return memberships.map(m => ({
    organization: m.organization,
    role: m.role as OrganizationRole,
    joinedAt: m.joinedAt,
  }));
}

/**
 * List members of an organization with user info
 */
export async function listOrganizationMembers(
  organizationId: string,
  options?: MemberFilterOptions
): Promise<OrganizationMemberWithUser[]> {
  const conditions = buildMemberConditions(organizationId, options);

  const members = await db
    .select({
      id: organizationMembers.id,
      organizationId: organizationMembers.organizationId,
      userId: organizationMembers.userId,
      role: organizationMembers.role,
      joinedAt: organizationMembers.joinedAt,
      invitedBy: organizationMembers.invitedBy,
      user: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      },
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(conditions)
    .orderBy(asc(organizationMembers.joinedAt));

  return members;
}

/**
 * List repositories for an organization
 */
export async function listOrganizationRepositories(
  organizationId: string
): Promise<OrganizationRepository[]> {
  return db
    .select()
    .from(organizationRepositories)
    .where(eq(organizationRepositories.organizationId, organizationId))
    .orderBy(desc(organizationRepositories.isDefault), asc(organizationRepositories.addedAt));
}

/**
 * List pending (non-expired) invitations for an organization
 */
export async function listPendingInvitations(
  organizationId: string
): Promise<OrganizationInvitation[]> {
  return db
    .select()
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, organizationId),
        gt(organizationInvitations.expiresAt, new Date())
      )
    )
    .orderBy(desc(organizationInvitations.createdAt));
}

// =============================================================================
// COUNT QUERIES
// =============================================================================

/**
 * Count members in an organization
 */
export async function countOrganizationMembers(
  organizationId: string,
  options?: MemberFilterOptions
): Promise<number> {
  const conditions = buildMemberConditions(organizationId, options);

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(conditions);

  return result?.count ?? 0;
}

/**
 * Count repositories in an organization
 */
export async function countOrganizationRepositories(
  organizationId: string
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizationRepositories)
    .where(eq(organizationRepositories.organizationId, organizationId));

  return result?.count ?? 0;
}

// =============================================================================
// EXISTENCE CHECKS
// =============================================================================

/**
 * Check if a slug is available (not already used)
 */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);

  return !existing;
}

/**
 * Check if a user is a member of an organization
 */
export async function isMember(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const member = await findMember(organizationId, userId);
  return !!member;
}

/**
 * Check if a repository is already added to an organization
 */
export async function isRepositoryAdded(
  organizationId: string,
  repositoryOwner: string,
  repositoryName: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: organizationRepositories.id })
    .from(organizationRepositories)
    .where(
      and(
        eq(organizationRepositories.organizationId, organizationId),
        eq(organizationRepositories.repositoryOwner, repositoryOwner),
        eq(organizationRepositories.repositoryName, repositoryName)
      )
    )
    .limit(1);

  return !!existing;
}

// =============================================================================
// PERMISSION HELPERS
// =============================================================================

/** Role hierarchy for permission checks */
const ROLE_HIERARCHY: Record<OrganizationRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/**
 * Check if a user has at least the required role in an organization
 */
export async function hasPermission(
  organizationId: string,
  userId: string,
  requiredRole: OrganizationRole
): Promise<boolean> {
  const member = await findMember(organizationId, userId);
  if (!member) return false;

  const userLevel = ROLE_HIERARCHY[member.role as OrganizationRole];
  const requiredLevel = ROLE_HIERARCHY[requiredRole];

  return userLevel >= requiredLevel;
}

/**
 * Verify organization membership and return membership details
 */
export async function verifyMembership(
  organizationId: string,
  userId: string
): Promise<{ exists: boolean; member: boolean; role: OrganizationRole | null }> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!org) {
    return { exists: false, member: false, role: null };
  }

  const member = await findMember(organizationId, userId);

  return {
    exists: true,
    member: !!member,
    role: member ? (member.role as OrganizationRole) : null,
  };
}

// =============================================================================
// INVITATION HELPERS
// =============================================================================

/**
 * Check if an invitation is valid (exists and not expired)
 */
export async function isInvitationValid(token: string): Promise<{
  valid: boolean;
  invitation: OrganizationInvitation | null;
  reason?: 'not_found' | 'expired';
}> {
  const invitation = await findInvitationByToken(token);

  if (!invitation) {
    return { valid: false, invitation: null, reason: 'not_found' };
  }

  if (new Date() > invitation.expiresAt) {
    return { valid: false, invitation, reason: 'expired' };
  }

  return { valid: true, invitation };
}

/**
 * Check if an invitation already exists for an email in an organization
 */
export async function invitationExistsForEmail(
  organizationId: string,
  email: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: organizationInvitations.id })
    .from(organizationInvitations)
    .where(
      and(
        eq(organizationInvitations.organizationId, organizationId),
        eq(organizationInvitations.email, email.toLowerCase()),
        gt(organizationInvitations.expiresAt, new Date())
      )
    )
    .limit(1);

  return !!existing;
}
