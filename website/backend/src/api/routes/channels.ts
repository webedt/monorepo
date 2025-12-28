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

    res.json({
      success: true,
      data: {
        channels: channels.map((c) => ({
          ...c.channel,
          game: c.game,
        })),
      },
    });
  } catch (error) {
    logger.error('Get channels error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to fetch channels' });
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
      res.status(404).json({ success: false, error: 'Channel not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...result.channel,
        game: result.game,
      },
    });
  } catch (error) {
    logger.error('Get channel by slug error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to fetch channel' });
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
      res.status(404).json({ success: false, error: 'Channel not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...result.channel,
        game: result.game,
      },
    });
  } catch (error) {
    logger.error('Get channel error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to fetch channel' });
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
      res.status(404).json({ success: false, error: 'Channel not found' });
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

    // Get total count
    const allMessages = await db
      .select({ id: channelMessages.id })
      .from(channelMessages)
      .where(
        and(
          eq(channelMessages.channelId, channelId),
          eq(channelMessages.status, 'published')
        )
      );

    const total = allMessages.length;

    // Reverse to get chronological order for display
    const sortedMessages = messages.reverse();

    res.json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    logger.error('Get channel messages error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// Get recent messages across all channels (for activity feed)
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

    res.json({
      success: true,
      data: {
        messages: messages.map((m) => ({
          ...m.message,
          author: {
            id: m.author.id,
            displayName: m.author.displayName || m.author.email?.split('@')[0],
          },
          channel: m.channel,
        })),
      },
    });
  } catch (error) {
    logger.error('Get recent activity error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to fetch recent activity' });
  }
});

// Post a message to a channel (requires auth)
router.post('/:id/messages', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const channelId = req.params.id;
    const { content, replyToId, images } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Message content is required' });
      return;
    }

    // Verify channel exists and is not read-only
    const [channel] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.id, channelId))
      .limit(1);

    if (!channel || channel.status !== 'active') {
      res.status(404).json({ success: false, error: 'Channel not found' });
      return;
    }

    if (channel.isReadOnly && !authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'This channel is read-only' });
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
        res.status(404).json({ success: false, error: 'Reply target not found' });
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

    res.json({
      success: true,
      data: {
        message: {
          ...message,
          author: {
            id: author.id,
            displayName: author.displayName || author.email?.split('@')[0],
          },
        },
      },
    });
  } catch (error) {
    logger.error('Post message error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to post message' });
  }
});

// Edit a message
router.patch('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const messageId = req.params.id;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Message content is required' });
      return;
    }

    // Get message
    const [message] = await db
      .select()
      .from(channelMessages)
      .where(eq(channelMessages.id, messageId))
      .limit(1);

    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    // Check ownership
    if (message.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
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

    res.json({
      success: true,
      data: { message: updated },
    });
  } catch (error) {
    logger.error('Edit message error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to edit message' });
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
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }

    // Check ownership (or admin)
    if (message.userId !== authReq.user!.id && !authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Soft delete
    await db
      .update(channelMessages)
      .set({ status: 'removed' })
      .where(eq(channelMessages.id, messageId));

    res.json({
      success: true,
      data: { message: 'Message deleted' },
    });
  } catch (error) {
    logger.error('Delete message error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

// Admin: Create a new channel
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const { name, slug, description, gameId, isDefault, isReadOnly, sortOrder } = req.body;

    if (!name || !slug) {
      res.status(400).json({ success: false, error: 'Name and slug are required' });
      return;
    }

    // Check slug uniqueness
    const [existing] = await db
      .select()
      .from(communityChannels)
      .where(eq(communityChannels.slug, slug))
      .limit(1);

    if (existing) {
      res.status(400).json({ success: false, error: 'Channel with this slug already exists' });
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
        res.status(404).json({ success: false, error: 'Game not found' });
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

    res.json({
      success: true,
      data: { channel },
    });
  } catch (error) {
    logger.error('Create channel error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to create channel' });
  }
});

// Admin: Update a channel
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
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
      res.status(404).json({ success: false, error: 'Channel not found' });
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

    res.json({
      success: true,
      data: { channel: updated },
    });
  } catch (error) {
    logger.error('Update channel error', error as Error, { component: 'Channels' });
    res.status(500).json({ success: false, error: 'Failed to update channel' });
  }
});

export default router;
