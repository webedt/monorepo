/**
 * Game Platform Libraries
 * Shared platform services for games - platform management, installations,
 * achievements, and cloud saves
 */

// =============================================================================
// Types
// =============================================================================
export type {
  // Platform types
  PlatformOS,
  PlatformArchitecture,
  PlatformIdentifier,
  Platform,
  CreatePlatformRequest,
  // System requirements types
  RequirementLevel,
  GraphicsAPI,
  SystemRequirements,
  CreateSystemRequirementsRequest,
  // Installation types
  InstallStatus,
  DownloadProgress,
  GameInstallation as GameInstallationInfo,
  CreateInstallationRequest,
  UpdateInstallationStatusRequest,
  GameBuild as GameBuildInfo,
  // Achievement types
  AchievementRarity,
  AchievementType,
  Achievement,
  CreateAchievementRequest,
  UserAchievement as UserAchievementInfo,
  UnlockAchievementRequest,
  UpdateAchievementProgressRequest,
  AchievementStats,
  UserAchievementSummary,
  // Cloud save types (renamed to avoid collision with cloudSaves module)
  SaveSyncStatus,
  SaveSlotType,
  CloudSave as GameCloudSaveInfo,
  CloudSaveConflict as GameCloudSaveConflict,
  CreateCloudSaveRequest as CreateGameCloudSaveRequest,
  ResolveConflictRequest as ResolveGameCloudSaveConflictRequest,
  CloudSaveQuota as GameCloudSaveQuota,
  // Compatibility types
  CompatibilityCheckResult,
  CompatibilityCheck,
  UserSystemInfo,
  // Event types
  GamePlatformEventType,
  GamePlatformEvent,
  GamePlatformEventCallback,
} from './types.js';

// =============================================================================
// Abstract Services
// =============================================================================
export { AGamePlatformService } from './AGamePlatformService.js';
export { AGameInstallService } from './AGameInstallService.js';
export { AGameAchievementService } from './AGameAchievementService.js';
export { AGameSaveService } from './AGameSaveService.js';

// =============================================================================
// Service Implementations
// =============================================================================
export { GamePlatformService } from './gamePlatformService.js';
export { GameInstallService } from './gameInstallService.js';
export { GameAchievementService } from './gameAchievementService.js';
export { GameSaveService } from './gameSaveService.js';

// =============================================================================
// Utilities
// =============================================================================
export {
  detectPlatform,
  getPlatformDisplayName,
  platformMatches,
  checkCompatibility,
  formatFileSize,
  formatDownloadSpeed,
  formatTimeRemaining,
  getSupportedGraphicsApis,
  isGraphicsApiSupported,
  getPreferredGraphicsApi,
  compareVersions,
  isUpdateAvailable,
  calculateProgress,
  estimateRemainingTime,
} from './platformCompatibility.js';
