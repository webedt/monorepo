/**
 * Shared Storage Instances
 * Singleton instances for commonly used storage keys.
 *
 * IMPORTANT: Use these shared instances instead of creating new ones
 * to ensure cache consistency across the application. Each storage
 * instance maintains an in-memory cache, so multiple instances for
 * the same key will have inconsistent caches.
 */

import { SimpleStorage, ArrayStorage, RecordStorage } from './typedStorage';
import { UI_KEYS, COMPONENT_KEYS } from './storageKeys';

// Default event filters for detailed chat mode
const DEFAULT_EVENT_FILTERS: Record<string, boolean> = {
  user: true,
  user_message: true,
  input_preview: true,
  submission_preview: true,
  resuming: false,
  assistant: true,
  assistant_message: true,
  tool_use: true,
  tool_result: false,
  message: true,
  system: false,
  error: true,
  connected: false,
  completed: true,
  session_name: true,
  'session-created': true,
  session_created: true,
  title_generation: true,
  result: true,
  env_manager_log: false,
  heartbeat: false,
  thinking: true,
};

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

/**
 * Chat view mode storage.
 * Used by ChatPage to persist view mode preference.
 */
export const chatViewModeStorage = new SimpleStorage<string>(UI_KEYS.CHAT_VIEW_MODE, '');

/**
 * Chat timestamps toggle.
 * Used by ChatPage to persist timestamp display preference.
 */
export const chatTimestampsStorage = new SimpleStorage<boolean>(UI_KEYS.CHAT_SHOW_TIMESTAMPS, false);

/**
 * Chat widescreen mode toggle.
 * Used by ChatPage to persist widescreen preference.
 */
export const chatWidescreenStorage = new SimpleStorage<boolean>(UI_KEYS.CHAT_WIDESCREEN, false);

/**
 * Chat event filters for detailed mode.
 * Used by ChatPage to persist which event types to show.
 */
export const chatEventFiltersStorage = new RecordStorage<boolean>(
  UI_KEYS.CHAT_EVENT_FILTERS,
  { ...DEFAULT_EVENT_FILTERS }
);
