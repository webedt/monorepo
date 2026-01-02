/**
 * Organization Entity Loader
 *
 * Provides batch loading capabilities for organizations and memberships,
 * preventing N+1 query problems when fetching organization information.
 */

import { inArray, eq, and } from 'drizzle-orm';
import { db, organizations, organizationMembers, organizationRepositories, users } from '../index.js';
import { DataLoader, createResultMap } from '../dataLoader.js';

import type { Organization, OrganizationMember, OrganizationRepository, OrganizationRole } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * Organization summary with role info
 */
export interface OrganizationWithRole {
  organization: Organization;
  role: OrganizationRole;
  joinedAt: Date;
}

/**
 * Organization member with user info
 */
export interface MemberWithUser {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  joinedAt: Date;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

/**
 * Create a DataLoader for batch loading organizations by ID
 *
 * @example
 * const orgLoader = createOrganizationLoader();
 * const [org1, org2] = await Promise.all([
 *   orgLoader.load('org-id-1'),
 *   orgLoader.load('org-id-2'),
 * ]);
 */
export function createOrganizationLoader(options?: DataLoaderOptions): DataLoader<string, Organization> {
  return new DataLoader<string, Organization>(
    async (orgIds: string[]) => {
      const results = await db
        .select()
        .from(organizations)
        .where(inArray(organizations.id, orgIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading organizations by slug
 */
export function createOrganizationBySlugLoader(options?: DataLoaderOptions): DataLoader<string, Organization> {
  return new DataLoader<string, Organization>(
    async (slugs: string[]) => {
      const results = await db
        .select()
        .from(organizations)
        .where(inArray(organizations.slug, slugs));

      const map = new Map<string, Organization>();
      for (const org of results) {
        map.set(org.slug, org);
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading user's organizations
 * Returns all organizations a user belongs to with their role
 *
 * @example
 * const userOrgsLoader = createUserOrganizationsLoader();
 * const userOrgs = await userOrgsLoader.load('user-123');
 * // userOrgs is an array of { organization, role, joinedAt }
 */
export function createUserOrganizationsLoader(options?: DataLoaderOptions): DataLoader<string, OrganizationWithRole[]> {
  return new DataLoader<string, OrganizationWithRole[]>(
    async (userIds: string[]) => {
      const members = await db
        .select({
          userId: organizationMembers.userId,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt,
          organization: organizations,
        })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
        .where(inArray(organizationMembers.userId, userIds));

      // Group by userId
      const map = new Map<string, OrganizationWithRole[]>();
      for (const userId of userIds) {
        map.set(userId, []);
      }
      for (const member of members) {
        const list = map.get(member.userId);
        if (list) {
          list.push({
            organization: member.organization,
            role: member.role as OrganizationRole,
            joinedAt: member.joinedAt,
          });
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading organization members
 * Returns all members of an organization with their user info
 */
export function createOrganizationMembersLoader(options?: DataLoaderOptions): DataLoader<string, MemberWithUser[]> {
  return new DataLoader<string, MemberWithUser[]>(
    async (orgIds: string[]) => {
      const members = await db
        .select({
          id: organizationMembers.id,
          organizationId: organizationMembers.organizationId,
          userId: organizationMembers.userId,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt,
          userEmail: users.email,
          userDisplayName: users.displayName,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(inArray(organizationMembers.organizationId, orgIds));

      // Group by organizationId
      const map = new Map<string, MemberWithUser[]>();
      for (const orgId of orgIds) {
        map.set(orgId, []);
      }
      for (const member of members) {
        const list = map.get(member.organizationId);
        if (list) {
          list.push({
            id: member.id,
            organizationId: member.organizationId,
            userId: member.userId,
            role: member.role as OrganizationRole,
            joinedAt: member.joinedAt,
            user: {
              id: member.userId,
              email: member.userEmail,
              displayName: member.userDisplayName,
            },
          });
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for checking user membership in organizations
 * Returns the member record if user is a member, null otherwise
 */
export function createOrganizationMembershipLoader(
  userId: string,
  options?: DataLoaderOptions
): DataLoader<string, OrganizationMember | null> {
  return new DataLoader<string, OrganizationMember | null>(
    async (orgIds: string[]) => {
      const members = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, userId),
            inArray(organizationMembers.organizationId, orgIds)
          )
        );

      const memberMap = new Map(members.map(m => [m.organizationId, m]));

      const map = new Map<string, OrganizationMember | null>();
      for (const orgId of orgIds) {
        map.set(orgId, memberMap.get(orgId) ?? null);
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading organization repositories
 */
export function createOrganizationRepositoriesLoader(options?: DataLoaderOptions): DataLoader<string, OrganizationRepository[]> {
  return new DataLoader<string, OrganizationRepository[]>(
    async (orgIds: string[]) => {
      const repos = await db
        .select()
        .from(organizationRepositories)
        .where(inArray(organizationRepositories.organizationId, orgIds));

      // Group by organizationId
      const map = new Map<string, OrganizationRepository[]>();
      for (const orgId of orgIds) {
        map.set(orgId, []);
      }
      for (const repo of repos) {
        const list = map.get(repo.organizationId);
        if (list) {
          list.push(repo);
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading member count per organization
 */
export function createOrganizationMemberCountLoader(options?: DataLoaderOptions): DataLoader<string, number> {
  return new DataLoader<string, number>(
    async (orgIds: string[]) => {
      const counts = await db
        .select({
          organizationId: organizationMembers.organizationId,
          count: db.$count(organizationMembers.id),
        })
        .from(organizationMembers)
        .where(inArray(organizationMembers.organizationId, orgIds))
        .groupBy(organizationMembers.organizationId);

      const countMap = new Map(counts.map(c => [c.organizationId, c.count]));

      const map = new Map<string, number>();
      for (const orgId of orgIds) {
        map.set(orgId, countMap.get(orgId) ?? 0);
      }
      return map;
    },
    options
  );
}
