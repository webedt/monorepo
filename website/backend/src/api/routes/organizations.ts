/**
 * Organization/Studio routes for group account management
 */

import { Router } from 'express';
import { organizationService } from '@webedt/shared';
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

// GET /api/organizations - List user's organizations
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
    console.error('Error fetching organizations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch organizations' });
  }
});

// POST /api/organizations - Create a new organization
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
    console.error('Error creating organization:', error);
    // Handle race condition where slug was taken between check and create
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'Slug is already taken' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create organization' });
  }
});

// NOTE: Static path routes must come BEFORE /:id routes to avoid matching issues

// GET /api/organizations/slug-available/:slug - Check if slug is available
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
    console.error('Error checking slug availability:', error);
    res.status(500).json({ success: false, error: 'Failed to check slug availability' });
  }
});

// GET /api/organizations/slug/:slug - Get organization by slug
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
    console.error('Error fetching organization:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch organization' });
  }
});

// POST /api/organizations/invitations/:token/accept - Accept invitation
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
    console.error('Error accepting invitation:', error);
    res.status(500).json({ success: false, error: 'Failed to accept invitation' });
  }
});

// GET /api/organizations/:id - Get organization details
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
    console.error('Error fetching organization:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch organization' });
  }
});

// PATCH /api/organizations/:id - Update organization
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
    console.error('Error updating organization:', error);
    res.status(500).json({ success: false, error: 'Failed to update organization' });
  }
});

// DELETE /api/organizations/:id - Delete organization
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
    console.error('Error deleting organization:', error);
    res.status(500).json({ success: false, error: 'Failed to delete organization' });
  }
});

// GET /api/organizations/:id/members - List organization members
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
    console.error('Error fetching members:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch members' });
  }
});

// POST /api/organizations/:id/members - Add a member directly (admin only)
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
    console.error('Error adding member:', error);
    res.status(500).json({ success: false, error: 'Failed to add member' });
  }
});

// PATCH /api/organizations/:id/members/:userId - Update member role
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
    console.error('Error updating member role:', error);
    res.status(500).json({ success: false, error: 'Failed to update member role' });
  }
});

// DELETE /api/organizations/:id/members/:userId - Remove member
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
    console.error('Error removing member:', error);
    res.status(500).json({ success: false, error: 'Failed to remove member' });
  }
});

// POST /api/organizations/:id/leave - Leave organization
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
    console.error('Error leaving organization:', error);
    res.status(500).json({ success: false, error: 'Failed to leave organization' });
  }
});

// GET /api/organizations/:id/repositories - List organization repositories
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
    console.error('Error fetching repositories:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
});

// POST /api/organizations/:id/repositories - Add repository to organization
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
    console.error('Error adding repository:', error);
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'This repository is already added to the organization' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to add repository' });
  }
});

// DELETE /api/organizations/:id/repositories/:owner/:repo - Remove repository
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
    console.error('Error removing repository:', error);
    res.status(500).json({ success: false, error: 'Failed to remove repository' });
  }
});

// POST /api/organizations/:id/repositories/:owner/:repo/default - Set default repository
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
    console.error('Error setting default repository:', error);
    res.status(500).json({ success: false, error: 'Failed to set default repository' });
  }
});

// POST /api/organizations/:id/invitations - Create invitation
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
    console.error('Error creating invitation:', error);
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'An invitation for this email already exists' });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to create invitation' });
  }
});

// GET /api/organizations/:id/invitations - List pending invitations
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
    console.error('Error fetching invitations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch invitations' });
  }
});

// DELETE /api/organizations/:id/invitations/:invitationId - Revoke invitation
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
    console.error('Error revoking invitation:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke invitation' });
  }
});

export default router;
