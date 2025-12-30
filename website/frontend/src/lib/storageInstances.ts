/**
 * Shared Storage Instances
 * Singleton instances for commonly used storage keys.
 *
 * IMPORTANT: Use these shared instances instead of creating new ones
 * to ensure cache consistency across the application. Each storage
 * instance maintains an in-memory cache, so multiple instances for
 * the same key will have inconsistent caches.
 */

import { SimpleStorage, ArrayStorage } from './typedStorage';
import { UI_KEYS, COMPONENT_KEYS } from './storageKeys';

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

/**
 * Universal search recent queries.
 */
export const universalSearchRecentStorage = new ArrayStorage<string>(
  COMPONENT_KEYS.UNIVERSAL_SEARCH_RECENT,
  [],
  {
    maxItems: 5,
    itemValidator: (item): item is string => typeof item === 'string',
  }
);
