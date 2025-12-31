/**
 * User Entity Loader
 *
 * Provides batch loading capabilities for users, preventing N+1 query problems
 * when fetching user information across multiple entities.
 */

import { inArray } from 'drizzle-orm';
import { db, users } from '../index.js';
import { DataLoader, createResultMap } from '../dataLoader.js';

import type { User } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * User info type for display purposes (excludes sensitive fields)
 */
export interface UserInfo {
  id: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: Date;
}

/**
 * Minimal author info for embedding in other entities
 */
export interface AuthorInfo {
  id: string;
  displayName: string;
}

/**
 * Create a DataLoader for batch loading users by ID
 *
 * **SECURITY WARNING**: This loader returns full User objects including sensitive
 * fields (passwordHash, githubAccessToken, claudeAuth, codexAuth, geminiAuth, etc.).
 * Only use this for internal operations that require full user data.
 *
 * For public/display purposes, prefer:
 * - `createUserInfoLoader()` - safe subset of user fields
 * - `createAuthorInfoLoader()` - minimal author display info
 *
 * @example
 * const userLoader = createUserLoader();
 * const [user1, user2] = await Promise.all([
 *   userLoader.load('user-id-1'),
 *   userLoader.load('user-id-2'),
 * ]);
 */
export function createUserLoader(options?: DataLoaderOptions): DataLoader<string, User> {
  return new DataLoader<string, User>(
    async (userIds: string[]) => {
      const results = await db
        .select()
        .from(users)
        .where(inArray(users.id, userIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading user info (safe for public display)
 *
 * @example
 * const userInfoLoader = createUserInfoLoader();
 * const authors = await userInfoLoader.loadMany(authorIds);
 */
export function createUserInfoLoader(options?: DataLoaderOptions): DataLoader<string, UserInfo> {
  return new DataLoader<string, UserInfo>(
    async (userIds: string[]) => {
      const results = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isAdmin: users.isAdmin,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(inArray(users.id, userIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Format user info into display-safe author info
 */
export function formatAuthorInfo(user: UserInfo | User | null): AuthorInfo | null {
  if (!user) return null;

  return {
    id: user.id,
    displayName: user.displayName || (user.email?.split('@')[0] ?? 'Anonymous'),
  };
}

/**
 * Batch load users and format as author info
 *
 * @example
 * const authorLoader = createAuthorInfoLoader();
 * const [author1, author2] = await Promise.all([
 *   authorLoader.load('user-id-1'),
 *   authorLoader.load('user-id-2'),
 * ]);
 */
export function createAuthorInfoLoader(options?: DataLoaderOptions): DataLoader<string, AuthorInfo> {
  return new DataLoader<string, AuthorInfo>(
    async (userIds: string[]) => {
      const results = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(inArray(users.id, userIds));

      const map = new Map<string, AuthorInfo>();
      for (const user of results) {
        map.set(user.id, {
          id: user.id,
          displayName: user.displayName || (user.email?.split('@')[0] ?? 'Anonymous'),
        });
      }
      return map;
    },
    options
  );
}
