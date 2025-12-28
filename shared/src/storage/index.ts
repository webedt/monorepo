/**
 * Storage module - User storage quota management
 *
 * Provides storage tracking, quota enforcement, and usage statistics.
 * Default quota: 5 GB per user ("Few GB per user" requirement)
 */

export {
  StorageService,
  STORAGE_TIERS,
  calculateBase64Size,
  calculateJsonSize,
  calculateStringSize,
} from './StorageService.js';

export type {
  StorageTier,
  StorageStats,
  StorageBreakdown,
  StorageQuotaCheck,
} from './StorageService.js';
