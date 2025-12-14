/**
 * Cloud Services Type Definitions
 * Implements SPEC.md Section 4.5: Cloud Services for Library
 *
 * Provides type definitions for:
 * - Cloud saves synced across devices
 * - Platform libraries for games with cloud save API
 * - Leaderboards API foundation
 * - Achievement system (future extensibility)
 */

// Cloud sync status for library items
export type CloudSyncStatus =
  | 'synced'      // All data is synced with cloud
  | 'syncing'     // Currently syncing
  | 'pending'     // Changes pending upload
  | 'conflict'    // Sync conflict detected
  | 'offline'     // Device is offline
  | 'error'       // Sync error occurred
  | 'disabled';   // Cloud sync disabled for this item

// Cloud save data structure
export interface CloudSaveData {
  id: string;
  itemId: number;           // Library item ID
  userId: string;
  slotIndex: number;        // Save slot (0-based)
  slotName?: string;        // User-defined slot name
  data: Record<string, unknown>; // Actual save data (game state, preferences, etc.)
  metadata: CloudSaveMetadata;
  createdAt: string;
  updatedAt: string;
  version: number;          // For conflict resolution
}

// Metadata for cloud saves
export interface CloudSaveMetadata {
  playtime?: number;        // Total playtime in seconds
  level?: number;           // Current level/progress
  completion?: number;      // Completion percentage (0-100)
  thumbnail?: string;       // Screenshot/preview of save state
  deviceId?: string;        // Device that created/last modified the save
  deviceName?: string;      // Human-readable device name
  checksum?: string;        // Data integrity checksum
}

// Cloud sync state for a library item
export interface CloudSyncState {
  itemId: number;
  status: CloudSyncStatus;
  lastSyncedAt?: string;
  lastModifiedAt?: string;
  syncProgress?: number;    // 0-100 for ongoing syncs
  errorMessage?: string;    // Error details if status is 'error'
  conflictDetails?: CloudSyncConflict;
  saveCount: number;        // Number of cloud saves for this item
}

// Conflict details when sync conflict is detected
export interface CloudSyncConflict {
  localVersion: number;
  remoteVersion: number;
  localModifiedAt: string;
  remoteModifiedAt: string;
  localDeviceName?: string;
  remoteDeviceName?: string;
}

// Cloud save slot summary (for listing saves without full data)
export interface CloudSaveSlot {
  id: string;
  slotIndex: number;
  slotName?: string;
  updatedAt: string;
  metadata: CloudSaveMetadata;
}

// Options for cloud save operations
export interface CloudSaveOptions {
  autoSync?: boolean;       // Auto-sync after save
  compress?: boolean;       // Compress save data
  encrypt?: boolean;        // Encrypt save data
  priority?: 'high' | 'normal' | 'low'; // Sync priority
}

// Result of cloud save operations
export interface CloudSaveResult {
  success: boolean;
  saveId?: string;
  version?: number;
  error?: string;
  conflictResolved?: boolean;
}

// Leaderboard entry
export interface LeaderboardEntry {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  score: number;
  rank: number;
  metadata?: Record<string, unknown>;
  achievedAt: string;
  verified?: boolean;
}

// Leaderboard configuration
export interface LeaderboardConfig {
  id: string;
  itemId: number;           // Library item ID
  name: string;
  description?: string;
  scoreType: 'highest' | 'lowest' | 'cumulative';
  scoreFormat?: string;     // Format string for display (e.g., "time", "points", "distance")
  maxEntries?: number;      // Max entries to display
  resetPeriod?: LeaderboardResetPeriod;
  isActive: boolean;
  createdAt: string;
}

// Reset period for leaderboards
export type LeaderboardResetPeriod = 'never' | 'daily' | 'weekly' | 'monthly' | 'seasonal';

// Leaderboard query options
export interface LeaderboardQueryOptions {
  limit?: number;           // Number of entries to fetch
  offset?: number;          // Pagination offset
  period?: LeaderboardResetPeriod; // Filter by period
  friendsOnly?: boolean;    // Only show friends
  includeUser?: boolean;    // Include current user's entry even if not in top
}

// Leaderboard response
export interface LeaderboardResponse {
  leaderboardId: string;
  entries: LeaderboardEntry[];
  totalEntries: number;
  userEntry?: LeaderboardEntry;
  userRank?: number;
  lastUpdated: string;
}

// Achievement definition (future extensibility)
export interface AchievementDefinition {
  id: string;
  itemId: number;           // Library item ID
  name: string;
  description: string;
  iconUrl?: string;
  points?: number;          // Achievement points/XP
  isSecret?: boolean;       // Hidden until unlocked
  prerequisites?: string[]; // Achievement IDs required first
  criteria: AchievementCriteria;
  createdAt: string;
}

// Criteria for unlocking achievements
export interface AchievementCriteria {
  type: 'stat' | 'event' | 'composite';
  statName?: string;        // For stat-based achievements
  threshold?: number;       // Value to reach
  comparison?: 'gte' | 'lte' | 'eq';
  eventName?: string;       // For event-based achievements
  children?: AchievementCriteria[]; // For composite criteria
  operator?: 'and' | 'or';  // How to combine children
}

// User's achievement progress
export interface AchievementProgress {
  achievementId: string;
  userId: string;
  isUnlocked: boolean;
  unlockedAt?: string;
  progress: number;         // 0-100 percentage
  currentValue?: number;    // Current stat value if applicable
  targetValue?: number;     // Target value if applicable
}

// Cloud services configuration
export interface CloudServicesConfig {
  cloudSaveEnabled: boolean;
  maxSaveSlots: number;
  autoSyncInterval?: number; // Milliseconds between auto-syncs
  leaderboardsEnabled: boolean;
  achievementsEnabled: boolean;
  offlineMode: boolean;      // Allow offline operation with later sync
}

// Extended library item with cloud sync info
export interface LibraryItemWithCloudSync {
  id: number;
  title: string;
  description: string;
  price: string;
  thumbnail: string;
  purchasedDate: string;
  lastPlayedDate?: string;
  playCount?: number;
  isFavorite?: boolean;
  collectionIds?: number[];
  isWishlisted?: boolean;
  // Cloud services extensions
  cloudSync?: CloudSyncState;
  hasCloudSaves?: boolean;
  hasLeaderboards?: boolean;
  hasAchievements?: boolean;
}

// Cloud services event types for real-time updates
export type CloudServiceEventType =
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed'
  | 'save_created'
  | 'save_updated'
  | 'save_deleted'
  | 'conflict_detected'
  | 'conflict_resolved'
  | 'leaderboard_updated'
  | 'achievement_unlocked';

// Cloud service event
export interface CloudServiceEvent {
  type: CloudServiceEventType;
  itemId: number;
  timestamp: string;
  data?: Record<string, unknown>;
}

// Cloud service error codes
export type CloudServiceErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'QUOTA_EXCEEDED'
  | 'SAVE_TOO_LARGE'
  | 'INVALID_DATA'
  | 'CONFLICT_ERROR'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE';

// Cloud service error
export interface CloudServiceError {
  code: CloudServiceErrorCode;
  message: string;
  retryable: boolean;
  retryAfter?: number;      // Milliseconds to wait before retry
}
