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

// Organization helpers - re-export as namespace only to avoid conflicts
export * as organizationQueries from './organizations.js';
export {
  // Types
  type OrganizationMemberWithUser,
  type UserOrganization,
  type OrganizationFilterOptions,
  type MemberFilterOptions,
  // Condition builders
  buildOrganizationConditions,
  buildMemberConditions,
  // Single record queries
  findOrganizationById,
  findOrganizationBySlug,
  findMember,
  findInvitationByToken,
  findInvitationById,
  // List queries
  listOrganizations,
  listUserOrganizations,
  listOrganizationMembers,
  listOrganizationRepositories,
  listPendingInvitations,
  // Count queries
  countOrganizationMembers,
  countOrganizationRepositories,
  // Existence checks
  isSlugAvailable,
  isMember,
  isRepositoryAdded,
  // Permission helpers
  hasPermission,
  verifyMembership,
  // Invitation helpers
  isInvitationValid,
  invitationExistsForEmail,
} from './organizations.js';

// Payment helpers - re-export as namespace only to avoid conflicts
export * as paymentQueries from './payments.js';
export {
  // Types
  type TransactionStatus,
  type PaymentProvider,
  type TransactionWithGame,
  type TransactionFilterOptions,
  type WebhookFilterOptions,
  // Condition builders
  buildTransactionConditions,
  buildWebhookConditions,
  // Single record queries
  findTransactionById,
  findUserTransaction,
  findTransactionBySessionId,
  findTransactionByProviderId,
  findWebhookByEventId,
  // List queries
  listTransactions,
  listUserTransactions,
  listUnprocessedWebhooks,
  // Count queries
  countUserTransactions,
  countTransactionsByStatus,
  // Ownership & validation
  userOwnsGame,
  findPublishedGame,
  isRefundEligible,
  // Purchase helpers
  findPurchaseById,
  findUserPurchase,
  listUserPurchases,
  // Analytics
  getRevenueStats,
} from './payments.js';

// User helpers - re-export as namespace only to avoid conflicts
export * as userQueries from './users.js';
export {
  // Types
  type UserInfo,
  type AdminUserInfo,
  type UserFilterOptions,
  // Field sets
  userInfoFields,
  adminUserInfoFields,
  // Condition builders
  buildUserConditions,
  // Single record queries
  findUserById,
  findUserByEmail,
  findUserByGithubId,
  getUserInfo,
  getAdminUserInfo,
  // List queries
  listUsers,
  listAdminUsers,
  // Count queries
  countUsers,
  countAdminUsers,
  // Existence checks
  userExists,
  emailExists,
  githubIdExists,
  // Session queries
  countUserSessions,
  listUserSessions,
  countAllSessions,
  // Admin helpers
  getAdminStats,
  validateUserOwnership,
  findUsersByIds,
  getUserInfoMap,
} from './users.js';

// Event helpers - re-export as namespace only to avoid conflicts
export * as eventQueries from './events.js';
export {
  // Types
  type ParsedEvent,
  type EventFilterOptions,
  type EventReplayOptions,
  // Condition builders
  buildEventConditions,
  // Single record queries
  findEventById,
  findEventByUuid,
  getLastEvent,
  getLastEventId,
  // List queries
  listEvents,
  listSessionEvents,
  getEventsForReplay,
  // Count queries
  countSessionEvents,
  countEventsByType,
  // Existence checks
  eventUuidExists,
  sessionHasEvents,
  // Session validation
  verifySession,
  verifyUserSession,
  // Bulk operations helpers
  getSessionEventIds,
  getSessionEventTimeRange,
} from './events.js';

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
