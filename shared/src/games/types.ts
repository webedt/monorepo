/**
 * Game Platform Types
 * Core types and interfaces for game platform management
 */

// =============================================================================
// Platform Types
// =============================================================================

/**
 * Supported operating system platforms
 */
export type PlatformOS = 'windows' | 'macos' | 'linux';

/**
 * Platform architecture
 */
export type PlatformArchitecture = 'x64' | 'x86' | 'arm64';

/**
 * Platform identifier combining OS and architecture
 */
export interface PlatformIdentifier {
  os: PlatformOS;
  architecture: PlatformArchitecture;
}

/**
 * Platform definition with metadata
 */
export interface Platform {
  id: string;
  os: PlatformOS;
  architecture: PlatformArchitecture;
  displayName: string;
  iconUrl?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create platform request
 */
export interface CreatePlatformRequest {
  os: PlatformOS;
  architecture: PlatformArchitecture;
  displayName: string;
  iconUrl?: string;
}

// =============================================================================
// System Requirements Types
// =============================================================================

/**
 * Hardware requirement levels
 */
export type RequirementLevel = 'minimum' | 'recommended';

/**
 * Graphics API types
 */
export type GraphicsAPI = 'directx11' | 'directx12' | 'vulkan' | 'metal' | 'opengl';

/**
 * System requirements for a game on a specific platform
 */
export interface SystemRequirements {
  id: string;
  gameId: string;
  platformId: string;
  level: RequirementLevel;
  osVersion?: string;
  processor?: string;
  memory?: number; // RAM in MB
  graphics?: string;
  graphicsMemory?: number; // VRAM in MB
  graphicsApi?: GraphicsAPI;
  storage?: number; // Required disk space in MB
  additionalNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create system requirements request
 */
export interface CreateSystemRequirementsRequest {
  gameId: string;
  platformId: string;
  level: RequirementLevel;
  osVersion?: string;
  processor?: string;
  memory?: number;
  graphics?: string;
  graphicsMemory?: number;
  graphicsApi?: GraphicsAPI;
  storage?: number;
  additionalNotes?: string;
}

// =============================================================================
// Installation Types
// =============================================================================

/**
 * Installation status states
 */
export type InstallStatus =
  | 'not_installed'
  | 'queued'
  | 'downloading'
  | 'installing'
  | 'installed'
  | 'updating'
  | 'paused'
  | 'error';

/**
 * Download progress information
 */
export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  bytesPerSecond: number;
  estimatedSecondsRemaining: number;
  currentFile?: string;
  filesTotal?: number;
  filesCompleted?: number;
}

/**
 * User game installation record
 */
export interface GameInstallation {
  id: string;
  userId: string;
  gameId: string;
  platformId: string;
  status: InstallStatus;
  installPath?: string;
  version?: string;
  installedSizeBytes?: number;
  downloadProgress?: DownloadProgress;
  lastPlayedAt?: Date;
  playtimeMinutes: number;
  autoUpdate: boolean;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create installation request
 */
export interface CreateInstallationRequest {
  userId: string;
  gameId: string;
  platformId: string;
  installPath?: string;
}

/**
 * Update installation status request
 */
export interface UpdateInstallationStatusRequest {
  status: InstallStatus;
  version?: string;
  installedSizeBytes?: number;
  downloadProgress?: DownloadProgress;
  errorMessage?: string;
}

/**
 * Game build/version information
 */
export interface GameBuild {
  id: string;
  gameId: string;
  platformId: string;
  version: string;
  buildNumber?: number;
  sizeBytes: number;
  checksum?: string;
  checksumType?: 'md5' | 'sha256';
  releaseNotes?: string;
  isMandatory: boolean;
  isPrerelease: boolean;
  downloadUrl?: string;
  createdAt: Date;
}

// =============================================================================
// Achievement Types
// =============================================================================

/**
 * Achievement rarity tiers
 */
export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/**
 * Achievement unlock type
 */
export type AchievementType = 'standard' | 'hidden' | 'progressive';

/**
 * Game achievement definition
 */
export interface Achievement {
  id: string;
  gameId: string;
  name: string;
  description: string;
  hiddenDescription?: string;
  iconUrl?: string;
  iconLockedUrl?: string;
  points: number;
  rarity: AchievementRarity;
  type: AchievementType;
  maxProgress?: number; // For progressive achievements
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Create achievement request
 */
export interface CreateAchievementRequest {
  gameId: string;
  name: string;
  description: string;
  hiddenDescription?: string;
  iconUrl?: string;
  iconLockedUrl?: string;
  points?: number;
  rarity?: AchievementRarity;
  type?: AchievementType;
  maxProgress?: number;
  sortOrder?: number;
}

/**
 * User achievement progress record
 */
export interface UserAchievement {
  id: string;
  usedId: string;
  achievementId: string;
  gameId: string;
  unlocked: boolean;
  unlockedAt?: Date;
  progress?: number;
  notified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Unlock achievement request
 */
export interface UnlockAchievementRequest {
  userId: string;
  achievementId: string;
}

/**
 * Update achievement progress request
 */
export interface UpdateAchievementProgressRequest {
  userId: string;
  achievementId: string;
  progress: number;
}

/**
 * Achievement statistics for a game
 */
export interface AchievementStats {
  gameId: string;
  totalAchievements: number;
  totalPoints: number;
  globalUnlockRates: Map<string, number>; // achievementId -> percentage
}

/**
 * User achievement summary for a game
 */
export interface UserAchievementSummary {
  userId: string;
  gameId: string;
  unlockedCount: number;
  totalCount: number;
  earnedPoints: number;
  totalPoints: number;
  completionPercentage: number;
  lastUnlockedAt?: Date;
}

// =============================================================================
// Cloud Save Types
// =============================================================================

/**
 * Save sync status
 */
export type SaveSyncStatus = 'synced' | 'uploading' | 'downloading' | 'conflict' | 'error';

/**
 * Save slot type
 */
export type SaveSlotType = 'auto' | 'manual' | 'quicksave' | 'checkpoint';

/**
 * Cloud save record
 */
export interface CloudSave {
  id: string;
  userId: string;
  gameId: string;
  slotNumber: number;
  slotType: SaveSlotType;
  name?: string;
  description?: string;
  thumbnailUrl?: string;
  sizeBytes: number;
  checksum: string;
  checksumType: 'md5' | 'sha256';
  gameVersion?: string;
  playtimeMinutes?: number;
  gameProgress?: Record<string, unknown>; // Game-specific metadata
  syncStatus: SaveSyncStatus;
  cloudUrl?: string;
  localPath?: string;
  conflictData?: CloudSaveConflict;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date;
}

/**
 * Save conflict data when local and cloud differ
 */
export interface CloudSaveConflict {
  localChecksum: string;
  cloudChecksum: string;
  localModifiedAt: Date;
  cloudModifiedAt: Date;
  localSizeBytes: number;
  cloudSizeBytes: number;
}

/**
 * Create cloud save request
 */
export interface CreateCloudSaveRequest {
  userId: string;
  gameId: string;
  slotNumber: number;
  slotType: SaveSlotType;
  name?: string;
  description?: string;
  sizeBytes: number;
  checksum: string;
  checksumType: 'md5' | 'sha256';
  gameVersion?: string;
  playtimeMinutes?: number;
  gameProgress?: Record<string, unknown>;
  localPath?: string;
}

/**
 * Resolve conflict request
 */
export interface ResolveConflictRequest {
  saveId: string;
  resolution: 'keep_local' | 'keep_cloud' | 'keep_both';
  newSlotNumber?: number; // For 'keep_both' resolution
}

/**
 * Cloud save quota information
 */
export interface CloudSaveQuota {
  userId: string;
  usedBytes: number;
  totalBytes: number;
  saveCount: number;
  maxSaves: number;
}

// =============================================================================
// Compatibility Types
// =============================================================================

/**
 * Compatibility check result
 */
export interface CompatibilityCheckResult {
  compatible: boolean;
  platform: PlatformIdentifier;
  checks: CompatibilityCheck[];
  overallScore: number; // 0-100
  recommendation: 'not_supported' | 'minimum' | 'recommended' | 'exceeds';
}

/**
 * Individual compatibility check
 */
export interface CompatibilityCheck {
  category: 'os' | 'processor' | 'memory' | 'graphics' | 'storage' | 'api';
  passed: boolean;
  required?: string;
  detected?: string;
  notes?: string;
}

/**
 * User system information
 */
export interface UserSystemInfo {
  os: PlatformOS;
  osVersion: string;
  architecture: PlatformArchitecture;
  processor?: string;
  processorCores?: number;
  memoryMB?: number;
  graphics?: string;
  graphicsMemoryMB?: number;
  graphicsApi?: GraphicsAPI[];
  availableStorageMB?: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Game platform event types
 */
export type GamePlatformEventType =
  | 'installation_started'
  | 'installation_progress'
  | 'installation_completed'
  | 'installation_failed'
  | 'installation_paused'
  | 'update_available'
  | 'update_started'
  | 'update_completed'
  | 'achievement_unlocked'
  | 'achievement_progress'
  | 'save_synced'
  | 'save_conflict'
  | 'save_error';

/**
 * Game platform event
 */
export interface GamePlatformEvent {
  type: GamePlatformEventType;
  userId: string;
  gameId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

/**
 * Event callback function
 */
export type GamePlatformEventCallback = (event: GamePlatformEvent) => void;
