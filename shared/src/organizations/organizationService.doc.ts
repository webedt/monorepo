/**
 * Organization Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Organization Service.
 * The service manages organizations, memberships, invitations, and repository access.
 *
 * @see AOrganizationService for the abstract base class
 * @see OrganizationService for the implementation
 */

import type { Organization } from '../db/schema.js';
import type { OrganizationInvitation } from '../db/schema.js';
import type { OrganizationMember } from '../db/schema.js';
import type { OrganizationRepository } from '../db/schema.js';
import type { OrganizationRole } from '../db/schema.js';

/**
 * Organization with loaded member details
 */
export interface OrganizationWithMembers extends Organization {
  /** Members with user information */
  members: OrganizationMemberWithUser[];
}

/**
 * Member record with user details
 */
export interface OrganizationMemberWithUser extends OrganizationMember {
  /** User information */
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

/**
 * User's organization membership
 */
export interface UserOrganization {
  /** The organization */
  organization: Organization;
  /** User's role in the organization */
  role: OrganizationRole;
  /** When the user joined */
  joinedAt: Date;
}

/**
 * Parameters for creating an organization
 */
export interface CreateOrganizationParams {
  /** Internal name (lowercase, alphanumeric) */
  name: string;
  /** URL-friendly identifier */
  slug: string;
  /** Display name for UI */
  displayName?: string;
  /** Organization description */
  description?: string;
  /** Avatar image URL */
  avatarUrl?: string;
  /** Organization website */
  websiteUrl?: string;
  /** Linked GitHub organization */
  githubOrg?: string;
}

/**
 * Parameters for updating an organization
 */
export interface UpdateOrganizationParams {
  /** Internal name */
  name?: string;
  /** Display name */
  displayName?: string;
  /** Description */
  description?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** Website URL */
  websiteUrl?: string;
  /** GitHub organization */
  githubOrg?: string;
}

/**
 * Parameters for inviting a member
 */
export interface InviteMemberParams {
  /** Organization to invite to */
  organizationId: string;
  /** Email of the person to invite */
  email: string;
  /** Role to assign on acceptance */
  role: OrganizationRole;
  /** User ID of the inviter */
  invitedBy: string;
}

/**
 * Parameters for adding a repository
 */
export interface AddRepositoryParams {
  /** Organization ID */
  organizationId: string;
  /** GitHub repository owner */
  repositoryOwner: string;
  /** GitHub repository name */
  repositoryName: string;
  /** Set as default for new sessions */
  isDefault?: boolean;
  /** User ID who added it */
  addedBy: string;
}

/**
 * Interface for Organization Service with full documentation.
 *
 * The Organization Service manages multi-user organizations including
 * membership, roles, invitations, and shared repository access.
 *
 * ## Features
 *
 * - **Organization CRUD**: Create, update, delete organizations
 * - **Member Management**: Add, update roles, remove members
 * - **Invitation Flow**: Email invitations with acceptance tokens
 * - **Repository Sharing**: Share GitHub repositories across organization
 * - **Role-Based Access**: Owner, admin, member permission levels
 *
 * ## Organization Roles
 *
 * | Role | Permissions |
 * |------|------------|
 * | owner | Full control, can delete org, manage all members |
 * | admin | Manage members and repositories, cannot delete org |
 * | member | View organization, use shared repositories |
 *
 * ## Invitation Flow
 *
 * 1. Admin creates invitation with `createInvitation()`
 * 2. System sends email with invitation link
 * 3. Invitee clicks link and calls `acceptInvitation()`
 * 4. User is added as member with specified role
 *
 * ## Usage
 *
 * ```typescript
 * const orgService = getOrganizationService();
 *
 * // Create organization
 * const org = await orgService.create({
 *   name: 'acme-corp',
 *   slug: 'acme-corp',
 *   displayName: 'ACME Corporation',
 * }, creatorUserId);
 *
 * // Invite member
 * await orgService.createInvitation({
 *   organizationId: org.id,
 *   email: 'new.member@acme.com',
 *   role: 'member',
 *   invitedBy: adminUserId,
 * });
 * ```
 */
export interface IOrganizationServiceDocumentation {
  /**
   * Create a new organization.
   *
   * The creator becomes the owner of the organization.
   *
   * @param params - Organization creation parameters
   * @param creatorUserId - User ID of the creator (becomes owner)
   * @returns Created organization
   *
   * @example
   * ```typescript
   * const org = await orgService.create({
   *   name: 'startup-inc',
   *   slug: 'startup-inc',
   *   displayName: 'Startup Inc.',
   *   description: 'Building the future',
   *   githubOrg: 'startup-inc',
   * }, userId);
   *
   * console.log(`Organization created: ${org.id}`);
   * ```
   */
  create(
    params: CreateOrganizationParams,
    creatorUserId: string
  ): Promise<Organization>;

  /**
   * Get an organization by ID.
   *
   * @param id - The organization ID
   * @returns Organization if found, null otherwise
   *
   * @example
   * ```typescript
   * const org = await orgService.getById('org-123');
   * if (org) {
   *   console.log(org.displayName);
   * }
   * ```
   */
  getById(id: string): Promise<Organization | null>;

  /**
   * Get an organization by slug.
   *
   * Use for URL-based lookups.
   *
   * @param slug - The organization slug
   * @returns Organization if found, null otherwise
   *
   * @example
   * ```typescript
   * // Route: /org/:slug
   * const org = await orgService.getBySlug(req.params.slug);
   * if (!org) {
   *   return res.status(404).json({ error: 'Organization not found' });
   * }
   * ```
   */
  getBySlug(slug: string): Promise<Organization | null>;

  /**
   * Update an organization.
   *
   * @param id - The organization ID
   * @param params - Update parameters
   * @returns Updated organization, null if not found
   *
   * @example
   * ```typescript
   * const updated = await orgService.update(orgId, {
   *   displayName: 'New Name',
   *   description: 'Updated description',
   * });
   * ```
   */
  update(
    id: string,
    params: UpdateOrganizationParams
  ): Promise<Organization | null>;

  /**
   * Delete an organization.
   *
   * Removes all members, invitations, and repositories.
   *
   * @param id - The organization ID
   * @returns True if deleted, false if not found
   *
   * @example
   * ```typescript
   * // Only owners can delete
   * if (await orgService.hasPermission(orgId, userId, 'owner')) {
   *   await orgService.delete(orgId);
   * }
   * ```
   */
  delete(id: string): Promise<boolean>;

  /**
   * Get all members of an organization.
   *
   * @param organizationId - The organization ID
   * @returns Members with user details
   *
   * @example
   * ```typescript
   * const members = await orgService.getMembers(orgId);
   *
   * for (const member of members) {
   *   console.log(`${member.user.email}: ${member.role}`);
   * }
   * ```
   */
  getMembers(organizationId: string): Promise<OrganizationMemberWithUser[]>;

  /**
   * Get a specific member.
   *
   * @param organizationId - The organization ID
   * @param userId - The user ID
   * @returns Member record if exists, null otherwise
   *
   * @example
   * ```typescript
   * const member = await orgService.getMember(orgId, userId);
   * if (member) {
   *   console.log(`User role: ${member.role}`);
   * }
   * ```
   */
  getMember(
    organizationId: string,
    userId: string
  ): Promise<OrganizationMember | null>;

  /**
   * Add a member to an organization.
   *
   * @param organizationId - The organization ID
   * @param userId - The user to add
   * @param role - Role to assign
   * @param invitedBy - Optional: who invited them
   * @returns Created member record
   *
   * @example
   * ```typescript
   * const member = await orgService.addMember(
   *   orgId,
   *   newUserId,
   *   'member',
   *   adminUserId
   * );
   * ```
   */
  addMember(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    invitedBy?: string
  ): Promise<OrganizationMember>;

  /**
   * Update a member's role.
   *
   * @param organizationId - The organization ID
   * @param userId - The user to update
   * @param role - New role to assign
   * @returns Updated member, null if not found
   *
   * @example
   * ```typescript
   * // Promote to admin
   * await orgService.updateMemberRole(orgId, userId, 'admin');
   * ```
   */
  updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole
  ): Promise<OrganizationMember | null>;

  /**
   * Remove a member from an organization.
   *
   * @param organizationId - The organization ID
   * @param userId - The user to remove
   * @returns True if removed, false if not found
   *
   * @example
   * ```typescript
   * await orgService.removeMember(orgId, userId);
   * ```
   */
  removeMember(
    organizationId: string,
    userId: string
  ): Promise<boolean>;

  /**
   * Get all organizations a user belongs to.
   *
   * @param userId - The user ID
   * @returns User's organizations with roles
   *
   * @example
   * ```typescript
   * const userOrgs = await orgService.getUserOrganizations(userId);
   *
   * for (const { organization, role } of userOrgs) {
   *   console.log(`${organization.displayName}: ${role}`);
   * }
   * ```
   */
  getUserOrganizations(userId: string): Promise<UserOrganization[]>;

  /**
   * Check if an organization slug is available.
   *
   * @param slug - The slug to check
   * @returns True if available
   *
   * @example
   * ```typescript
   * const isAvailable = await orgService.isSlugAvailable('my-org');
   * if (!isAvailable) {
   *   return res.status(400).json({ error: 'Slug already taken' });
   * }
   * ```
   */
  isSlugAvailable(slug: string): Promise<boolean>;

  /**
   * Check if user has required permission level.
   *
   * @param organizationId - The organization ID
   * @param userId - The user ID
   * @param requiredRole - Minimum required role
   * @returns True if user has permission
   *
   * @example
   * ```typescript
   * // Check admin permission
   * if (await orgService.hasPermission(orgId, userId, 'admin')) {
   *   // Allow admin actions
   * }
   *
   * // Permission hierarchy: owner > admin > member
   * // Owner can do anything admin can do
   * ```
   */
  hasPermission(
    organizationId: string,
    userId: string,
    requiredRole: OrganizationRole
  ): Promise<boolean>;

  /**
   * Get organization's linked repositories.
   *
   * @param organizationId - The organization ID
   * @returns Linked repositories
   *
   * @example
   * ```typescript
   * const repos = await orgService.getRepositories(orgId);
   *
   * const defaultRepo = repos.find(r => r.isDefault);
   * console.log(`Default repo: ${defaultRepo?.repositoryName}`);
   * ```
   */
  getRepositories(organizationId: string): Promise<OrganizationRepository[]>;

  /**
   * Add a repository to an organization.
   *
   * @param params - Repository parameters
   * @returns Created repository link
   *
   * @example
   * ```typescript
   * await orgService.addRepository({
   *   organizationId: orgId,
   *   repositoryOwner: 'my-org',
   *   repositoryName: 'my-repo',
   *   isDefault: true,
   *   addedBy: adminId,
   * });
   * ```
   */
  addRepository(params: AddRepositoryParams): Promise<OrganizationRepository>;

  /**
   * Remove a repository from an organization.
   *
   * @param organizationId - The organization ID
   * @param repositoryOwner - GitHub repo owner
   * @param repositoryName - GitHub repo name
   * @returns True if removed
   *
   * @example
   * ```typescript
   * await orgService.removeRepository(orgId, 'my-org', 'old-repo');
   * ```
   */
  removeRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean>;

  /**
   * Set a repository as the default.
   *
   * @param organizationId - The organization ID
   * @param repositoryOwner - GitHub repo owner
   * @param repositoryName - GitHub repo name
   * @returns True if updated
   *
   * @example
   * ```typescript
   * await orgService.setDefaultRepository(orgId, 'my-org', 'main-repo');
   * ```
   */
  setDefaultRepository(
    organizationId: string,
    repositoryOwner: string,
    repositoryName: string
  ): Promise<boolean>;

  /**
   * Create an invitation for a new member.
   *
   * @param params - Invitation parameters
   * @returns Created invitation with token
   *
   * @example
   * ```typescript
   * const invitation = await orgService.createInvitation({
   *   organizationId: orgId,
   *   email: 'newbie@company.com',
   *   role: 'member',
   *   invitedBy: adminId,
   * });
   *
   * // Send email with invitation link
   * sendInvitationEmail(invitation.email, invitation.token);
   * ```
   */
  createInvitation(params: InviteMemberParams): Promise<OrganizationInvitation>;

  /**
   * Get an invitation by token.
   *
   * @param token - The invitation token
   * @returns Invitation if valid, null if not found or expired
   *
   * @example
   * ```typescript
   * const invitation = await orgService.getInvitationByToken(token);
   *
   * if (!invitation) {
   *   return res.status(404).json({ error: 'Invalid or expired invitation' });
   * }
   *
   * // Show invitation details to user
   * res.json({
   *   organization: invitation.organization.displayName,
   *   role: invitation.role,
   * });
   * ```
   */
  getInvitationByToken(token: string): Promise<OrganizationInvitation | null>;

  /**
   * Get an invitation by ID.
   *
   * @param invitationId - The invitation ID
   * @returns Invitation if found
   */
  getInvitationById(invitationId: string): Promise<OrganizationInvitation | null>;

  /**
   * Accept an invitation and join the organization.
   *
   * @param token - The invitation token
   * @param userId - The user accepting the invitation
   * @returns Created member record, null if invalid
   *
   * @example
   * ```typescript
   * const member = await orgService.acceptInvitation(token, userId);
   *
   * if (!member) {
   *   return res.status(400).json({ error: 'Invalid invitation' });
   * }
   *
   * res.json({
   *   message: 'Welcome to the organization!',
   *   role: member.role,
   * });
   * ```
   */
  acceptInvitation(
    token: string,
    userId: string
  ): Promise<OrganizationMember | null>;

  /**
   * Revoke an invitation.
   *
   * @param invitationId - The invitation ID
   * @returns True if revoked
   *
   * @example
   * ```typescript
   * await orgService.revokeInvitation(invitationId);
   * ```
   */
  revokeInvitation(invitationId: string): Promise<boolean>;

  /**
   * Get pending invitations for an organization.
   *
   * @param organizationId - The organization ID
   * @returns Pending invitations
   *
   * @example
   * ```typescript
   * const pending = await orgService.getPendingInvitations(orgId);
   *
   * console.log(`${pending.length} pending invitations`);
   * for (const inv of pending) {
   *   console.log(`${inv.email} (${inv.role})`);
   * }
   * ```
   */
  getPendingInvitations(
    organizationId: string
  ): Promise<OrganizationInvitation[]>;
}
