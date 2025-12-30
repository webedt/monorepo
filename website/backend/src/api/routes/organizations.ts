/**
 * Organization/Studio routes for group account management
 *
 * @openapi
 * tags:
 *   - name: Organizations
 *     description: Organization and team management operations
 */

import { Router } from 'express';
import { organizationService, logger } from '@webedt/shared';
import { AuthRequest, requireAuth } from '../middleware/auth.js';

import type { Request, Response } from 'express';
import type { OrganizationRole } from '@webedt/shared';

const router = Router();

// Helper to check if slug is valid (lowercase alphanumeric with hyphens)
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length >= 3 && slug.length <= 50;
}

// Helper to check if an error is a PostgreSQL unique constraint violation
function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof Error) {
    // PostgreSQL unique violation error code is '23505'
    const pgError = error as Error & { code?: string };
    if (pgError.code === '23505') {
      return true;
    }
    // Fallback: check error message for 'unique constraint' or 'duplicate key'
    const message = error.message.toLowerCase();
    return message.includes('unique constraint') || message.includes('duplicate key');
  }
  return false;
}

/**
 * @openapi
 * /api/organizations:
 *   get:
 *     tags: [Organizations]
 *     summary: List user's organizations
 *     description: Get all organizations the user is a member of
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Organizations retrieved successfully
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;

    const organizations = await organizationService.getUserOrganizations(userId);

    res.json({
      success: true,
      data: organizations.map(org => ({
        ...org.organization,
        role: org.role,
        joinedAt: org.joinedAt,
      })),
    });
  } catch (error) {
    logger.error('Error fetching organizations', error as Error, { component: 'organizations', operation: 'list' });
    res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

/**
 * @openapi
 * /api/organizations:
 *   post:
 *     tags: [Organizations]
 *     summary: Create organization
 *     description: Create a new organization with the creator as owner
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *               avatarUrl:
 *                 type: string
 *               websiteUrl:
 *                 type: string
 *               githubOrg:
 *                 type: string
 *     responses:
 *       201:
 *         description: Organization created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         description: Slug already taken
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { name, slug, displayName, description, avatarUrl, websiteUrl, githubOrg } = req.body;

    if (!name || !slug) {
      res.status(400).json({ success: false, error: 'Name and slug are required' });
      return;
    }

    // Validate name length
    if (name.length < 2 || name.length > 100) {
      res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters' });
      return;
    }

    // Validate displayName length if provided
    if (displayName && (displayName.length < 2 || displayName.length > 100)) {
      res.status(400).json({ success: false, error: 'Display name must be between 2 and 100 characters' });
      return;
    }

    if (!isValidSlug(slug)) {
      res.status(400).json({
        success: false,
        error: 'Invalid slug. Must be 3-50 characters, lowercase alphanumeric with hyphens, cannot start or end with hyphen',
      });
      return;
    }

    const slugAvailable = await organizationService.isSlugAvailable(slug);
    if (!slugAvailable) {
      res.status(409).json({ success: false, error: 'Slug is already taken' });
      return;
    }

    const organization = await organizationService.create(
      { name, slug, displayName, description, avatarUrl, websiteUrl, githubOrg },
      userId
    );

    res.status(201).json({ success: true, data: organization });
  } catch (error: unknown) {
    logger.error('Error creating organization', error as Error, { component: 'organizations', operation: 'create' });
    // Handle race condition where slug was taken between check and create
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'Slug is already taken' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create organization' });
  }
});

// NOTE: Static path routes must come BEFORE /:id routes to avoid matching issues

/**
 * @openapi
 * /api/organizations/slug-available/{slug}:
 *   get:
 *     tags: [Organizations]
 *     summary: Check slug availability
 *     description: Verify if an organization slug is available
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Slug availability checked
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/slug-available/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    if (!isValidSlug(slug)) {
      res.json({ success: true, data: { available: false, reason: 'invalid' } });
      return;
    }

    const available = await organizationService.isSlugAvailable(slug);
    res.json({ success: true, data: { available, reason: available ? null : 'taken' } });
  } catch (error) {
    logger.error('Error checking slug availability', error as Error, { component: 'organizations', operation: 'checkSlug' });
    res.status(500).json({ success: false, error: 'Failed to check slug availability' });
  }
});

/**
 * @openapi
 * /api/organizations/slug/{slug}:
 *   get:
 *     tags: [Organizations]
 *     summary: Get organization by slug
 *     description: Retrieve organization details by slug
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization retrieved successfully
 *       403:
 *         description: Not a member of this organization
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/slug/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { slug } = req.params;

    const organization = await organizationService.getBySlug(slug);
    if (!organization) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    const member = await organizationService.getMember(organization.id, userId);
    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...organization,
        role: member.role,
      },
    });
  } catch (error) {
    logger.error('Error fetching organization', error as Error, { component: 'organizations', operation: 'getBySlug' });
    res.status(500).json({ success: false, error: 'Failed to fetch organization' });
  }
});

/**
 * @openapi
 * /api/organizations/invitations/{token}/accept:
 *   post:
 *     tags: [Organizations]
 *     summary: Accept invitation
 *     description: Accept an organization invitation using token
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation accepted successfully
 *       403:
 *         description: Email mismatch
 *       404:
 *         description: Invitation not found or expired
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/invitations/:token/accept', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const userEmail = authReq.user.email;
    const { token } = req.params;

    // First, verify the invitation exists and email matches
    const invitation = await organizationService.getInvitationByToken(token);
    if (!invitation) {
      res.status(404).json({ success: false, error: 'Invitation not found or expired' });
      return;
    }

    // Verify the invitation email matches the user's email
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      res.status(403).json({
        success: false,
        error: 'This invitation was sent to a different email address',
      });
      return;
    }

    const member = await organizationService.acceptInvitation(token, userId);
    if (!member) {
      res.status(404).json({ success: false, error: 'Invitation not found or expired' });
      return;
    }

    const organization = await organizationService.getById(member.organizationId);

    res.json({
      success: true,
      data: {
        member,
        organization,
      },
    });
  } catch (error) {
    logger.error('Error accepting invitation', error as Error, { component: 'organizations', operation: 'acceptInvitation' });
    res.status(500).json({ success: false, error: 'Failed to accept invitation' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}:
 *   get:
 *     tags: [Organizations]
 *     summary: Get organization details
 *     description: Get organization with members and repositories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization retrieved successfully
 *       403:
 *         description: Not a member of this organization
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const organization = await organizationService.getById(id);
    if (!organization) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    const member = await organizationService.getMember(id, userId);
    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    const members = await organizationService.getMembers(id);
    const repositories = await organizationService.getRepositories(id);

    res.json({
      success: true,
      data: {
        ...organization,
        role: member.role,
        members,
        repositories,
      },
    });
  } catch (error) {
    logger.error('Error fetching organization', error as Error, { component: 'organizations', operation: 'getById' });
    res.status(500).json({ success: false, error: 'Failed to fetch organization' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}:
 *   patch:
 *     tags: [Organizations]
 *     summary: Update organization
 *     description: Update organization properties (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Organization updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: Admin access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;
    const { name, displayName, description, avatarUrl, websiteUrl, githubOrg } = req.body;

    // Validate name length if provided
    if (name !== undefined && (name.length < 2 || name.length > 100)) {
      res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters' });
      return;
    }

    // Validate displayName length if provided
    if (displayName !== undefined && displayName !== null && (displayName.length < 2 || displayName.length > 100)) {
      res.status(400).json({ success: false, error: 'Display name must be between 2 and 100 characters' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const organization = await organizationService.update(id, {
      name,
      displayName,
      description,
      avatarUrl,
      websiteUrl,
      githubOrg,
    });

    if (!organization) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    res.json({ success: true, data: organization });
  } catch (error) {
    logger.error('Error updating organization', error as Error, { component: 'organizations', operation: 'update' });
    res.status(500).json({ success: false, error: 'Failed to update organization' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Delete organization
 *     description: Delete organization (owner only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Organization deleted successfully
 *       403:
 *         description: Owner access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const hasPermission = await organizationService.hasPermission(id, userId, 'owner');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Owner access required' });
      return;
    }

    const deleted = await organizationService.delete(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    res.json({ success: true, data: { id } });
  } catch (error) {
    logger.error('Error deleting organization', error as Error, { component: 'organizations', operation: 'delete' });
    res.status(500).json({ success: false, error: 'Failed to delete organization' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/members:
 *   get:
 *     tags: [Organizations]
 *     summary: List members
 *     description: Get all organization members
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Members retrieved successfully
 *       403:
 *         description: Not a member of this organization
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const member = await organizationService.getMember(id, userId);
    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    const members = await organizationService.getMembers(id);
    res.json({ success: true, data: members });
  } catch (error) {
    logger.error('Error fetching members', error as Error, { component: 'organizations', operation: 'getMembers' });
    res.status(500).json({ success: false, error: 'Failed to fetch members' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/members:
 *   post:
 *     tags: [Organizations]
 *     summary: Add member
 *     description: Add a member directly (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - role
 *             properties:
 *               userId:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [admin, member]
 *     responses:
 *       201:
 *         description: Member added successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: Admin access required
 *       409:
 *         description: User already a member
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:id/members', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;
    const { userId: newMemberId, role } = req.body;

    if (!newMemberId || !role) {
      res.status(400).json({ success: false, error: 'userId and role are required' });
      return;
    }

    if (!['admin', 'member'].includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role. Must be admin or member' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const existingMember = await organizationService.getMember(id, newMemberId);
    if (existingMember) {
      res.status(409).json({ success: false, error: 'User is already a member' });
      return;
    }

    const member = await organizationService.addMember(id, newMemberId, role as OrganizationRole, userId);
    res.status(201).json({ success: true, data: member });
  } catch (error) {
    logger.error('Error adding member', error as Error, { component: 'organizations', operation: 'addMember' });
    res.status(500).json({ success: false, error: 'Failed to add member' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/members/{userId}:
 *   patch:
 *     tags: [Organizations]
 *     summary: Update member role
 *     description: Change member role (owner only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [owner, admin, member]
 *     responses:
 *       200:
 *         description: Member role updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: Owner access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.patch('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const currentUserId = authReq.user.id;
    const { id, userId: targetUserId } = req.params;
    const { role } = req.body;

    if (!role || !['owner', 'admin', 'member'].includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, currentUserId, 'owner');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Owner access required to change roles' });
      return;
    }

    if (currentUserId === targetUserId && role !== 'owner') {
      res.status(400).json({ success: false, error: 'Cannot demote yourself from owner' });
      return;
    }

    const member = await organizationService.updateMemberRole(id, targetUserId, role as OrganizationRole);
    if (!member) {
      res.status(404).json({ success: false, error: 'Member not found' });
      return;
    }

    res.json({ success: true, data: member });
  } catch (error) {
    logger.error('Error updating member role', error as Error, { component: 'organizations', operation: 'updateMemberRole' });
    res.status(500).json({ success: false, error: 'Failed to update member role' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/members/{userId}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Remove member
 *     description: Remove a member (admin only, cannot remove owner)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Member removed successfully
 *       400:
 *         description: Use leave endpoint to leave organization
 *       403:
 *         description: Admin access required or cannot remove owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/:id/members/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const currentUserId = authReq.user.id;
    const { id, userId: targetUserId } = req.params;

    if (currentUserId === targetUserId) {
      res.status(400).json({ success: false, error: 'Use leave endpoint to leave organization' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, currentUserId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const targetMember = await organizationService.getMember(id, targetUserId);
    if (targetMember && targetMember.role === 'owner') {
      res.status(403).json({ success: false, error: 'Cannot remove owner' });
      return;
    }

    const removed = await organizationService.removeMember(id, targetUserId);
    if (!removed) {
      res.status(404).json({ success: false, error: 'Member not found' });
      return;
    }

    res.json({ success: true, data: { userId: targetUserId } });
  } catch (error) {
    logger.error('Error removing member', error as Error, { component: 'organizations', operation: 'removeMember' });
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/leave:
 *   post:
 *     tags: [Organizations]
 *     summary: Leave organization
 *     description: Leave organization (owner must transfer ownership first)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Left organization successfully
 *       400:
 *         description: Cannot leave as sole owner
 *       404:
 *         description: Not a member of this organization
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:id/leave', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const member = await organizationService.getMember(id, userId);
    if (!member) {
      res.status(404).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    if (member.role === 'owner') {
      const members = await organizationService.getMembers(id);
      const otherOwners = members.filter(m => m.role === 'owner' && m.userId !== userId);
      if (otherOwners.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot leave as the only owner. Transfer ownership or delete the organization',
        });
        return;
      }
    }

    await organizationService.removeMember(id, userId);
    res.json({ success: true, data: { message: 'Left organization' } });
  } catch (error) {
    logger.error('Error leaving organization', error as Error, { component: 'organizations', operation: 'leave' });
    res.status(500).json({ success: false, error: 'Failed to leave organization' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/repositories:
 *   get:
 *     tags: [Organizations]
 *     summary: List repositories
 *     description: Get all organization repositories
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Repositories retrieved successfully
 *       403:
 *         description: Not a member of this organization
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id/repositories', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const member = await organizationService.getMember(id, userId);
    if (!member) {
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    const repositories = await organizationService.getRepositories(id);
    res.json({ success: true, data: repositories });
  } catch (error) {
    logger.error('Error fetching repositories', error as Error, { component: 'organizations', operation: 'getRepositories' });
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/repositories:
 *   post:
 *     tags: [Organizations]
 *     summary: Add repository
 *     description: Add repository to organization (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - repositoryOwner
 *               - repositoryName
 *             properties:
 *               repositoryOwner:
 *                 type: string
 *               repositoryName:
 *                 type: string
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Repository added successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Repository already added
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:id/repositories', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;
    const { repositoryOwner, repositoryName, isDefault } = req.body;

    if (!repositoryOwner || !repositoryName) {
      res.status(400).json({ success: false, error: 'repositoryOwner and repositoryName are required' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const repository = await organizationService.addRepository({
      organizationId: id,
      repositoryOwner,
      repositoryName,
      isDefault: isDefault ?? false,
      addedBy: userId,
    });

    res.status(201).json({ success: true, data: repository });
  } catch (error: unknown) {
    logger.error('Error adding repository', error as Error, { component: 'organizations', operation: 'addRepository' });
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'This repository is already added to the organization' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to add repository' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/repositories/{owner}/{repo}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Remove repository
 *     description: Remove repository from organization (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: repo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Repository removed successfully
 *       403:
 *         description: Admin access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/:id/repositories/:owner/:repo', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id, owner, repo } = req.params;

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const removed = await organizationService.removeRepository(id, owner, repo);
    if (!removed) {
      res.status(404).json({ success: false, error: 'Repository not found' });
      return;
    }

    res.json({ success: true, data: { owner, repo } });
  } catch (error) {
    logger.error('Error removing repository', error as Error, { component: 'organizations', operation: 'removeRepository' });
    res.status(500).json({ success: false, error: 'Failed to remove repository' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/repositories/{owner}/{repo}/default:
 *   post:
 *     tags: [Organizations]
 *     summary: Set default repository
 *     description: Set as default repository (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: owner
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: repo
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Default repository set successfully
 *       403:
 *         description: Admin access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:id/repositories/:owner/:repo/default', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id, owner, repo } = req.params;

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const success = await organizationService.setDefaultRepository(id, owner, repo);
    if (!success) {
      res.status(404).json({ success: false, error: 'Repository not found' });
      return;
    }

    res.json({ success: true, data: { owner, repo, isDefault: true } });
  } catch (error) {
    logger.error('Error setting default repository', error as Error, { component: 'organizations', operation: 'setDefaultRepository' });
    res.status(500).json({ success: false, error: 'Failed to set default repository' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/invitations:
 *   post:
 *     tags: [Organizations]
 *     summary: Create invitation
 *     description: Invite user by email (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               role:
 *                 type: string
 *                 enum: [admin, member]
 *     responses:
 *       201:
 *         description: Invitation created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         description: Admin access required
 *       409:
 *         description: Invitation already exists
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:id/invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;
    const { email, role } = req.body;

    if (!email) {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ success: false, error: 'Invalid email format' });
      return;
    }

    if (role && !['admin', 'member'].includes(role)) {
      res.status(400).json({ success: false, error: 'Invalid role. Must be admin or member' });
      return;
    }

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const invitation = await organizationService.createInvitation({
      organizationId: id,
      email,
      role: (role as OrganizationRole) || 'member',
      invitedBy: userId,
    });

    res.status(201).json({ success: true, data: invitation });
  } catch (error: unknown) {
    logger.error('Error creating invitation', error as Error, { component: 'organizations', operation: 'createInvitation' });
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'An invitation for this email already exists' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create invitation' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/invitations:
 *   get:
 *     tags: [Organizations]
 *     summary: List invitations
 *     description: Get pending invitations (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitations retrieved successfully
 *       403:
 *         description: Admin access required
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id/invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id } = req.params;

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const invitations = await organizationService.getPendingInvitations(id);
    res.json({ success: true, data: invitations });
  } catch (error) {
    logger.error('Error fetching invitations', error as Error, { component: 'organizations', operation: 'getPendingInvitations' });
    res.status(500).json({ success: false, error: 'Failed to fetch invitations' });
  }
});

/**
 * @openapi
 * /api/organizations/{id}/invitations/{invitationId}:
 *   delete:
 *     tags: [Organizations]
 *     summary: Revoke invitation
 *     description: Cancel pending invitation (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Invitation revoked successfully
 *       403:
 *         description: Admin access required
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/:id/invitations/:invitationId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { id, invitationId } = req.params;

    const hasPermission = await organizationService.hasPermission(id, userId, 'admin');
    if (!hasPermission) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    // Verify the invitation belongs to this organization
    const invitation = await organizationService.getInvitationById(invitationId);
    if (!invitation || invitation.organizationId !== id) {
      res.status(404).json({ success: false, error: 'Invitation not found' });
      return;
    }

    await organizationService.revokeInvitation(invitationId);

    res.json({ success: true, data: { invitationId } });
  } catch (error) {
    logger.error('Error revoking invitation', error as Error, { component: 'organizations', operation: 'revokeInvitation' });
    res.status(500).json({ success: false, error: 'Failed to revoke invitation' });
  }
});

export default router;
