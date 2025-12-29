/**
 * Community Channels Routes
 * Handles real-time community channel messaging and activity
 */

import { Router, Request, Response } from 'express';
import {
  db,
  users,
  games,
  communityChannels,
  channelMessages,
  eq,
  and,
  desc,
  asc,
  sql,
  sendSuccess,
  sendError,
  sendNotFound,
  sendForbidden,
  sendInternalError,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all active channels
router.get('/', async (req: Request, res: Response) => {
  try {
    const channels = await db
      .select({
        channel: communityChannels,
        game: games,
      })
      .from(communityChannels)
      .leftJoin(games, eq(communityChannels.gameId, games.id))
      .where(eq(communityChannels.status, 'active'))
      .orderBy(asc(communityChannels.sortOrder), asc(communityChannels.name));

    sendSuccess(res, {
      channels: channels.map((c) => ({
        ...c.channel,
        game: c.game,
      })),
    });
  } catch (error) {
    logger.error('Get channels error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to fetch channels');
  }
});

// Get channel by slug
router.get('/by-slug/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    const [result] = await db
      .select({
        channel: communityChannels,
        game: games,
      })
      .from(communityChannels)
      .leftJoin(games, eq(communityChannels.gameId, games.id))
      .where(
        and(
          eq(communityChannels.slug, slug),
          eq(communityChannels.status, 'active')
        )
      )
      .limit(1);

    if (!result) {
      sendNotFound(res, 'Channel not found');
      return;
    }

    sendSuccess(res, {
      ...result.channel,
      game: result.game,
    });
  } catch (error) {
    logger.error('Get channel by slug error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to fetch channel');
  }
});

// Get recent messages across all channels (for activity feed)
// NOTE: This route MUST be defined before /:id to avoid being caught by the param route
router.get('/activity/recent', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    // Get recent messages with author and channel info
    const messages = await db
      .select({
        message: channelMessages,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
        channel: {
          id: communityChannels.id,
          name: communityChannels.name,
          slug: communityChannels.slug,
        },
      })
      .from(channelMessages)
      .innerJoin(users, eq(channelMessages.userId, users.id))
      .innerJoin(communityChannels, eq(channelMessages.channelId, communityChannels.id))
      .where(
        and(
          eq(channelMessages.status, 'published'),
          eq(communityChannels.status, 'active')
        )
      )
      .orderBy(desc(channelMessages.createdAt))
      .limit(limit);

    sendSuccess(res, {
      messages: messages.map((m) => ({
        ...m.message,
        author: {
          id: m.author.id,
          displayName: m.author.displayName || m.author.email?.split('@')[0],
        },
        channel: m.channel,
      })),
    });
  } catch (error) {
    logger.error('Get recent activity error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to fetch recent activity');
  }
});

// Get channel by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.id;

    const [result] = await db
      .select({
        channel: communityChannels,
        game: games,
      })
      .from(communityChannels)
      .leftJoin(games, eq(communityChannels.gameId, games.id))
      .where(eq(communityChannels.id, channelId))
      .limit(1);

    if (!result || result.channel.status !== 'active') {
      sendNotFound(res, 'Channel not found');
      return;
    }

    sendSuccess(res, {
      ...result.channel,
      game: result.game,
    });
  } catch (error) {
    logger.error('Get channel error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to fetch channel');
  }
});

// Get messages for a channel
router.get('/:id/messages', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Verify channel exists
    const [channel] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.id, channelId))
      .limit(1);

    if (!channel || channel.status !== 'active') {
      sendNotFound(res, 'Channel not found');
      return;
    }

    // Get messages with author info
    const messages = await db
      .select({
        message: channelMessages,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(channelMessages)
      .innerJoin(users, eq(channelMessages.userId, users.id))
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          eq(channelMessages.status, 'published')
        )
      )
      .orderBy(desc(channelMessages.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count using efficient SQL COUNT
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          eq(channelMessages.status, 'published')
        )
      );

    const total = count;

    // Reverse to get chronological order for display
    const sortedMessages = messages.reverse();

    sendSuccess(res, {
      messages: sortedMessages.map((m) => ({
        ...m.message,
        author: {
          id: m.author.id,
          displayName: m.author.displayName || m.author.email?.split('@')[0],
        },
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Get channel messages error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to fetch messages');
  }
});

// Post a message to a channel (requires auth)
router.post('/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const channelId = req.params.id;
    const { content, replyToId, images } = req.body;

    if (!content || content.trim().length === 0) {
      sendError(res, 'Message content is required', 400);
      return;
    }

    // Validate content length (max 4000 characters)
    const MAX_MESSAGE_LENGTH = 4000;
    if (content.length > MAX_MESSAGE_LENGTH) {
      sendError(res, `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`, 400);
      return;
    }

    // Verify channel exists and is not read-only
    const [channel] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.id, channelId))
      .limit(1);

    if (!channel || channel.status !== 'active') {
      sendNotFound(res, 'Channel not found');
      return;
    }

    if (channel.isReadOnly && !authReq.user!.isAdmin) {
      sendForbidden(res, 'This channel is read-only');
      return;
    }

    // Verify reply target exists if provided
    if (replyToId) {
      const [replyTarget] = await db
        .select()
        .from(channelMessages)
        .where(
          and(
            eq(channelMessages.id, replyToId),
            eq(channelMessages.channelId, channelId)
          )
        )
        .limit(1);

      if (!replyTarget) {
        sendNotFound(res, 'Reply target not found');
        return;
      }
    }

    // Create message
    const [message] = await db
      .insert(channelMessages)
      .values({
        id: uuidv4(),
        channelId,
        userId: authReq.user!.id,
        content: content.trim(),
        replyToId: replyToId || null,
        images: images || [],
        status: 'published',
      })
      .returning();

    // Get author info for response
    const [author] = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    logger.info(`User ${authReq.user!.id} posted message in channel ${channelId}`, {
      component: 'Channels',
      messageId: message.id,
    });

    sendSuccess(res, {
      message: {
        ...message,
        author: {
          id: author.id,
          displayName: author.displayName || author.email?.split('@')[0],
        },
      },
    });
  } catch (error) {
    logger.error('Post message error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to post message');
  }
});

// Edit a message
router.patch('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const messageId = req.params.id;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      sendError(res, 'Message content is required', 400);
      return;
    }

    // Validate content length (max 4000 characters)
    const MAX_MESSAGE_LENGTH = 4000;
    if (content.length > MAX_MESSAGE_LENGTH) {
      sendError(res, `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`, 400);
      return;
    }

    // Get message
    const [message] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, messageId))
      .limit(1);

    if (!message) {
      sendNotFound(res, 'Message not found');
      return;
    }

    // Check ownership
    if (message.userId !== authReq.user!.id) {
      sendForbidden(res, 'Access denied');
      return;
    }

    // Update message
    const [updated] = await db
      .update(channelMessages)
      .set({
        content: content.trim(),
        edited: true,
        updatedAt: new Date(),
      })
      .where(eq(channelMessages.id, messageId))
      .returning();

    sendSuccess(res, { message: updated });
  } catch (error) {
    logger.error('Edit message error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to edit message');
  }
});

// Delete a message
router.delete('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const messageId = req.params.id;

    // Get message
    const [message] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, messageId))
      .limit(1);

    if (!message) {
      sendNotFound(res, 'Message not found');
      return;
    }

    // Check ownership (or admin)
    if (message.userId !== authReq.user!.id && !authReq.user!.isAdmin) {
      sendForbidden(res, 'Access denied');
      return;
    }

    // Soft delete
    await db
      .update(channelMessages)
      .set({ status: 'removed' })
      .where(eq(channelMessages.id, messageId));

    sendSuccess(res, { message: 'Message deleted' });
  } catch (error) {
    logger.error('Delete message error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to delete message');
  }
});

// Admin: Create a new channel
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user!.isAdmin) {
      sendForbidden(res, 'Admin access required');
      return;
    }

    const { name, slug, description, gameId, isDefault, isReadOnly, sortOrder } = req.body;

    if (!name || !slug) {
      sendError(res, 'Name and slug are required', 400);
      return;
    }

    // Check slug uniqueness
    const [existing] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.slug, slug))
      .limit(1);

    if (existing) {
      sendError(res, 'Channel with this slug already exists', 400);
      return;
    }

    // Verify game exists if provided
    if (gameId) {
      const [game] = await db
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!game) {
        sendNotFound(res, 'Game not found');
        return;
      }
    }

    // Create channel
    const [channel] = await db
      .insert(communityChannels)
      .values({
        id: uuidv4(),
        name,
        slug,
        description: description || null,
        gameId: gameId || null,
        isDefault: isDefault || false,
        isReadOnly: isReadOnly || false,
        sortOrder: sortOrder || 0,
        status: 'active',
      })
      .returning();

    logger.info(`Admin ${authReq.user!.id} created channel ${channel.id}`, {
      component: 'Channels',
      channelSlug: slug,
    });

    sendSuccess(res, { channel });
  } catch (error) {
    logger.error('Create channel error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to create channel');
  }
});

// Admin: Update a channel
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user!.isAdmin) {
      sendForbidden(res, 'Admin access required');
      return;
    }

    const channelId = req.params.id;
    const { name, description, isDefault, isReadOnly, sortOrder, status } = req.body;

    // Verify channel exists
    const [channel] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.id, channelId))
      .limit(1);

    if (!channel) {
      sendNotFound(res, 'Channel not found');
      return;
    }

    // Build update
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isDefault !== undefined) updateData.isDefault = isDefault;
    if (isReadOnly !== undefined) updateData.isReadOnly = isReadOnly;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (status !== undefined) updateData.status = status;

    const [updated] = await db
      .update(communityChannels)
      .set(updateData)
      .where(eq(communityChannels.id, channelId))
      .returning();

    sendSuccess(res, { channel: updated });
  } catch (error) {
    logger.error('Update channel error', error as Error, { component: 'Channels' });
    sendInternalError(res, 'Failed to update channel');
  }
});

export default router;
