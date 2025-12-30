/**
 * Community Routes
 * Handles discussions, reviews, guides, and community participation
 */

import { Router, Request, Response } from 'express';
import {
  db,
  games,
  communityPosts,
  communityComments,
  communityVotes,
  eq,
  and,
  // Query helpers
  getPaginationParams,
  // Community query helpers
  listPosts,
  findPublishedPostWithAuthor,
  findPostById,
  findCommentById,
  getPostComments,
  getUserPostVote,
  getUserCommentVote,
  verifyParentComment,
  calculateGameReviewStats,
  formatAuthor,
  type PostType,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Community
 *     description: Community discussions, reviews, and participation
 */

/**
 * @openapi
 * /api/community/posts:
 *   get:
 *     tags: [Community]
 *     summary: Get community posts
 *     description: Retrieve published community posts with pagination and filtering
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [discussion, review, guide, artwork, announcement]
 *         description: Filter by post type
 *       - in: query
 *         name: gameId
 *         schema:
 *           type: string
 *         description: Filter by game ID
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of posts to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of posts to skip
 *     responses:
 *       200:
 *         description: Posts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     posts:
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
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get community posts (public)
router.get('/posts', async (req: Request, res: Response) => {
  try {
    const { type, gameId, sort = 'createdAt', order = 'desc' } = req.query;
    const { limit, offset } = getPaginationParams({
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    });

    // Use community query helper
    const result = await listPosts({
      type: type as PostType | undefined,
      gameId: gameId as string | undefined,
      pagination: { limit, offset },
      sort: {
        field: (sort as 'createdAt' | 'upvotes' | 'commentCount') || 'createdAt',
        order: (order as 'asc' | 'desc') || 'desc',
      },
    });

    res.json({
      success: true,
      data: {
        posts: result.data.map((post) => ({
          ...post,
          author: formatAuthor(post.author),
        })),
        total: result.meta.total,
        limit: result.meta.limit,
        offset: result.meta.offset,
        hasMore: result.meta.hasMore,
      },
    });
  } catch (error) {
    logger.error('Get community posts error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch posts' });
  }
});

/**
 * @openapi
 * /api/community/posts/{id}:
 *   get:
 *     tags: [Community]
 *     summary: Get single post with comments
 *     description: Retrieve a single post with its comments
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *     responses:
 *       200:
 *         description: Post retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     title:
 *                       type: string
 *                     content:
 *                       type: string
 *                     type:
 *                       type: string
 *                     author:
 *                       type: object
 *                     game:
 *                       type: object
 *                     comments:
 *                       type: array
 *                       items:
 *                         type: object
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get single post with comments
router.get('/posts/:id', async (req: Request, res: Response) => {
  try {
    const postId = req.params.id;

    // Use query helper to get post with author and game
    const post = await findPublishedPostWithAuthor(postId);

    if (!post) {
      res.status(404).json({ success: false, error: 'Post not found' });
      return;
    }

    // Use query helper to get comments with authors
    const comments = await getPostComments(postId);

    res.json({
      success: true,
      data: {
        ...post,
        author: formatAuthor(post.author),
        comments: comments.map((c) => ({
          ...c,
          author: formatAuthor(c.author),
        })),
      },
    });
  } catch (error) {
    logger.error('Get post error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch post' });
  }
});

/**
 * @openapi
 * /api/community/posts:
 *   post:
 *     tags: [Community]
 *     summary: Create a post
 *     description: Create a new community post (requires authentication)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - title
 *               - content
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [discussion, review, guide, artwork, announcement]
 *                 description: Post type
 *               title:
 *                 type: string
 *                 description: Post title
 *               content:
 *                 type: string
 *                 description: Post content
 *               gameId:
 *                 type: string
 *                 description: Associated game ID (optional)
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Rating (required for reviews)
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Image URLs (optional)
 *     responses:
 *       200:
 *         description: Post created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     post:
 *                       type: object
 *       400:
 *         description: Bad request - invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /api/community/posts/{id}:
 *   patch:
 *     tags: [Community]
 *     summary: Update a post
 *     description: Update an existing post (requires authentication and ownership)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Updated post title
 *               content:
 *                 type: string
 *                 description: Updated post content
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Updated image URLs
 *     responses:
 *       200:
 *         description: Post updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     post:
 *                       type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Access denied - not post owner
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /api/community/posts/{id}:
 *   delete:
 *     tags: [Community]
 *     summary: Delete a post
 *     description: Delete a post (requires authentication and ownership or admin)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *     responses:
 *       200:
 *         description: Post deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Access denied - not post owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /api/community/posts/{id}/comments:
 *   post:
 *     tags: [Community]
 *     summary: Add a comment
 *     description: Add a comment to a post (requires authentication)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Comment content
 *               parentId:
 *                 type: string
 *                 description: Parent comment ID for nested replies
 *     responses:
 *       200:
 *         description: Comment added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     comment:
 *                       type: object
 *       400:
 *         description: Bad request - content required or post locked
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /api/community/comments/{id}:
 *   delete:
 *     tags: [Community]
 *     summary: Delete a comment
 *     description: Delete a comment (requires authentication and ownership or admin)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *     responses:
 *       200:
 *         description: Comment deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Access denied - not comment owner or admin
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /api/community/posts/{id}/vote:
 *   post:
 *     tags: [Community]
 *     summary: Vote on a post
 *     description: Upvote, downvote, or remove vote from a post (requires authentication)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vote
 *             properties:
 *               vote:
 *                 type: integer
 *                 enum: [1, -1, 0]
 *                 description: Vote value (1=upvote, -1=downvote, 0=remove)
 *     responses:
 *       200:
 *         description: Vote recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     upvotes:
 *                       type: integer
 *                     downvotes:
 *                       type: integer
 *                     userVote:
 *                       type: integer
 *       400:
 *         description: Bad request - invalid vote value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

    // Update post vote counts
    if (upvoteChange !== 0 || downvoteChange !== 0) {
      await db
        .update(communityPosts)
        .set({
          upvotes: post.upvotes + upvoteChange,
          downvotes: post.downvotes + downvoteChange,
        })
        .where(eq(communityPosts.id, postId));
    }

    res.json({
      success: true,
      data: {
        upvotes: post.upvotes + upvoteChange,
        downvotes: post.downvotes + downvoteChange,
        userVote: vote,
      },
    });
  } catch (error) {
    logger.error('Vote error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to vote' });
  }
});

/**
 * @openapi
 * /api/community/comments/{id}/vote:
 *   post:
 *     tags: [Community]
 *     summary: Vote on a comment
 *     description: Upvote, downvote, or remove vote from a comment (requires authentication)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vote
 *             properties:
 *               vote:
 *                 type: integer
 *                 enum: [1, -1, 0]
 *                 description: Vote value (1=upvote, -1=downvote, 0=remove)
 *     responses:
 *       200:
 *         description: Vote recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     upvotes:
 *                       type: integer
 *                     downvotes:
 *                       type: integer
 *                     userVote:
 *                       type: integer
 *       400:
 *         description: Bad request - invalid vote value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

    // Update comment vote counts
    if (upvoteChange !== 0 || downvoteChange !== 0) {
      await db
        .update(communityComments)
        .set({
          upvotes: comment.upvotes + upvoteChange,
          downvotes: comment.downvotes + downvoteChange,
        })
        .where(eq(communityComments.id, commentId));
    }

    res.json({
      success: true,
      data: {
        upvotes: comment.upvotes + upvoteChange,
        downvotes: comment.downvotes + downvoteChange,
        userVote: vote,
      },
    });
  } catch (error) {
    logger.error('Comment vote error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to vote' });
  }
});

/**
 * @openapi
 * /api/community/users/{userId}/posts:
 *   get:
 *     tags: [Community]
 *     summary: Get user's posts
 *     description: Retrieve all published posts by a specific user
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of posts to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of posts to skip
 *     responses:
 *       200:
 *         description: User posts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     posts:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get user's posts
router.get('/users/:userId/posts', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const { limit, offset } = getPaginationParams({
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    });

    // Use community query helper
    const result = await listPosts({
      userId,
      pagination: { limit, offset },
    });

    res.json({
      success: true,
      data: {
        posts: result.data.map((post) => ({
          ...post,
          author: formatAuthor(post.author),
        })),
        total: result.meta.total,
        limit: result.meta.limit,
        offset: result.meta.offset,
        hasMore: result.meta.hasMore,
      },
    });
  } catch (error) {
    logger.error('Get user posts error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch user posts' });
  }
});

/**
 * @openapi
 * /api/community/games/{gameId}/reviews:
 *   get:
 *     tags: [Community]
 *     summary: Get reviews for a game
 *     description: Retrieve all published reviews for a specific game
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *         description: Game ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *         description: Number of reviews to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of reviews to skip
 *     responses:
 *       200:
 *         description: Game reviews retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     reviews:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           content:
 *                             type: string
 *                           rating:
 *                             type: integer
 *                           author:
 *                             type: object
 *                           upvotes:
 *                             type: integer
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get reviews for a game
router.get('/games/:gameId/reviews', async (req: Request, res: Response) => {
  try {
    const gameId = req.params.gameId;
    const { limit, offset } = getPaginationParams({
      limit: parseInt(req.query.limit as string) || 20,
      offset: parseInt(req.query.offset as string) || 0,
    });

    // Use community query helper for game reviews
    const result = await listPosts({
      gameId,
      type: 'review',
      pagination: { limit, offset },
      sort: { field: 'upvotes', order: 'desc' },
    });

    res.json({
      success: true,
      data: {
        reviews: result.data.map((review) => ({
          ...review,
          author: formatAuthor(review.author),
        })),
        total: result.meta.total,
        limit: result.meta.limit,
        offset: result.meta.offset,
        hasMore: result.meta.hasMore,
      },
    });
  } catch (error) {
    logger.error('Get game reviews error', error as Error, { component: 'Community' });
    res.status(500).json({ success: false, error: 'Failed to fetch reviews' });
  }
});

export default router;
