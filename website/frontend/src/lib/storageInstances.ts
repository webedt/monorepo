/**
 * Shared Storage Instances
 * Singleton instances for commonly used storage keys.
 *
 * IMPORTANT: Use these shared instances instead of creating new ones
 * to ensure cache consistency across the application. Each storage
 * instance maintains an in-memory cache, so multiple instances for
 * the same key will have inconsistent caches.
 *
 * Note: UniversalSearch creates its own ArrayStorage instance because
 * it supports custom storage keys via the recentSearchesKey option.
 */

import { SimpleStorage, ArrayStorage } from './typedStorage';
import { UI_KEYS } from './storageKeys';

/**
 * Last selected repository (owner/repo format).
 * Used by AgentsPage, QuickAccessPage, and NewSessionModal.
 */
export const lastRepoStorage = new SimpleStorage<string>(UI_KEYS.LAST_REPO, '');

/**
 * Recent repositories list.
 * Used for quick selection in repository pickers.
 */
export const recentReposStorage = new ArrayStorage<string>(
  UI_KEYS.RECENT_REPOS,
  [],
  {
    maxItems: 10,
    itemValidator: (item): item is string => typeof item === 'string' && item.length > 0,
  }
);
