/**
 * Cache Service
 *
 * High-level caching service with specialized methods for different
 * data types (sessions, GitHub, Claude). Wraps the underlying cache
 * implementation with domain-specific logic.
 */
import { MemoryCache } from './MemoryCache.js';
import {
  CacheKeyPrefix,
  CACHE_TTL,
  type CacheConfig,
  type CacheStats,
  type CacheResult,
  type CacheSetOptions,
  type InvalidationPattern,
  type CacheHealth,
} from './types.js';
import { ACacheService } from './ACacheService.js';

import type { ChatSession } from '../db/schema.js';

/**
 * Session list cache entry
 */
export interface CachedSessionList {
  sessions: ChatSession[];
  total: number;
  cachedAt: number;
}

/**
 * GitHub repos cache entry
 */
export interface CachedGitHubRepos {
  repos: Array<{
    id: number;
    name: string;
    full_name: string;
    owner: { login: string };
    private: boolean;
    description: string | null;
    html_url: string;
    clone_url: string;
    default_branch: string;
  }>;
  cachedAt: number;
}

/**
 * GitHub branches cache entry
 */
export interface CachedGitHubBranches {
  branches: Array<{
    name: string;
    protected: boolean;
    commit: { sha: string; url: string };
  }>;
  cachedAt: number;
}

export class CacheService extends ACacheService {
  private memoryCache: MemoryCache;

  constructor(config?: Partial<CacheConfig>) {
    super();
    this.memoryCache = new MemoryCache(config);
  }

  async initialize(): Promise<void> {
    await this.memoryCache.initialize();
  }

  async dispose(): Promise<void> {
    await this.memoryCache.dispose();
  }

  // ==========================================================================
  // Core Cache Operations (delegate to MemoryCache)
  // ==========================================================================

  async get<T>(key: string): Promise<CacheResult<T>> {
    return this.memoryCache.get<T>(key);
  }

  getSync<T>(key: string): CacheResult<T> {
    return this.memoryCache.getSync<T>(key);
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    return this.memoryCache.set(key, value, options);
  }

  setSync<T>(key: string, value: T, options?: CacheSetOptions): void {
    return this.memoryCache.setSync(key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.memoryCache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.memoryCache.has(key);
  }

  async clear(): Promise<void> {
    return this.memoryCache.clear();
  }

  async invalidate(pattern: InvalidationPattern): Promise<number> {
    return this.memoryCache.invalidate(pattern);
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    return this.memoryCache.invalidatePrefix(prefix);
  }

  async invalidateTags(tags: string[]): Promise<number> {
    return this.memoryCache.invalidateTags(tags);
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T> {
    return this.memoryCache.getOrSet(key, factory, options);
  }

  getStats(): CacheStats {
    return this.memoryCache.getStats();
  }

  getHealth(): CacheHealth {
    return this.memoryCache.getHealth();
  }

  getConfig(): CacheConfig {
    return this.memoryCache.getConfig();
  }

  updateConfig(config: Partial<CacheConfig>): void {
    return this.memoryCache.updateConfig(config);
  }

  async cleanup(): Promise<number> {
    return this.memoryCache.cleanup();
  }

  async warmup(entries: Array<{ key: string; value: unknown; options?: CacheSetOptions }>): Promise<void> {
    return this.memoryCache.warmup(entries);
  }

  generateKey(...components: (string | number | boolean | undefined | null)[]): string {
    return this.memoryCache.generateKey(...components);
  }

  scopedKey(prefix: string, ...components: (string | number | boolean | undefined | null)[]): string {
    return this.memoryCache.scopedKey(prefix, ...components);
  }

  // ==========================================================================
  // Session Cache Operations
  // ==========================================================================

  /**
   * Get cached session list for a user
   */
  async getSessionList(userId: string): Promise<CacheResult<CachedSessionList>> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_LIST, userId);
    return this.get<CachedSessionList>(key);
  }

  /**
   * Cache session list for a user
   */
  async setSessionList(userId: string, sessions: ChatSession[]): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_LIST, userId);
    const cached: CachedSessionList = {
      sessions,
      total: sessions.length,
      cachedAt: Date.now(),
    };
    await this.set(key, cached, {
      ttlMs: CACHE_TTL.MEDIUM,
      tags: [`user:${userId}`, 'sessions'],
    });
  }

  /**
   * Get cached active session count for a user
   */
  async getSessionCount(userId: string): Promise<CacheResult<number>> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_COUNT, userId);
    return this.get<number>(key);
  }

  /**
   * Cache active session count for a user
   */
  async setSessionCount(userId: string, count: number): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_COUNT, userId);
    await this.set(key, count, {
      ttlMs: CACHE_TTL.MEDIUM,
      tags: [`user:${userId}`, 'sessions'],
    });
  }

  /**
   * Get cached session detail
   */
  async getSessionDetail(sessionId: string): Promise<CacheResult<ChatSession>> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_DETAIL, sessionId);
    return this.get<ChatSession>(key);
  }

  /**
   * Cache session detail
   */
  async setSessionDetail(session: ChatSession): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.SESSION_DETAIL, session.id);
    await this.set(key, session, {
      ttlMs: CACHE_TTL.MEDIUM,
      tags: [`user:${session.userId}`, `session:${session.id}`, 'sessions'],
    });
  }

  /**
   * Invalidate all session-related caches for a user
   */
  async invalidateUserSessions(userId: string): Promise<number> {
    return this.invalidateTags([`user:${userId}`]);
  }

  /**
   * Invalidate a specific session cache
   */
  async invalidateSession(sessionId: string): Promise<number> {
    return this.invalidateTags([`session:${sessionId}`]);
  }

  // ==========================================================================
  // GitHub Cache Operations
  // ==========================================================================

  /**
   * Get cached GitHub repos for a user
   */
  async getGitHubRepos(userId: string): Promise<CacheResult<CachedGitHubRepos>> {
    const key = this.scopedKey(CacheKeyPrefix.GITHUB_REPOS, userId);
    return this.get<CachedGitHubRepos>(key);
  }

  /**
   * Cache GitHub repos for a user
   */
  async setGitHubRepos(userId: string, repos: CachedGitHubRepos['repos']): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.GITHUB_REPOS, userId);
    const cached: CachedGitHubRepos = {
      repos,
      cachedAt: Date.now(),
    };
    await this.set(key, cached, {
      ttlMs: CACHE_TTL.LONG,
      tags: [`user:${userId}`, 'github'],
    });
  }

  /**
   * Get cached GitHub branches for a repository
   */
  async getGitHubBranches(
    userId: string,
    owner: string,
    repo: string
  ): Promise<CacheResult<CachedGitHubBranches>> {
    const key = this.scopedKey(CacheKeyPrefix.GITHUB_BRANCHES, userId, owner, repo);
    return this.get<CachedGitHubBranches>(key);
  }

  /**
   * Cache GitHub branches for a repository
   */
  async setGitHubBranches(
    userId: string,
    owner: string,
    repo: string,
    branches: CachedGitHubBranches['branches']
  ): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.GITHUB_BRANCHES, userId, owner, repo);
    const cached: CachedGitHubBranches = {
      branches,
      cachedAt: Date.now(),
    };
    await this.set(key, cached, {
      ttlMs: CACHE_TTL.LONG,
      tags: [`user:${userId}`, 'github', `repo:${owner}/${repo}`],
    });
  }

  /**
   * Invalidate all GitHub caches for a user
   */
  async invalidateUserGitHub(userId: string): Promise<number> {
    const prefix = this.scopedKey(CacheKeyPrefix.GITHUB_REPOS, userId);
    const branchPrefix = this.scopedKey(CacheKeyPrefix.GITHUB_BRANCHES, userId);
    const count1 = await this.invalidatePrefix(prefix);
    const count2 = await this.invalidatePrefix(branchPrefix);
    return count1 + count2;
  }

  /**
   * Invalidate GitHub branch cache for a specific repository
   */
  async invalidateRepoBranches(userId: string, owner: string, repo: string): Promise<number> {
    return this.invalidateTags([`repo:${owner}/${repo}`]);
  }

  // ==========================================================================
  // Claude Session Cache Operations
  // ==========================================================================

  /**
   * Get cached Claude session metadata
   */
  async getClaudeSession(sessionId: string): Promise<CacheResult<unknown>> {
    const key = this.scopedKey(CacheKeyPrefix.CLAUDE_SESSION, sessionId);
    return this.get(key);
  }

  /**
   * Cache Claude session metadata
   */
  async setClaudeSession(sessionId: string, metadata: unknown): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.CLAUDE_SESSION, sessionId);
    await this.set(key, metadata, {
      ttlMs: CACHE_TTL.MEDIUM,
      tags: [`claude:${sessionId}`, 'claude'],
    });
  }

  /**
   * Invalidate Claude session cache
   */
  async invalidateClaudeSession(sessionId: string): Promise<number> {
    return this.invalidateTags([`claude:${sessionId}`]);
  }

  // ==========================================================================
  // User Profile Cache Operations
  // ==========================================================================

  /**
   * Get cached user profile
   */
  async getUserProfile<T>(userId: string): Promise<CacheResult<T>> {
    const key = this.scopedKey(CacheKeyPrefix.USER_PROFILE, userId);
    return this.get<T>(key);
  }

  /**
   * Cache user profile
   */
  async setUserProfile<T>(userId: string, profile: T): Promise<void> {
    const key = this.scopedKey(CacheKeyPrefix.USER_PROFILE, userId);
    await this.set(key, profile, {
      ttlMs: CACHE_TTL.LONG,
      tags: [`user:${userId}`, 'profile'],
    });
  }

  /**
   * Invalidate user profile cache
   */
  async invalidateUserProfile(userId: string): Promise<number> {
    const key = this.scopedKey(CacheKeyPrefix.USER_PROFILE, userId);
    return (await this.delete(key)) ? 1 : 0;
  }
}

// Note: Use ServiceProvider.get(ACacheService) instead of a singleton
// This ensures proper dependency injection and testability
