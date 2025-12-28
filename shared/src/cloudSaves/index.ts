/**
 * Cloud Saves module - Game save synchronization across devices
 *
 * Provides cloud storage for game saves with:
 * - Multi-slot save management
 * - Version history for recovery
 * - Cross-device sync tracking
 * - Storage quota integration
 */

export {
  CloudSavesService,
} from './CloudSavesService.js';

export type {
  SaveUploadParams,
  SaveDownloadResult,
  CloudSaveWithGame,
  SyncConflict,
  CloudSaveStats,
} from './CloudSavesService.js';
