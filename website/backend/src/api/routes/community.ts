/**
 * Community Routes
 * Handles discussions, reviews, guides, and community participation
 */

import { Router, Request, Response } from 'express';
import {
  db,
  games,
  users,
  communityPosts,
  communityComments,
  communityVotes,
  eq,
  and,
  desc,
  asc,
  sql,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get community posts (public)
router.get('/posts', async (req: Request, res: Response) => {
  try {
    const { type, gameId, sort = 'createdAt', order = 'desc' } = req.query;

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Build base query conditions
    const conditions = [eq(communityPosts.status, 'published')];

    if (type) {
      conditions.push(eq(communityPosts.type, type as string));
    }

    if (gameId) {
      conditions.push(eq(communityPosts.gameId, gameId as string));
    }

    // Determine sort column based on sort parameter
    let orderByClause;
    switch (sort) {
      case 'upvotes':
        orderByClause = order === 'asc'
          ? asc(communityPosts.upvotes)
          : desc(communityPosts.upvotes);
        break;
      case 'comments':
        orderByClause = order === 'asc'
          ? asc(communityPosts.commentCount)
          : desc(communityPosts.commentCount);
        break;
      case 'createdAt':
      default:
        orderByClause = order === 'asc'
          ? asc(communityPosts.createdAt)
          : desc(communityPosts.createdAt);
        break;
    }

    // Get posts with author info
    const posts = await db
      .select({
        post: communityPosts,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
        game: games,
      })
      .from(communityPosts)
      .innerJoin(users, eq(communityPosts.userId, users.id))
      .leftJoin(games, eq(communityPosts.gameId, games.id))
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Get total count using SQL COUNT for efficiency
    const countResult = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(communityPosts)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;

    res.json({
      success: true,
      data: {
        posts: posts.map((p) => ({
          ...p.post,
          author: {
            id: p.author.id,
            displayName: p.author.displayName || p.author.email?.split('@')[0],
          },
          game: p.game,
        })),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Get community posts error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

// Get single post with comments
router.get('/posts/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    const [post] = await db
      .select({
        post: communityPosts,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
        game: games,
      })
      .from(communityPosts)
      .innerJoin(users, eq(communityPosts.userId, users.id))
      .leftJoin(games, eq(communityPosts.gameId, games.id))
      .where(eq(communityPosts.id, postId))
      .limit(1);

    if (!post || post.post.status !== 'published') {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Get comments
    const comments = await db
      .select({
        comment: communityComments,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(communityComments)
      .innerJoin(users, eq(communityComments.userId, users.id))
      .where(
        and(
          eq(communityComments.postId, postId),
          eq(communityComments.status, 'published')
        )
      )
      .orderBy(asc(communityComments.createdAt));

    res.json({
      success: true,
      data: {
        ...post.post,
        author: {
          id: post.author.id,
          displayName: post.author.displayName || post.author.email?.split('@')[0],
        },
        game: post.game,
        comments: comments.map((c) => ({
          ...c.comment,
          author: {
            id: c.author.id,
            displayName: c.author.displayName || c.author.email?.split('@')[0],
          },
        })),
      },
    });
  } catch (error) {
    logger.error('Get post error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

// Create a post (requires auth)
router.post('/posts', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { type, title, content, gameId, rating, images } = req.body;

    // Validate required fields
    if (!type || !title || !content) {
      res.status(400).json({
        success: false,
        error: 'Type, title, and content are required',
      });
      return;
    }

    // Validate type
    const validTypes = ['discussion', 'review', 'guide', 'artwork', 'announcement'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ success: false, error: 'Invalid post type' });
      return;
    }

    // Announcements require admin privileges
    if (type === 'announcement' && !authReq.user!.isAdmin) {
      res.status(403).json({
        success: false,
        error: 'Only administrators can create announcements',
      });
      return;
    }

    // Validate rating for reviews
    if (type === 'review') {
      if (!rating || rating < 1 || rating > 5) {
        res.status(400).json({
          success: false,
          error: 'Reviews require a rating between 1 and 5',
        });
        return;
      }
    }

    // Verify game exists if gameId provided
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

    // Create post
    const [post] = await db
      .insert(communityPosts)
      .values({
        id: uuidv4(),
        userId: authReq.user!.id,
        gameId: gameId || null,
        type,
        title,
        content,
        rating: type === 'review' ? rating : null,
        images: images || [],
        status: 'published',
      })
      .returning();

    // Update game review count and average if this is a review
    if (type === 'review' && gameId) {
      const reviews = await db
        .select({ rating: communityPosts.rating })
        .from(communityPosts)
        .where(
          and(
            eq(communityPosts.gameId, gameId),
            eq(communityPosts.type, 'review'),
            eq(communityPosts.status, 'published')
          )
        );

      const totalRating = reviews.reduce((sum, r) => sum + (r.rating || 0), 0);
      const avgRating = Math.round((totalRating / reviews.length) * 20); // Convert 1-5 to 0-100

      await db
        .update(games)
        .set({
          reviewCount: reviews.length,
          averageScore: avgRating,
        })
        .where(eq(games.id, gameId));
    }

    logger.info(`User ${authReq.user!.id} created post ${post.id}`, {
      component: 'Community',
      type,
      gameId,
    });

    res.json({
      success: true,
      data: { post },
    });
  } catch (error) {
    logger.error('Create post error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to create post' });
  }
});

// Update a post
router.patch('/posts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const postId = req.params.id;
    const { title, content, images } = req.body;

    // Get post
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, postId))
      .limit(1);

    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Check ownership
    if (post.userId !== authReq.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Update post
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (images) updateData.images = images;

    const [updated] = await db
      .update(communityPosts)
      .set(updateData)
      .where(eq(communityPosts.id, postId))
      .returning();

    res.json({
      success: true,
      data: { post: updated },
    });
  } catch (error) {
    logger.error('Update post error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to update post' });
  }
});

// Delete a post
router.delete('/posts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const postId = req.params.id;

    // Get post
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, postId))
      .limit(1);

    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Check ownership (or admin)
    if (post.userId !== authReq.user!.id && !authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Soft delete
    await db
      .update(communityPosts)
      .set({ status: 'removed' })
      .where(eq(communityPosts.id, postId));

    res.json({
      success: true,
      data: { message: 'Post deleted' },
    });
  } catch (error) {
    logger.error('Delete post error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to delete post' });
  }
});

// Add a comment
router.post('/posts/:id/comments', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const postId = req.params.id;
    const { content, parentId } = req.body;

    if (!content) {
      res.status(400).json({ success: false, error: 'Content is required' });
      return;
    }

    // Verify post exists and is not locked
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, postId))
      .limit(1);

    if (!post || post.status !== 'published') {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    if (post.locked) {
      res.status(400).json({ success: false, error: 'Post is locked' });
      return;
    }

    // Verify parent comment exists if provided
    if (parentId) {
      const [parent] = await db
        .select()
        .from(communityComments)
        .where(
          and(
            eq(communityComments.id, parentId),
            eq(communityComments.postId, postId)
          )
        )
        .limit(1);

      if (!parent) {
        res.status(404).json({ success: false, error: 'Parent comment not found' });
        return;
      }
    }

    // Create comment
    const [comment] = await db
      .insert(communityComments)
      .values({
        id: uuidv4(),
        postId,
        userId: authReq.user!.id,
        parentId: parentId || null,
        content,
        status: 'published',
      })
      .returning();

    // Update post comment count
    await db
      .update(communityPosts)
      .set({ commentCount: post.commentCount + 1 })
      .where(eq(communityPosts.id, postId));

    res.json({
      success: true,
      data: { comment },
    });
  } catch (error) {
    logger.error('Add comment error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to add comment' });
  }
});

// Delete a comment
router.delete('/comments/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const commentId = req.params.id;

    // Get comment
    const [comment] = await db
      .select()
      .from(communityComments)
      .where(eq(communityComments.id, commentId))
      .limit(1);

    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    // Check ownership (or admin)
    if (comment.userId !== authReq.user!.id && !authReq.user!.isAdmin) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    // Soft delete
    await db
      .update(communityComments)
      .set({ status: 'removed' })
      .where(eq(communityComments.id, commentId));

    // Update post comment count
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, comment.postId))
      .limit(1);

    if (post) {
      await db
        .update(communityPosts)
        .set({ commentCount: Math.max(0, post.commentCount - 1) })
        .where(eq(communityPosts.id, comment.postId));
    }

    res.json({
      success: true,
      data: { message: 'Comment deleted' },
    });
  } catch (error) {
    logger.error('Delete comment error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to delete comment' });
  }
});

// Vote on a post
router.post('/posts/:id/vote', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const postId = req.params.id;
    const { vote } = req.body; // 1 for upvote, -1 for downvote, 0 to remove

    if (![1, -1, 0].includes(vote)) {
      res.status(400).json({ success: false, error: 'Invalid vote value' });
      return;
    }

    // Verify post exists
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, postId))
      .limit(1);

    if (!post || post.status !== 'published') {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Check existing vote
    const [existingVote] = await db
      .select()
      .from(communityVotes)
      .where(
        and(
          eq(communityVotes.userId, authReq.user!.id),
          eq(communityVotes.postId, postId)
        )
      )
      .limit(1);

    let upvoteChange = 0;
    let downvoteChange = 0;

    if (existingVote) {
      if (vote === 0) {
        // Remove vote
        await db
          .delete(communityVotes)
          .where(eq(communityVotes.id, existingVote.id));

        if (existingVote.vote === 1) upvoteChange = -1;
        if (existingVote.vote === -1) downvoteChange = -1;
      } else if (vote !== existingVote.vote) {
        // Change vote
        await db
          .update(communityVotes)
          .set({ vote })
          .where(eq(communityVotes.id, existingVote.id));

        if (existingVote.vote === 1) upvoteChange = -1;
        if (existingVote.vote === -1) downvoteChange = -1;
        if (vote === 1) upvoteChange += 1;
        if (vote === -1) downvoteChange += 1;
      }
      // If same vote, do nothing
    } else if (vote !== 0) {
      // New vote
      await db.insert(communityVotes).values({
        id: uuidv4(),
        userId: authReq.user!.id,
        postId,
        vote,
      });

      if (vote === 1) upvoteChange = 1;
      if (vote === -1) downvoteChange = 1;
    }

    // Update post vote counts atomically to prevent race conditions
    let updatedPost = post;
    if (upvoteChange !== 0 || downvoteChange !== 0) {
      const [result] = await db
        .update(communityPosts)
        .set({
          upvotes: sql`${communityPosts.upvotes} + ${upvoteChange}`,
          downvotes: sql`${communityPosts.downvotes} + ${downvoteChange}`,
        })
        .where(eq(communityPosts.id, postId))
        .returning({ upvotes: communityPosts.upvotes, downvotes: communityPosts.downvotes });

      if (result) {
        updatedPost = { ...post, upvotes: result.upvotes, downvotes: result.downvotes };
      }
    }

    res.json({
      success: true,
      data: {
        upvotes: updatedPost.upvotes,
        downvotes: updatedPost.downvotes,
        userVote: vote,
      },
    });
  } catch (error) {
    logger.error('Vote error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to vote' });
  }
});

// Vote on a comment
router.post('/comments/:id/vote', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const commentId = req.params.id;
    const { vote } = req.body;

    if (![1, -1, 0].includes(vote)) {
      res.status(400).json({ success: false, error: 'Invalid vote value' });
      return;
    }

    // Verify comment exists
    const [comment] = await db
      .select()
      .from(communityComments)
      .where(eq(communityComments.id, commentId))
      .limit(1);

    if (!comment || comment.status !== 'published') {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    // Check existing vote
    const [existingVote] = await db
      .select()
      .from(communityVotes)
      .where(
        and(
          eq(communityVotes.userId, authReq.user!.id),
          eq(communityVotes.commentId, commentId)
        )
      )
      .limit(1);

    let upvoteChange = 0;
    let downvoteChange = 0;

    if (existingVote) {
      if (vote === 0) {
        await db
          .delete(communityVotes)
          .where(eq(communityVotes.id, existingVote.id));

        if (existingVote.vote === 1) upvoteChange = -1;
        if (existingVote.vote === -1) downvoteChange = -1;
      } else if (vote !== existingVote.vote) {
        await db
          .update(communityVotes)
          .set({ vote })
          .where(eq(communityVotes.id, existingVote.id));

        if (existingVote.vote === 1) upvoteChange = -1;
        if (existingVote.vote === -1) downvoteChange = -1;
        if (vote === 1) upvoteChange += 1;
        if (vote === -1) downvoteChange += 1;
      }
    } else if (vote !== 0) {
      await db.insert(communityVotes).values({
        id: uuidv4(),
        userId: authReq.user!.id,
        commentId,
        vote,
      });

      if (vote === 1) upvoteChange = 1;
      if (vote === -1) downvoteChange = 1;
    }

    // Update comment vote counts atomically to prevent race conditions
    let updatedComment = comment;
    if (upvoteChange !== 0 || downvoteChange !== 0) {
      const [result] = await db
        .update(communityComments)
        .set({
          upvotes: sql`${communityComments.upvotes} + ${upvoteChange}`,
          downvotes: sql`${communityComments.downvotes} + ${downvoteChange}`,
        })
        .where(eq(communityComments.id, commentId))
        .returning({ upvotes: communityComments.upvotes, downvotes: communityComments.downvotes });

      if (result) {
        updatedComment = { ...comment, upvotes: result.upvotes, downvotes: result.downvotes };
      }
    }

    res.json({
      success: true,
      data: {
        upvotes: updatedComment.upvotes,
        downvotes: updatedComment.downvotes,
        userVote: vote,
      },
    });
  } catch (error) {
    logger.error('Comment vote error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to vote' });
  }
});

// Get user's posts
router.get('/users/:userId/posts', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const posts = await db
      .select({
        post: communityPosts,
        game: games,
      })
      .from(communityPosts)
      .leftJoin(games, eq(communityPosts.gameId, games.id))
      .where(
        and(
          eq(communityPosts.userId, userId),
          eq(communityPosts.status, 'published')
        )
      )
      .orderBy(desc(communityPosts.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: {
        posts: posts.map((p) => ({
          ...p.post,
          game: p.game,
        })),
      },
    });
  } catch (error) {
    logger.error('Get user posts error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch user posts' });
  }
});

// Get reviews for a game
router.get('/games/:gameId/reviews', async (req: Request, res: Response) => {
  try {
    const gameId = req.params.gameId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const reviews = await db
      .select({
        post: communityPosts,
        author: {
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        },
      })
      .from(communityPosts)
      .innerJoin(users, eq(communityPosts.userId, users.id))
      .where(
        and(
          eq(communityPosts.gameId, gameId),
          eq(communityPosts.type, 'review'),
          eq(communityPosts.status, 'published')
        )
      )
      .orderBy(desc(communityPosts.upvotes))
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: {
        reviews: reviews.map((r) => ({
          ...r.post,
          author: {
            id: r.author.id,
            displayName: r.author.displayName || r.author.email?.split('@')[0],
          },
        })),
      },
    });
  } catch (error) {
    logger.error('Get game reviews error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});

export default router;
