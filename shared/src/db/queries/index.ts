/**
 * Entity-specific Query Helpers
 *
 * Re-exports all entity query helpers for convenient importing.
 * These helpers reduce code duplication in routes and services.
 *
 * @example
 * import { sessionQueries, collectionQueries, storeQueries, communityQueries } from '@webedt/shared/db/queries';
 *
 * // Or import specific helpers
 * import { findUserSession, listUserSessions } from '@webedt/shared/db/queries/sessions';
 */

// Session helpers - re-export as namespace only to avoid conflicts
export * as sessionQueries from './sessions.js';

// Collection helpers - re-export as namespace only to avoid conflicts
export * as collectionQueries from './collections.js';

// Store helpers - re-export as namespace only to avoid conflicts
export * as storeQueries from './store.js';

// Community helpers - export individual items for convenience (most used)
export * as communityQueries from './community.js';
export {
  // Types
  type PostType,
  type PostWithAuthor,
  type CommentWithAuthor,
  type PostFilterOptions,
  type PostSortField,
  // Helpers
  formatAuthor,
  buildPostConditions,
  // Post queries
  findPostById,
  findUserPost,
  findPublishedPostWithAuthor,
  listPosts,
  listUserPosts,
  getGameReviews,
  // Comment queries
  findCommentById,
  findUserComment,
  getPostComments,
  verifyParentComment,
  // Vote queries
  getUserPostVote,
  getUserCommentVote,
  getUserPostVotes,
  // Ownership & verification
  verifyPostOwnership,
  verifyCommentOwnership,
  // Statistics
  calculateGameReviewStats,
} from './community.js';
