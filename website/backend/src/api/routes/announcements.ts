/**
 * Announcements Routes
 * Handles official platform announcements from admins
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, users, announcements, eq, and, or, desc, gt, isNull, sql } from '@webedt/shared';
import { sendSuccess, sendError, sendNotFound, sendInternalError, logger } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// Input validation constants
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;

// Get published announcements (public)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, priority, pinned } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Build base query conditions - only published and not expired
    const now = new Date();
    const conditions = [
      eq(announcements.status, 'published'),
      or(
        isNull(announcements.expiresAt),
        gt(announcements.expiresAt, now)
      ),
    ];

    if (type) {
      conditions.push(eq(announcements.type, type as string));
    }

    if (priority) {
      conditions.push(eq(announcements.priority, priority as string));
    }

    if (pinned === 'true') {
      conditions.push(eq(announcements.pinned, true));
    }

    // Get announcements with author info, ordered by pinned first, then by publishedAt
    const items = await db
      .select({
        announcement: announcements,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(announcements)
      .innerJoin(users, eq(announcements.authorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
      .limit(limit)
      .offset(offset);

    // Get total count using COUNT(*)
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(announcements)
      .where(and(...conditions));

    const total = Number(countResult?.count ?? 0);

    sendSuccess(res, {
      announcements: items.map((a) => ({
        ...a.announcement,
        author: {
          id: a.author.id,
          displayName: a.author.displayName || a.author.email?.split('@')[0],
        },
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Get announcements error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to fetch announcements');
  }
});

// IMPORTANT: Admin routes must be defined BEFORE /:id to avoid route conflicts
// List all announcements for admin (including drafts and archived)
router.get('/admin/all', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { type, priority, status } = req.query;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Build conditions
    const conditions: ReturnType<typeof eq>[] = [];

    if (type) {
      conditions.push(eq(announcements.type, type as string));
    }

    if (priority) {
      conditions.push(eq(announcements.priority, priority as string));
    }

    if (status) {
      conditions.push(eq(announcements.status, status as string));
    }

    // Get all announcements with author info
    const items = await db
      .select({
        announcement: announcements,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(announcements)
      .innerJoin(users, eq(announcements.authorId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(announcements.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count using COUNT(*)
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(announcements)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult?.count ?? 0);

    sendSuccess(res, {
      announcements: items.map((a) => ({
        ...a.announcement,
        author: {
          id: a.author.id,
          displayName: a.author.displayName || a.author.email?.split('@')[0],
        },
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Get admin announcements error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to fetch announcements');
  }
});

// Get single announcement (public for published, admin for all)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const announcementId = req.params.id;
    const authReq = req as AuthRequest;
    const isAdmin = authReq.user?.isAdmin || false;

    const [item] = await db
      .select({
        announcement: announcements,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(announcements)
      .innerJoin(users, eq(announcements.authorId, users.id))
      .where(eq(announcements.id, announcementId))
      .limit(1);

    if (!item) {
      sendNotFound(res, 'Announcement not found');
      return;
    }

    // Non-admins can only see published announcements
    if (!isAdmin && item.announcement.status !== 'published') {
      sendNotFound(res, 'Announcement not found');
      return;
    }

    sendSuccess(res, {
      ...item.announcement,
      author: {
        id: item.author.id,
        displayName: item.author.displayName || item.author.email?.split('@')[0],
      },
    });
  } catch (error) {
    logger.error('Get announcement error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to fetch announcement');
  }
});

// Create announcement (admin only)
router.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { title, content, type, priority, status, pinned, expiresAt } = req.body;

    // Validate required fields
    if (!title || !content) {
      sendError(res, 'Title and content are required', 400);
      return;
    }

    // Validate input lengths
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      sendError(res, `Title must be a string with maximum ${MAX_TITLE_LENGTH} characters`, 400);
      return;
    }

    if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
      sendError(res, `Content must be a string with maximum ${MAX_CONTENT_LENGTH} characters`, 400);
      return;
    }

    // Validate type
    const validTypes = ['maintenance', 'feature', 'alert', 'general'];
    if (type && !validTypes.includes(type)) {
      sendError(res, 'Invalid announcement type', 400);
      return;
    }

    // Validate priority
    const validPriorities = ['low', 'normal', 'high', 'critical'];
    if (priority && !validPriorities.includes(priority)) {
      sendError(res, 'Invalid priority', 400);
      return;
    }

    // Validate status
    const validStatuses = ['draft', 'published', 'archived'];
    if (status && !validStatuses.includes(status)) {
      sendError(res, 'Invalid status', 400);
      return;
    }

    // If publishing, set publishedAt
    const publishedAt = status === 'published' ? new Date() : null;

    // Create announcement
    const [announcement] = await db
      .insert(announcements)
      .values({
        id: uuidv4(),
        title: title.trim(),
        content: content.trim(),
        type: type || 'general',
        priority: priority || 'normal',
        status: status || 'draft',
        authorId: authReq.user!.id,
        publishedAt,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        pinned: pinned || false,
      })
      .returning();

    logger.info(`Admin ${authReq.user!.id} created announcement ${announcement.id}`, {
      component: 'Announcements',
      type: announcement.type,
      status: announcement.status,
    });

    sendSuccess(res, { announcement });
  } catch (error) {
    logger.error('Create announcement error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to create announcement');
  }
});

// Update announcement (admin only)
router.patch('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const announcementId = req.params.id;
    const { title, content, type, priority, status, pinned, expiresAt } = req.body;

    // Get existing announcement
    const [existing] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcementId))
      .limit(1);

    if (!existing) {
      sendNotFound(res, 'Announcement not found');
      return;
    }

    // Build update data
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
        sendError(res, `Title must be a string with maximum ${MAX_TITLE_LENGTH} characters`, 400);
        return;
      }
      updateData.title = title.trim();
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
        sendError(res, `Content must be a string with maximum ${MAX_CONTENT_LENGTH} characters`, 400);
        return;
      }
      updateData.content = content.trim();
    }
    if (type !== undefined) {
      const validTypes = ['maintenance', 'feature', 'alert', 'general'];
      if (!validTypes.includes(type)) {
        sendError(res, 'Invalid announcement type', 400);
        return;
      }
      updateData.type = type;
    }
    if (priority !== undefined) {
      const validPriorities = ['low', 'normal', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        sendError(res, 'Invalid priority', 400);
        return;
      }
      updateData.priority = priority;
    }
    if (status !== undefined) {
      const validStatuses = ['draft', 'published', 'archived'];
      if (!validStatuses.includes(status)) {
        sendError(res, 'Invalid status', 400);
        return;
      }
      updateData.status = status;
      // Set publishedAt when first published
      if (status === 'published' && existing.status !== 'published') {
        updateData.publishedAt = new Date();
      }
    }
    if (pinned !== undefined) updateData.pinned = pinned;
    if (expiresAt !== undefined) updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

    const [updated] = await db
      .update(announcements)
      .set(updateData)
      .where(eq(announcements.id, announcementId))
      .returning();

    logger.info(`Admin ${authReq.user!.id} updated announcement ${announcementId}`, {
      component: 'Announcements',
    });

    sendSuccess(res, { announcement: updated });
  } catch (error) {
    logger.error('Update announcement error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to update announcement');
  }
});

// Delete announcement (admin only)
router.delete('/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const announcementId = req.params.id;

    // Get existing announcement
    const [existing] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, announcementId))
      .limit(1);

    if (!existing) {
      sendNotFound(res, 'Announcement not found');
      return;
    }

    // Delete the announcement
    await db
      .delete(announcements)
      .where(eq(announcements.id, announcementId));

    logger.info(`Admin ${authReq.user!.id} deleted announcement ${announcementId}`, {
      component: 'Announcements',
    });

    sendSuccess(res, { message: 'Announcement deleted' });
  } catch (error) {
    logger.error('Delete announcement error', error as Error, { component: 'Announcements' });
    sendInternalError(res, 'Failed to delete announcement');
  }
});

export default router;
