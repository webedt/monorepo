/**
 * Announcements Routes
 * Handles official platform announcements from admins
 */

import { Router, Request, Response } from 'express';
import {
  db,
  users,
  announcements,
  eq,
  and,
  or,
  desc,
  gt,
  isNull,
  sql,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth.js';
import { publicShareRateLimiter, standardRateLimiter } from '../middleware/rateLimit.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Announcements
 *     description: Platform announcements and notifications
 */

// Input validation constants
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 50000;

/**
 * @openapi
 * /announcements:
 *   get:
 *     tags:
 *       - Announcements
 *     summary: Get published announcements
 *     description: Returns a paginated list of published announcements. Public endpoint - no authentication required.
 *     security: []
 *     parameters:
 *       - name: type
 *         in: query
 *         description: Filter by announcement type
 *         schema:
 *           type: string
 *           enum: [maintenance, feature, alert, general]
 *       - name: priority
 *         in: query
 *         description: Filter by priority level
 *         schema:
 *           type: string
 *           enum: [low, normal, high, critical]
 *       - name: pinned
 *         in: query
 *         description: Filter to only pinned announcements
 *         schema:
 *           type: string
 *           enum: ['true']
 *       - name: limit
 *         in: query
 *         description: Maximum number of results (default 20, max 100)
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - name: offset
 *         in: query
 *         description: Number of results to skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Announcements retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     announcements:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           title:
 *                             type: string
 *                           content:
 *                             type: string
 *                           type:
 *                             type: string
 *                             enum: [maintenance, feature, alert, general]
 *                           priority:
 *                             type: string
 *                             enum: [low, normal, high, critical]
 *                           status:
 *                             type: string
 *                             enum: [draft, published, archived]
 *                           pinned:
 *                             type: boolean
 *                           publishedAt:
 *                             type: string
 *                             format: date-time
 *                           expiresAt:
 *                             type: string
 *                             format: date-time
 *                             nullable: true
 *                           author:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               displayName:
 *                                 type: string
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get published announcements (public)
// Rate limit: 30 requests/minute (publicShareRateLimiter)
router.get('/', publicShareRateLimiter, async (req: Request, res: Response) => {
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

    res.json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    logger.error('Get announcements error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to fetch announcements' });
  }
});

/**
 * @openapi
 * /announcements/admin/all:
 *   get:
 *     tags:
 *       - Announcements
 *     summary: List all announcements (admin)
 *     description: Returns all announcements including drafts and archived. Admin access required.
 *     parameters:
 *       - name: type
 *         in: query
 *         schema:
 *           type: string
 *           enum: [maintenance, feature, alert, general]
 *       - name: priority
 *         in: query
 *         schema:
 *           type: string
 *           enum: [low, normal, high, critical]
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [draft, published, archived]
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: All announcements retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     announcements:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// IMPORTANT: Admin routes must be defined BEFORE /:id to avoid route conflicts
// List all announcements for admin (including drafts and archived)
// Rate limit: 100 requests/minute (standardRateLimiter)
router.get('/admin/all', standardRateLimiter, requireAdmin, async (req: Request, res: Response) => {
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

    res.json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    logger.error('Get admin announcements error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to fetch announcements' });
  }
});

/**
 * @openapi
 * /announcements/{id}:
 *   get:
 *     tags:
 *       - Announcements
 *     summary: Get announcement by ID
 *     description: Returns a single announcement. Public users can only see published announcements; admins can see all.
 *     security: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Announcement ID
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Announcement retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     title:
 *                       type: string
 *                     content:
 *                       type: string
 *                     type:
 *                       type: string
 *                     priority:
 *                       type: string
 *                     status:
 *                       type: string
 *                     pinned:
 *                       type: boolean
 *                     author:
 *                       type: object
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get single announcement (public for published, admin for all)
// Rate limit: 30 requests/minute (publicShareRateLimiter)
router.get('/:id', publicShareRateLimiter, async (req: Request, res: Response) => {
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
      res.status(404).json({ success: false, error: 'Announcement not found' });
      return;
    }

    // Non-admins can only see published announcements
    if (!isAdmin && item.announcement.status !== 'published') {
      res.status(404).json({ success: false, error: 'Announcement not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...item.announcement,
        author: {
          id: item.author.id,
          displayName: item.author.displayName || item.author.email?.split('@')[0],
        },
      },
    });
  } catch (error) {
    logger.error('Get announcement error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to fetch announcement' });
  }
});

/**
 * @openapi
 * /announcements:
 *   post:
 *     tags:
 *       - Announcements
 *     summary: Create announcement
 *     description: Creates a new announcement. Admin access required.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 200
 *                 description: Announcement title
 *               content:
 *                 type: string
 *                 maxLength: 50000
 *                 description: Announcement content (supports markdown)
 *               type:
 *                 type: string
 *                 enum: [maintenance, feature, alert, general]
 *                 default: general
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high, critical]
 *                 default: normal
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived]
 *                 default: draft
 *               pinned:
 *                 type: boolean
 *                 default: false
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Announcement created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     announcement:
 *                       type: object
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Create announcement (admin only)
// Rate limit: 100 requests/minute (standardRateLimiter)
router.post('/', standardRateLimiter, requireAdmin, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { title, content, type, priority, status, pinned, expiresAt } = req.body;

    // Validate required fields
    if (!title || !content) {
      res.status(400).json({
        success: false,
        error: 'Title and content are required',
      });
      return;
    }

    // Validate input lengths
    if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
      res.status(400).json({
        success: false,
        error: `Title must be a string with maximum ${MAX_TITLE_LENGTH} characters`,
      });
      return;
    }

    if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
      res.status(400).json({
        success: false,
        error: `Content must be a string with maximum ${MAX_CONTENT_LENGTH} characters`,
      });
      return;
    }

    // Validate type
    const validTypes = ['maintenance', 'feature', 'alert', 'general'];
    if (type && !validTypes.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid announcement type' });
      return;
    }

    // Validate priority
    const validPriorities = ['low', 'normal', 'high', 'critical'];
    if (priority && !validPriorities.includes(priority)) {
      res.status(400).json({ success: false, error: 'Invalid priority' });
      return;
    }

    // Validate status
    const validStatuses = ['draft', 'published', 'archived'];
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
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

    res.json({
      success: true,
      data: { announcement },
    });
  } catch (error) {
    logger.error('Create announcement error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to create announcement' });
  }
});

/**
 * @openapi
 * /announcements/{id}:
 *   patch:
 *     tags:
 *       - Announcements
 *     summary: Update announcement
 *     description: Updates an existing announcement. Admin access required.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Announcement ID
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 200
 *               content:
 *                 type: string
 *                 maxLength: 50000
 *               type:
 *                 type: string
 *                 enum: [maintenance, feature, alert, general]
 *               priority:
 *                 type: string
 *                 enum: [low, normal, high, critical]
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived]
 *               pinned:
 *                 type: boolean
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *     responses:
 *       200:
 *         description: Announcement updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     announcement:
 *                       type: object
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Update announcement (admin only)
// Rate limit: 100 requests/minute (standardRateLimiter)
router.patch('/:id', standardRateLimiter, requireAdmin, async (req: Request, res: Response) => {
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
      res.status(404).json({ success: false, error: 'Announcement not found' });
      return;
    }

    // Build update data
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
        res.status(400).json({
          success: false,
          error: `Title must be a string with maximum ${MAX_TITLE_LENGTH} characters`,
        });
        return;
      }
      updateData.title = title.trim();
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
        res.status(400).json({
          success: false,
          error: `Content must be a string with maximum ${MAX_CONTENT_LENGTH} characters`,
        });
        return;
      }
      updateData.content = content.trim();
    }
    if (type !== undefined) {
      const validTypes = ['maintenance', 'feature', 'alert', 'general'];
      if (!validTypes.includes(type)) {
        res.status(400).json({ success: false, error: 'Invalid announcement type' });
        return;
      }
      updateData.type = type;
    }
    if (priority !== undefined) {
      const validPriorities = ['low', 'normal', 'high', 'critical'];
      if (!validPriorities.includes(priority)) {
        res.status(400).json({ success: false, error: 'Invalid priority' });
        return;
      }
      updateData.priority = priority;
    }
    if (status !== undefined) {
      const validStatuses = ['draft', 'published', 'archived'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid status' });
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

    res.json({
      success: true,
      data: { announcement: updated },
    });
  } catch (error) {
    logger.error('Update announcement error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to update announcement' });
  }
});

/**
 * @openapi
 * /announcements/{id}:
 *   delete:
 *     tags:
 *       - Announcements
 *     summary: Delete announcement
 *     description: Permanently deletes an announcement. Admin access required.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: Announcement ID
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Announcement deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Announcement deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Delete announcement (admin only)
// Rate limit: 100 requests/minute (standardRateLimiter)
router.delete('/:id', standardRateLimiter, requireAdmin, async (req: Request, res: Response) => {
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
      res.status(404).json({ success: false, error: 'Announcement not found' });
      return;
    }

    // Delete the announcement
    await db
      .delete(announcements)
      .where(eq(announcements.id, announcementId));

    logger.info(`Admin ${authReq.user!.id} deleted announcement ${announcementId}`, {
      component: 'Announcements',
    });

    res.json({
      success: true,
      data: { message: 'Announcement deleted' },
    });
  } catch (error) {
    logger.error('Delete announcement error', error as Error, { component: 'Announcements' });
    res.status(500).json({ success: false, error: 'Failed to delete announcement' });
  }
});

export default router;
