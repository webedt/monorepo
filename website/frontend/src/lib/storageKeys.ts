/**
 * Storage Keys
 * Centralized constants for all localStorage keys used in the application.
 * This prevents key collisions and makes it easy to find all storage usage.
 */

// Prefix for all storage keys to avoid collisions with other apps
const PREFIX = 'webedt';

/**
 * Storage keys for store persistence
 */
export const STORE_KEYS = {
  /** Widget layout and configuration */
  WIDGET: `${PREFIX}_widget_store`,
  /** Selected repository state */
  REPO: `${PREFIX}_repo_store`,
  /** Beat grid settings for audio editing */
  BEAT_GRID: `${PREFIX}_beat_grid_settings`,
  /** Audio source settings */
  AUDIO_SOURCE: `${PREFIX}_audio_source_settings`,
  /** Editor settings (format on save, tabs, etc.) */
  EDITOR_SETTINGS: `${PREFIX}_editor_settings`,
  /** Onion skinning preferences for animation */
  ONION_SKINNING: `${PREFIX}_onion_skinning`,
} as const;

/**
 * Storage keys for UI preferences
 */
export const UI_KEYS = {
  /** Theme preference (light, dark, system, etc.) */
  THEME: `${PREFIX}:theme`,
  /** Chat page view mode (normal, detailed, raw) */
  CHAT_VIEW_MODE: `${PREFIX}_chat_view_mode`,
  /** Chat page timestamp display toggle */
  CHAT_SHOW_TIMESTAMPS: `${PREFIX}_chat_show_timestamps`,
  /** Chat page widescreen mode toggle */
  CHAT_WIDESCREEN: `${PREFIX}_chat_widescreen`,
  /** Chat page event filter settings */
  CHAT_EVENT_FILTERS: `${PREFIX}_chat_event_filters`,
  /** Last used repository (owner/name) */
  LAST_REPO: `${PREFIX}_last_repo`,
  /** Recent repositories list */
  RECENT_REPOS: `${PREFIX}_recent_repos`,
  /** Quick start templates */
  QUICK_START_TEMPLATES: `${PREFIX}_quick_start_templates`,
} as const;

/**
 * Storage keys for component state
 */
export const COMPONENT_KEYS = {
  /** Universal search recent searches */
  UNIVERSAL_SEARCH_RECENT: `${PREFIX}_universal_search_recent`,
} as const;

/**
 * Legacy storage keys (for migration purposes)
 */
export const LEGACY_KEYS = {
  /** Old chat raw JSON toggle */
  CHAT_SHOW_RAW_JSON: 'chat_showRawJson',
  /** Old chat view mode */
  CHAT_VIEW_MODE: 'chat_viewMode',
  /** Old chat timestamps */
  CHAT_SHOW_TIMESTAMPS: 'chat_showTimestamps',
  /** Old chat widescreen */
  CHAT_WIDESCREEN: 'chat_widescreen',
  /** Old chat event filters */
  CHAT_EVENT_FILTERS: 'chat_eventFilters',
} as const;

/**
 * All storage keys for easy enumeration
 */
export const ALL_STORAGE_KEYS = {
  ...STORE_KEYS,
  ...UI_KEYS,
  ...COMPONENT_KEYS,
} as const;

/**
 * Helper to create a dynamic storage key with a suffix
 * @example createDynamicKey('searchable_select', 'repos') => 'webedt_searchable_select:repos'
 */
export function createDynamicKey(base: string, suffix: string): string {
  return `${PREFIX}_${base}:${suffix}`;
}
