/**
 * Community Query Helpers
 *
 * Composable query utilities for community posts, comments, and votes.
 * Reduces duplication in community routes.
 */

import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, communityPosts, communityComments, communityVotes, users, games } from '../index.js';
import type { CommunityPost, CommunityComment, CommunityVote, User, Game } from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Post type enum
 */
export type PostType = 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement';

/**
 * Post with author info
 */
export interface PostWithAuthor extends CommunityPost {
  author: {
    id: string;
    displayName: string | null;
    email: string | null;
  };
  game?: Game | null;
}

/**
 * Comment with author info
 */
export interface CommentWithAuthor extends CommunityComment {
  author: {
    id: string;
    displayName: string | null;
    email: string | null;
  };
}

/**
 * Post filter options
 */
export interface PostFilterOptions {
  /** Filter by post type */
  type?: PostType;
  /** Filter by game ID */
  gameId?: string;
  /** Filter by user ID (author) */
  userId?: string;
  /** Filter by status (default: published) */
  status?: string;
}

/**
 * Post sort options
 */
export type PostSortField = 'createdAt' | 'updatedAt' | 'upvotes' | 'commentCount';

// =============================================================================
// AUTHOR INFO HELPER
// =============================================================================

/**
 * Format author info for display
 */
export function formatAuthor(user: { id: string; displayName: string | null; email: string | null }): {
  id: string;
  displayName: string;
} {
  return {
    id: user.id,
    displayName: user.displayName || user.email?.split('@')[0] || 'Anonymous',
  };
}

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build conditions for post queries
 */
export function buildPostConditions(options: PostFilterOptions = {}): SQL | undefined {
  const conditions: SQL[] = [];

  // Default to published only
  if (options.status) {
    conditions.push(eq(communityPosts.status, options.status));
  } else {
    conditions.push(eq(communityPosts.status, 'published'));
  }

  if (options.type) {
    conditions.push(eq(communityPosts.type, options.type));
  }

  if (options.gameId) {
    conditions.push(eq(communityPosts.gameId, options.gameId));
  }

  if (options.userId) {
    conditions.push(eq(communityPosts.userId, options.userId));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

// =============================================================================
// POST QUERIES
// =============================================================================

/**
 * Find a post by ID
 */
export async function findPostById(id: string): Promise<CommunityPost | null> {
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.id, id))
    .limit(1);

  return post ?? null;
}

/**
 * Find a post by ID with ownership check
 */
export async function findUserPost(
  id: string,
  userId: string
): Promise<CommunityPost | null> {
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.id, id),
        eq(communityPosts.userId, userId)
      )
    )
    .limit(1);

  return post ?? null;
}

/**
 * Find a published post by ID with author info
 */
export async function findPublishedPostWithAuthor(id: string): Promise<PostWithAuthor | null> {
  const [result] = await db
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
    .where(eq(communityPosts.id, id))
    .limit(1);

  if (!result || result.post.status !== 'published') {
    return null;
  }

  return {
    ...result.post,
    author: result.author,
    game: result.game,
  };
}

/**
 * List posts with author info and optional game info
 */
export async function listPosts(
  options: PostFilterOptions & {
    pagination?: PaginationOptions;
    sort?: { field: PostSortField; order: 'asc' | 'desc' };
  } = {}
): Promise<PaginatedResult<PostWithAuthor>> {
  const { pagination, sort, ...filterOptions } = options;
  const { limit, offset } = getPaginationParams(pagination);
  const conditions = buildPostConditions(filterOptions);

  // Build ORDER BY
  let orderBy: SQL;
  const sortOrder = sort?.order === 'asc' ? asc : desc;
  switch (sort?.field) {
    case 'upvotes':
      orderBy = sortOrder(communityPosts.upvotes);
      break;
    case 'commentCount':
      orderBy = sortOrder(communityPosts.commentCount);
      break;
    case 'updatedAt':
      orderBy = sortOrder(communityPosts.updatedAt);
      break;
    default:
      orderBy = desc(communityPosts.createdAt);
  }

  const results = await db
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
    .where(conditions)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityPosts)
    .where(conditions);

  const total = countResult?.count ?? 0;

  const data = results.map(r => ({
    ...r.post,
    author: r.author,
    game: r.game,
  }));

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List user's posts (for profile page)
 */
export async function listUserPosts(
  userId: string,
  pagination?: PaginationOptions
): Promise<PaginatedResult<PostWithAuthor>> {
  return listPosts({ userId, pagination });
}

/**
 * Get reviews for a game
 */
export async function getGameReviews(
  gameId: string,
  pagination?: PaginationOptions
): Promise<PaginatedResult<PostWithAuthor>> {
  return listPosts({
    gameId,
    type: 'review',
    pagination,
    sort: { field: 'upvotes', order: 'desc' },
  });
}

// =============================================================================
// COMMENT QUERIES
// =============================================================================

/**
 * Find a comment by ID
 */
export async function findCommentById(id: string): Promise<CommunityComment | null> {
  const [comment] = await db
    .select()
    .from(communityComments)
    .where(eq(communityComments.id, id))
    .limit(1);

  return comment ?? null;
}

/**
 * Find a comment by ID with ownership check
 */
export async function findUserComment(
  id: string,
  userId: string
): Promise<CommunityComment | null> {
  const [comment] = await db
    .select()
    .from(communityComments)
    .where(
      and(
        eq(communityComments.id, id),
        eq(communityComments.userId, userId)
      )
    )
    .limit(1);

  return comment ?? null;
}

/**
 * Get comments for a post
 */
export async function getPostComments(
  postId: string,
  options?: { includeRemoved?: boolean }
): Promise<CommentWithAuthor[]> {
  const conditions: SQL[] = [eq(communityComments.postId, postId)];

  if (!options?.includeRemoved) {
    conditions.push(eq(communityComments.status, 'published'));
  }

  const results = await db
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
    .where(and(...conditions))
    .orderBy(asc(communityComments.createdAt));

  return results.map(r => ({
    ...r.comment,
    author: r.author,
  }));
}

/**
 * Verify that a parent comment exists and belongs to the same post
 */
export async function verifyParentComment(
  parentId: string,
  postId: string
): Promise<boolean> {
  const [parent] = await db
    .select({ id: communityComments.id })
    .from(communityComments)
    .where(
      and(
        eq(communityComments.id, parentId),
        eq(communityComments.postId, postId)
      )
    )
    .limit(1);

  return !!parent;
}

// =============================================================================
// VOTE QUERIES
// =============================================================================

/**
 * Get user's vote on a post
 */
export async function getUserPostVote(
  userId: string,
  postId: string
): Promise<CommunityVote | null> {
  const [vote] = await db
    .select()
    .from(communityVotes)
    .where(
      and(
        eq(communityVotes.userId, userId),
        eq(communityVotes.postId, postId)
      )
    )
    .limit(1);

  return vote ?? null;
}

/**
 * Get user's vote on a comment
 */
export async function getUserCommentVote(
  userId: string,
  commentId: string
): Promise<CommunityVote | null> {
  const [vote] = await db
    .select()
    .from(communityVotes)
    .where(
      and(
        eq(communityVotes.userId, userId),
        eq(communityVotes.commentId, commentId)
      )
    )
    .limit(1);

  return vote ?? null;
}

/**
 * Get user's votes for multiple posts (batch operation)
 */
export async function getUserPostVotes(
  userId: string,
  postIds: string[]
): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();

  const votes = await db
    .select({
      postId: communityVotes.postId,
      vote: communityVotes.vote,
    })
    .from(communityVotes)
    .where(
      and(
        eq(communityVotes.userId, userId),
        inArray(communityVotes.postId, postIds)
      )
    );

  const voteMap = new Map<string, number>();
  for (const v of votes) {
    if (v.postId) {
      voteMap.set(v.postId, v.vote);
    }
  }

  return voteMap;
}

// =============================================================================
// OWNERSHIP & VERIFICATION
// =============================================================================

/**
 * Verify post ownership
 */
export async function verifyPostOwnership(
  postId: string,
  userId: string
): Promise<{ exists: boolean; owned: boolean; isAdmin?: boolean }> {
  const [post] = await db
    .select({ userId: communityPosts.userId })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1);

  if (!post) {
    return { exists: false, owned: false };
  }

  return { exists: true, owned: post.userId === userId };
}

/**
 * Verify comment ownership
 */
export async function verifyCommentOwnership(
  commentId: string,
  userId: string
): Promise<{ exists: boolean; owned: boolean }> {
  const [comment] = await db
    .select({ userId: communityComments.userId })
    .from(communityComments)
    .where(eq(communityComments.id, commentId))
    .limit(1);

  if (!comment) {
    return { exists: false, owned: false };
  }

  return { exists: true, owned: comment.userId === userId };
}

// =============================================================================
// STATISTICS HELPERS
// =============================================================================

/**
 * Calculate new review statistics for a game
 */
export async function calculateGameReviewStats(gameId: string): Promise<{
  count: number;
  averageRating: number;
}> {
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

  if (reviews.length === 0) {
    return { count: 0, averageRating: 0 };
  }

  const totalRating = reviews.reduce((sum, r) => sum + (r.rating ?? 0), 0);
  const averageRating = Math.round((totalRating / reviews.length) * 20); // Convert 1-5 to 0-100

  return { count: reviews.length, averageRating };
}
