import { AService } from '../services/abstracts/AService.js';

import type { Organization } from '../db/schema.js';
import type { NewOrganization } from '../db/schema.js';
import type { OrganizationMember } from '../db/schema.js';
import type { OrganizationRepository } from '../db/schema.js';
import type { OrganizationInvitation } from '../db/schema.js';
import type { OrganizationRole } from '../db/schema.js';

export interface OrganizationWithMembers extends Organization {
  members: OrganizationMemberWithUser[];
}

export interface OrganizationMemberWithUser extends OrganizationMember {
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

export interface UserOrganization {
  organization: Organization;
  role: OrganizationRole;
  joinedAt: Date;
}

export interface CreateOrganizationParams {
  name: string;
  slug: string;
  displayName?: string;
  description?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  githubOrg?: string;
}

export interface UpdateOrganizationParams {
  name?: string;
  displayName?: string;
  description?: string;
  avatarUrl?: string;
  websiteUrl?: string;
  githubOrg?: string;
}

export interface InviteMemberParams {
  organizationId: string;
  email: string;
  role: OrganizationRole;
  invitedBy: string;
}

export interface AddRepositoryParams {
  organizationId: string;
  repositoryOwner: string;
  repositoryName: string;
  isDefault?: boolean;
  addedBy: string;
}

export abstract class AOrganizationService extends AService {
  readonly order = 0;

  abstract create(
    params: CreateOrganizationParams,
    creatorUserId: string
  ): Promise<Organization>;

  abstract getById(
    id: string
  ): Promise<Organization | null>;

  abstract getBySlug(
    slug: string
  ): Promise<Organization | null>;

  abstract update(
    id: string,
    params: UpdateOrganizationParams
  ): Promise<Organization | null>;

  abstract delete(
    id: string
  ): Promise<boolean>;

  abstract getMembers(
    organizationId: string
  ): Promise<OrganizationMemberWithUser[]>;

  abstract getMember(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMember | null>;

  abstract addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    invitedBy?: string
  ): Promise<OrganizationMember>;

  abstract updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole
  ): Promise<OrganizationMember | null>;

  abstract removeMember(
    organizationId: string,
    userId: string
  ): Promise<boolean>;

  abstract getUserOrganizations(
    userId: string
  ): Promise<UserOrganization[]>;

  abstract isSlugAvailable(
    slug: string
  ): Promise<boolean>;

  abstract hasPermission(
    organizationId: string,
    userId: string,
    requiredRole: OrganizationRole
  ): Promise<boolean>;

  abstract getRepositories(
    organizationId: string
  ): Promise<OrganizationRepository[]>;

  abstract addRepository(
    params: AddRepositoryParams
  ): Promise<OrganizationRepository>;

  abstract removeRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean>;

  abstract setDefaultRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean>;

  abstract createInvitation(
    params: InviteMemberParams
  ): Promise<OrganizationInvitation>;

  abstract getInvitationByToken(
    token: string
  ): Promise<OrganizationInvitation | null>;

  abstract acceptInvitation(
    token: string,
    userId: string
  ): Promise<OrganizationMember | null>;

  abstract revokeInvitation(
    invitationId: string
  ): Promise<boolean>;

  abstract getPendingInvitations(
    organizationId: string
  ): Promise<OrganizationInvitation[]>;
}
