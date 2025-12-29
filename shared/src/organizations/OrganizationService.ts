import { randomUUID } from 'crypto';
import { eq, and, gt } from 'drizzle-orm';
import { AOrganizationService } from './AOrganizationService.js';
import {
  db,
  organizations,
  organizationMembers,
  organizationRepositories,
  organizationInvitations,
  users,
  withTransactionOrThrow,
} from '../db/index.js';
import type { TransactionContext } from '../db/index.js';

import type { Organization } from '../db/schema.js';
import type { OrganizationMember } from '../db/schema.js';
import type { OrganizationRepository } from '../db/schema.js';
import type { OrganizationInvitation } from '../db/schema.js';
import type { OrganizationRole } from '../db/schema.js';
import type { OrganizationMemberWithUser } from './AOrganizationService.js';
import type { UserOrganization } from './AOrganizationService.js';
import type { CreateOrganizationParams } from './AOrganizationService.js';
import type { UpdateOrganizationParams } from './AOrganizationService.js';
import type { InviteMemberParams } from './AOrganizationService.js';
import type { AddRepositoryParams } from './AOrganizationService.js';

const ROLE_HIERARCHY: Record<OrganizationRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export class OrganizationService extends AOrganizationService {
  async create(
    params: CreateOrganizationParams,
    creatorUserId: string
  ): Promise<Organization> {
    const id = randomUUID();
    const now = new Date();

    const [org] = await db.insert(organizations).values({
      id,
      name: params.name,
      slug: params.slug,
      displayName: params.displayName,
      description: params.description,
      avatarUrl: params.avatarUrl,
      websiteUrl: params.websiteUrl,
      githubOrg: params.githubOrg,
      createdAt: now,
      updatedAt: now,
    }).returning();

    await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId: id,
      userId: creatorUserId,
      role: 'owner',
      joinedAt: now,
    });

    return org;
  }

  async getById(id: string): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    return org || null;
  }

  async getBySlug(slug: string): Promise<Organization | null> {
    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    return org || null;
  }

  async update(
    id: string,
    params: UpdateOrganizationParams
  ): Promise<Organization | null> {
    const [org] = await db
      .update(organizations)
      .set({
        ...params,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();

    return org || null;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db
      .delete(organizations)
      .where(eq(organizations.id, id))
      .returning({ id: organizations.id });

    return deleted.length > 0;
  }

  async getMembers(organizationId: string): Promise<OrganizationMemberWithUser[]> {
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
      .where(eq(organizationMembers.organizationId, organizationId));

    return members as OrganizationMemberWithUser[];
  }

  async getMember(
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

    return member || null;
  }

  async addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    invitedBy?: string
  ): Promise<OrganizationMember> {
    const [member] = await db.insert(organizationMembers).values({
      id: randomUUID(),
      organizationId,
      userId,
      role,
      joinedAt: new Date(),
      invitedBy,
    }).returning();

    return member;
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole
  ): Promise<OrganizationMember | null> {
    const [member] = await db
      .update(organizationMembers)
      .set({ role })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId)
        )
      )
      .returning();

    return member || null;
  }

  async removeMember(organizationId: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId)
        )
      )
      .returning({ id: organizationMembers.id });

    return deleted.length > 0;
  }

  async getUserOrganizations(userId: string): Promise<UserOrganization[]> {
    const memberships = await db
      .select({
        organization: organizations,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id))
      .where(eq(organizationMembers.userId, userId));

    return memberships.map(m => ({
      organization: m.organization,
      role: m.role as OrganizationRole,
      joinedAt: m.joinedAt,
    }));
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.getBySlug(slug);
    return !existing;
  }

  async hasPermission(
    organizationId: string,
    userId: string,
    requiredRole: OrganizationRole
  ): Promise<boolean> {
    const member = await this.getMember(organizationId, userId);
    if (!member) return false;

    const userLevel = ROLE_HIERARCHY[member.role as OrganizationRole];
    const requiredLevel = ROLE_HIERARCHY[requiredRole];

    return userLevel >= requiredLevel;
  }

  async getRepositories(organizationId: string): Promise<OrganizationRepository[]> {
    return db
      .select()
      .from(organizationRepositories)
      .where(eq(organizationRepositories.organizationId, organizationId));
  }

  async addRepository(params: AddRepositoryParams): Promise<OrganizationRepository> {
    // Use transaction to ensure default flag update and insert are atomic
    const repo = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      if (params.isDefault) {
        await tx
          .update(organizationRepositories)
          .set({ isDefault: false })
          .where(eq(organizationRepositories.organizationId, params.organizationId));
      }

      const [newRepo] = await tx.insert(organizationRepositories).values({
        id: randomUUID(),
        organizationId: params.organizationId,
        repositoryOwner: params.repositoryOwner,
        repositoryName: params.repositoryName,
        isDefault: params.isDefault ?? false,
        addedBy: params.addedBy,
        addedAt: new Date(),
      }).returning();

      return newRepo;
    }, {
      context: { operation: 'addRepository', organizationId: params.organizationId, isDefault: params.isDefault },
    });

    return repo;
  }

  async removeRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean> {
    const deleted = await db
      .delete(organizationRepositories)
      .where(
        and(
          eq(organizationRepositories.organizationId, organizationId),
          eq(organizationRepositories.repositoryOwner, repositoryOwner),
          eq(organizationRepositories.repositoryName, repositoryName)
        )
      )
      .returning({ id: organizationRepositories.id });

    return deleted.length > 0;
  }

  async setDefaultRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean> {
    // Use transaction to ensure both updates are atomic
    // This prevents a window where no repository is marked as default
    const updated = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx
        .update(organizationRepositories)
        .set({ isDefault: false })
        .where(eq(organizationRepositories.organizationId, organizationId));

      const result = await tx
        .update(organizationRepositories)
        .set({ isDefault: true })
        .where(
          and(
            eq(organizationRepositories.organizationId, organizationId),
            eq(organizationRepositories.repositoryOwner, repositoryOwner),
            eq(organizationRepositories.repositoryName, repositoryName)
          )
        )
        .returning({ id: organizationRepositories.id });

      return result;
    }, {
      context: { operation: 'setDefaultRepository', organizationId, repositoryOwner, repositoryName },
    });

    return updated.length > 0;
  }

  async createInvitation(params: InviteMemberParams): Promise<OrganizationInvitation> {
    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const [invitation] = await db.insert(organizationInvitations).values({
      id: randomUUID(),
      organizationId: params.organizationId,
      email: params.email,
      role: params.role,
      invitedBy: params.invitedBy,
      token,
      expiresAt,
      createdAt: new Date(),
    }).returning();

    return invitation;
  }

  async getInvitationByToken(token: string): Promise<OrganizationInvitation | null> {
    const [invitation] = await db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.token, token))
      .limit(1);

    return invitation || null;
  }

  async getInvitationById(invitationId: string): Promise<OrganizationInvitation | null> {
    const [invitation] = await db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationId))
      .limit(1);

    return invitation || null;
  }

  async acceptInvitation(token: string, userId: string): Promise<OrganizationMember | null> {
    const invitation = await this.getInvitationByToken(token);
    if (!invitation) return null;

    if (new Date() > invitation.expiresAt) {
      await this.revokeInvitation(invitation.id);
      return null;
    }

    const member = await this.addMember(
      invitation.organizationId,
      userId,
      invitation.role as OrganizationRole,
      invitation.invitedBy
    );

    await this.revokeInvitation(invitation.id);

    return member;
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    const deleted = await db
      .delete(organizationInvitations)
      .where(eq(organizationInvitations.id, invitationId))
      .returning({ id: organizationInvitations.id });

    return deleted.length > 0;
  }

  async getPendingInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
    return db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          gt(organizationInvitations.expiresAt, new Date())
        )
      );
  }
}

export const organizationService = new OrganizationService();
