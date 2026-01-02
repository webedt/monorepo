/**
 * User Query Helpers
 *
 * Composable query utilities for user operations.
 * Reduces duplication in auth/admin routes.
 */

import { eq, desc, sql, ilike, or, and, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, users, sessions } from '../index.js';
import type { User, Session } from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  combineConditions,
  buildTimeRangeConditions,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * User info for display (excludes sensitive fields)
 */
export interface UserInfo {
  id: string;
  email: string;
  displayName: string | null;
  githubId: string | null;
  isAdmin: boolean;
  createdAt: Date;
}

/**
 * User info for admin views (includes more fields)
 */
export interface AdminUserInfo extends UserInfo {
  githubAccessToken: string | null;
  claudeAuth: unknown | null;
  imageResizeMaxDimension: number | null;
  voiceCommandKeywords: string[] | null;
}

/**
 * User filter options
 */
export interface UserFilterOptions {
  /** Filter by admin status */
  isAdmin?: boolean;
  /** Filter by GitHub linked status */
  hasGithub?: boolean;
  /** Search by email or display name */
  search?: string;
  /** Filter by creation date range */
  createdAfter?: Date;
  createdBefore?: Date;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Escape special characters in LIKE patterns to prevent SQL injection
 * Escapes: % (wildcard), _ (single char), \ (escape char)
 */
function escapeLikePattern(pattern: string): string {
  return pattern.replace(/[%_\\]/g, '\\$&');
}

// =============================================================================
// SELECT FIELD SETS
// =============================================================================

/**
 * Standard user fields for display (excludes password hash and sensitive data)
 */
export const userInfoFields = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  githubId: users.githubId,
  isAdmin: users.isAdmin,
  createdAt: users.createdAt,
};

/**
 * Extended user fields for admin views
 */
export const adminUserInfoFields = {
  ...userInfoFields,
  githubAccessToken: users.githubAccessToken,
  claudeAuth: users.claudeAuth,
  imageResizeMaxDimension: users.imageResizeMaxDimension,
  voiceCommandKeywords: users.voiceCommandKeywords,
};

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build WHERE conditions for user queries
 */
export function buildUserConditions(
  options: UserFilterOptions
): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.isAdmin !== undefined) {
    conditions.push(eq(users.isAdmin, options.isAdmin));
  }

  if (options.hasGithub !== undefined) {
    if (options.hasGithub) {
      conditions.push(sql`${users.githubId} IS NOT NULL`);
    } else {
      conditions.push(sql`${users.githubId} IS NULL`);
    }
  }

  if (options.search) {
    const searchPattern = `%${escapeLikePattern(options.search)}%`;
    conditions.push(
      or(
        ilike(users.email, searchPattern),
        ilike(users.displayName, searchPattern)
      )!
    );
  }

  if (options.createdAfter || options.createdBefore) {
    const timeConditions = buildTimeRangeConditions(users.createdAt, {
      start: options.createdAfter,
      end: options.createdBefore,
    });
    conditions.push(...timeConditions);
  }

  return combineConditions(...conditions);
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find a user by ID
 */
export async function findUserById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);

  return user ?? null;
}

/**
 * Find a user by email
 * Note: Emails are normalized to lowercase on storage, so input is lowercased before comparison.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return user ?? null;
}

/**
 * Find a user by GitHub ID
 */
export async function findUserByGithubId(githubId: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);

  return user ?? null;
}

/**
 * Get user info (display fields only) by ID
 */
export async function getUserInfo(id: string): Promise<UserInfo | null> {
  const [user] = await db
    .select(userInfoFields)
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

/**
 * Get admin user info by ID
 */
export async function getAdminUserInfo(id: string): Promise<AdminUserInfo | null> {
  const [user] = await db
    .select(adminUserInfoFields)
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return user ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List users with filtering and pagination
 */
export async function listUsers(
  options?: UserFilterOptions & { pagination?: PaginationOptions }
): Promise<PaginatedResult<UserInfo>> {
  const { pagination, ...filterOptions } = options ?? {};
  const { limit, offset } = getPaginationParams(pagination);

  const conditions = buildUserConditions(filterOptions);

  const data = await db
    .select(userInfoFields)
    .from(users)
    .where(conditions)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(conditions);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List all admin users
 */
export async function listAdminUsers(): Promise<UserInfo[]> {
  return db
    .select(userInfoFields)
    .from(users)
    .where(eq(users.isAdmin, true))
    .orderBy(desc(users.createdAt));
}

// =============================================================================
// COUNT QUERIES
// =============================================================================

/**
 * Count all users
 */
export async function countUsers(options?: UserFilterOptions): Promise<number> {
  const conditions = buildUserConditions(options ?? {});

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(conditions);

  return result?.count ?? 0;
}

/**
 * Count admin users
 */
export async function countAdminUsers(): Promise<number> {
  return countUsers({ isAdmin: true });
}

// =============================================================================
// EXISTENCE CHECKS
// =============================================================================

/**
 * Check if a user exists by ID
 */
export async function userExists(id: string): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return !!user;
}

/**
 * Check if an email is already registered
 */
export async function emailExists(email: string): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  return !!user;
}

/**
 * Check if a GitHub account is already linked
 */
export async function githubIdExists(githubId: string): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubId))
    .limit(1);

  return !!user;
}

// =============================================================================
// SESSION QUERIES
// =============================================================================

/**
 * Count active sessions for a user
 */
export async function countUserSessions(userId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(eq(sessions.userId, userId));

  return result?.count ?? 0;
}

/**
 * List active sessions for a user
 */
export async function listUserSessions(userId: string): Promise<Session[]> {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.expiresAt));
}

/**
 * Count all active sessions (for admin stats)
 */
export async function countAllSessions(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions);

  return result?.count ?? 0;
}

// =============================================================================
// ADMIN HELPERS
// =============================================================================

/**
 * Get admin statistics
 */
export async function getAdminStats(): Promise<{
  totalUsers: number;
  totalAdmins: number;
  activeSessions: number;
  usersWithGithub: number;
}> {
  // Run counts in parallel for efficiency
  const [totalUsers, totalAdmins, activeSessions, usersWithGithub] = await Promise.all([
    countUsers(),
    countAdminUsers(),
    countAllSessions(),
    countUsers({ hasGithub: true }),
  ]);

  return {
    totalUsers,
    totalAdmins,
    activeSessions,
    usersWithGithub,
  };
}

/**
 * Validate user ownership - ensures user exists and matches the expected ID
 */
export async function validateUserOwnership(
  userId: string,
  expectedUserId: string
): Promise<{ valid: boolean; reason?: 'not_found' | 'not_owner' }> {
  if (userId !== expectedUserId) {
    return { valid: false, reason: 'not_owner' };
  }

  const exists = await userExists(userId);
  if (!exists) {
    return { valid: false, reason: 'not_found' };
  }

  return { valid: true };
}

/**
 * Find users by a list of IDs
 */
export async function findUsersByIds(ids: string[]): Promise<UserInfo[]> {
  if (ids.length === 0) return [];

  return db
    .select(userInfoFields)
    .from(users)
    .where(inArray(users.id, ids));
}

/**
 * Get a map of user IDs to user info for batch loading
 */
export async function getUserInfoMap(ids: string[]): Promise<Map<string, UserInfo>> {
  const userList = await findUsersByIds(ids);
  return new Map(userList.map(u => [u.id, u]));
}
