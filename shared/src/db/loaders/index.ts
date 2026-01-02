/**
 * Entity Loaders Index
 *
 * Pre-built DataLoader factories for common entities.
 * These prevent N+1 query problems by batching individual lookups
 * into bulk queries.
 *
 * Usage:
 * 1. Create loaders at the start of a request using factory functions
 * 2. Use loader.load(id) instead of direct database queries
 * 3. All loads in the same tick are automatically batched
 *
 * @example
 * // Create loaders per request
 * const userLoader = createUserLoader();
 * const sessionLoader = createSessionLoader();
 *
 * // Load multiple entities - these are batched into 1 query each
 * const [user1, user2, user3] = await Promise.all([
 *   userLoader.load(userId1),
 *   userLoader.load(userId2),
 *   userLoader.load(userId3),
 * ]);
 */

// User loaders
export {
  createUserLoader,
  createUserInfoLoader,
  createAuthorInfoLoader,
  formatAuthorInfo,
} from './userLoader.js';

export type {
  UserInfo,
  AuthorInfo,
} from './userLoader.js';

// Session loaders
export {
  createSessionLoader,
  createActiveSessionLoader,
  createSessionSummaryLoader,
  createUserSessionsLoader,
} from './sessionLoader.js';

export type {
  SessionSummary,
} from './sessionLoader.js';

// Game/Store loaders
export {
  createGameLoader,
  createPublishedGameLoader,
  createGameSummaryLoader,
  createGameOwnershipLoader,
  createUserLibraryGamesLoader,
  createUserWishlistGamesLoader,
} from './gameLoader.js';

export type {
  GameSummary,
  GameOwnership,
} from './gameLoader.js';

// Organization loaders
export {
  createOrganizationLoader,
  createOrganizationBySlugLoader,
  createUserOrganizationsLoader,
  createOrganizationMembersLoader,
  createOrganizationMembershipLoader,
  createOrganizationRepositoriesLoader,
  createOrganizationMemberCountLoader,
} from './organizationLoader.js';

export type {
  OrganizationWithRole,
  MemberWithUser,
} from './organizationLoader.js';

// Collection loaders
export {
  createCollectionLoader,
  createUserCollectionsLoader,
  createCollectionSessionCountLoader,
  createSessionCollectionsLoader,
  createCollectionSessionsLoader,
  createSessionInCollectionLoader,
} from './collectionLoader.js';

export type {
  CollectionWithCount,
  SessionCollectionInfo,
} from './collectionLoader.js';

// Event loaders
export {
  createEventSummaryLoader,
  createEventCountLoader,
  createLatestEventsLoader,
  createEventsByTypeLoader,
  createToolUseEventsLoader,
  createErrorEventsLoader,
  createAssistantEventsLoader,
} from './eventLoader.js';

export type {
  EventSummary,
  EventTypeCount,
} from './eventLoader.js';

// Re-export core DataLoader utilities for convenience
export {
  DataLoader,
  BatchContext,
  createResultMap,
  createResultMapBy,
  groupBy,
  groupByFn,
  coalesceQueries,
} from '../dataLoader.js';

export type {
  DataLoaderOptions,
} from '../dataLoader.js';
