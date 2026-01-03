/**
 * Game Install Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Game Install Service.
 * The service manages game installations, downloads, updates, and playtime tracking.
 *
 * @see AGameInstallService for the abstract base class
 * @see GameInstallService for the implementation
 */

import type { CreateInstallationRequest } from './types.js';
import type { DownloadProgress } from './types.js';
import type { GameBuild } from './types.js';
import type { GameInstallation } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { InstallStatus } from './types.js';
import type { UpdateInstallationStatusRequest } from './types.js';

export type { CreateInstallationRequest } from './types.js';
export type { DownloadProgress } from './types.js';
export type { GameBuild } from './types.js';
export type { GameInstallation } from './types.js';
export type { GamePlatformEventCallback } from './types.js';
export type { InstallStatus } from './types.js';
export type { UpdateInstallationStatusRequest } from './types.js';

/**
 * Interface for Game Install Service with full documentation.
 *
 * The Game Install Service manages the complete lifecycle of game installations
 * on player machines. It tracks download progress, installation status, updates,
 * and playtime.
 *
 * ## Features
 *
 * - **Download Management**: Track download progress with pause/resume
 * - **Installation Tracking**: Monitor install status across multiple games
 * - **Update Checking**: Detect and apply game updates
 * - **Playtime Tracking**: Record time spent in each game
 * - **Auto-Update**: Configure automatic update preferences
 * - **Real-time Events**: Subscribe to installation status changes
 *
 * ## Installation Status Flow
 *
 * ```
 * not_installed -> queued -> downloading -> installing -> installed
 *                        \-> paused
 *                        \-> failed
 *
 * installed -> updating -> installed
 *           \-> uninstalling -> not_installed
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * // Start a new installation
 * const installation = await installService.createInstallation({
 *   userId: 'user-123',
 *   gameId: 'game-456',
 *   platformId: 'plat-windows-x64',
 *   installPath: 'C:/Games/MyGame',
 * });
 *
 * await installService.startInstallation(installation.id);
 *
 * // Track progress
 * installService.subscribeToEvents(userId, (event) => {
 *   if (event.type === 'download_progress') {
 *     updateProgressBar(event.progress);
 *   }
 * });
 * ```
 */
export interface IGameInstallServiceDocumentation {
  /**
   * Create a new installation record.
   *
   * @param request - Installation parameters
   * @param request.userId - The player's user ID
   * @param request.gameId - The game to install
   * @param request.platformId - Target platform
   * @param request.installPath - Local installation directory
   * @param request.autoUpdate - Enable automatic updates
   * @returns Created installation record
   *
   * @example
   * ```typescript
   * const installation = await installService.createInstallation({
   *   userId: 'user-123',
   *   gameId: 'game-456',
   *   platformId: 'plat-windows-x64',
   *   installPath: 'C:/Games/SpaceExplorer',
   *   autoUpdate: true,
   * });
   * ```
   */
  createInstallation(request: CreateInstallationRequest): Promise<GameInstallation>;

  /**
   * Get an installation by ID.
   *
   * @param installationId - The installation ID
   * @returns Installation if found, null otherwise
   *
   * @example
   * ```typescript
   * const installation = await installService.getInstallation('inst-123');
   * console.log(`Status: ${installation?.status}`);
   * ```
   */
  getInstallation(installationId: string): Promise<GameInstallation | null>;

  /**
   * Get installation for a specific user and game.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns Installation if exists, null otherwise
   *
   * @example
   * ```typescript
   * const installation = await installService.getInstallationByUserGame(userId, gameId);
   *
   * if (installation?.status === 'installed') {
   *   showPlayButton();
   * } else if (installation) {
   *   showResumeDownloadButton();
   * } else {
   *   showInstallButton();
   * }
   * ```
   */
  getInstallationByUserGame(
    userId: string,
    gameId: string
  ): Promise<GameInstallation | null>;

  /**
   * List all installations for a player.
   *
   * @param userId - The player's user ID
   * @returns All installations for the player
   *
   * @example
   * ```typescript
   * const installations = await installService.listUserInstallations(userId);
   * const installed = installations.filter(i => i.status === 'installed');
   * console.log(`${installed.length} games installed`);
   * ```
   */
  listUserInstallations(userId: string): Promise<GameInstallation[]>;

  /**
   * List installations by status.
   *
   * @param userId - The player's user ID
   * @param status - Status to filter by
   * @returns Installations with the specified status
   *
   * @example
   * ```typescript
   * // Find paused downloads
   * const paused = await installService.listUserInstallationsByStatus(userId, 'paused');
   * if (paused.length > 0) {
   *   showResumeAllButton();
   * }
   * ```
   */
  listUserInstallationsByStatus(
    userId: string,
    status: InstallStatus
  ): Promise<GameInstallation[]>;

  /**
   * Update installation status.
   *
   * @param installationId - The installation ID
   * @param updates - Status update parameters
   * @returns Updated installation
   *
   * @example
   * ```typescript
   * await installService.updateInstallationStatus('inst-123', {
   *   status: 'installing',
   *   currentStep: 'Extracting files...',
   * });
   * ```
   */
  updateInstallationStatus(
    installationId: string,
    updates: UpdateInstallationStatusRequest
  ): Promise<GameInstallation>;

  /**
   * Update download progress.
   *
   * @param installationId - The installation ID
   * @param progress - Download progress data
   * @returns Updated installation
   *
   * @example
   * ```typescript
   * await installService.updateDownloadProgress('inst-123', {
   *   downloadedBytes: 1500000000,
   *   totalBytes: 5000000000,
   *   speedBytesPerSecond: 25000000,
   *   estimatedSecondsRemaining: 140,
   * });
   * ```
   */
  updateDownloadProgress(
    installationId: string,
    progress: DownloadProgress
  ): Promise<GameInstallation>;

  /**
   * Start an installation.
   *
   * Transitions from queued to downloading status.
   *
   * @param installationId - The installation ID
   * @returns Updated installation with 'downloading' status
   *
   * @example
   * ```typescript
   * const installation = await installService.startInstallation('inst-123');
   * // Begin actual download...
   * ```
   */
  startInstallation(installationId: string): Promise<GameInstallation>;

  /**
   * Pause a download.
   *
   * @param installationId - The installation ID
   * @returns Updated installation with 'paused' status
   *
   * @example
   * ```typescript
   * await installService.pauseInstallation('inst-123');
   * // Pause the download worker
   * downloadWorker.pause();
   * ```
   */
  pauseInstallation(installationId: string): Promise<GameInstallation>;

  /**
   * Resume a paused download.
   *
   * @param installationId - The installation ID
   * @returns Updated installation with 'downloading' status
   *
   * @example
   * ```typescript
   * const installation = await installService.resumeInstallation('inst-123');
   * // Resume download from last position
   * downloadWorker.resume(installation.downloadProgress.downloadedBytes);
   * ```
   */
  resumeInstallation(installationId: string): Promise<GameInstallation>;

  /**
   * Cancel an installation.
   *
   * Removes the installation record and cleans up partial files.
   *
   * @param installationId - The installation ID
   *
   * @example
   * ```typescript
   * await installService.cancelInstallation('inst-123');
   * // Cleanup partial download
   * await cleanupPartialDownload(installPath);
   * ```
   */
  cancelInstallation(installationId: string): Promise<void>;

  /**
   * Mark installation as complete.
   *
   * @param installationId - The installation ID
   * @param version - Installed version string
   * @param installedSizeBytes - Total installed size
   * @returns Updated installation with 'installed' status
   *
   * @example
   * ```typescript
   * const installation = await installService.completeInstallation(
   *   'inst-123',
   *   '1.2.3',
   *   5368709120 // 5 GB
   * );
   *
   * showNotification(`${installation.game.name} is ready to play!`);
   * ```
   */
  completeInstallation(
    installationId: string,
    version: string,
    installedSizeBytes: number
  ): Promise<GameInstallation>;

  /**
   * Mark installation as failed.
   *
   * @param installationId - The installation ID
   * @param errorMessage - Description of the failure
   * @returns Updated installation with 'failed' status
   *
   * @example
   * ```typescript
   * try {
   *   await downloadGame(installation);
   * } catch (error) {
   *   await installService.markInstallationError(
   *     installation.id,
   *     error.message
   *   );
   * }
   * ```
   */
  markInstallationError(
    installationId: string,
    errorMessage: string
  ): Promise<GameInstallation>;

  /**
   * Uninstall a game.
   *
   * Removes the installation record. Does not delete files.
   *
   * @param installationId - The installation ID
   *
   * @example
   * ```typescript
   * // Delete files first
   * await deleteDirectory(installation.installPath);
   *
   * // Then remove record
   * await installService.uninstallGame(installation.id);
   * ```
   */
  uninstallGame(installationId: string): Promise<void>;

  /**
   * Add playtime to an installation.
   *
   * @param installationId - The installation ID
   * @param additionalMinutes - Minutes to add
   * @returns Updated installation with new playtime
   *
   * @example
   * ```typescript
   * // Track session playtime
   * const sessionMinutes = Math.floor((Date.now() - sessionStart) / 60000);
   * await installService.updatePlaytime(installation.id, sessionMinutes);
   * ```
   */
  updatePlaytime(
    installationId: string,
    additionalMinutes: number
  ): Promise<GameInstallation>;

  /**
   * Configure auto-update setting.
   *
   * @param installationId - The installation ID
   * @param enabled - Whether to enable auto-updates
   * @returns Updated installation
   *
   * @example
   * ```typescript
   * // User toggles auto-update in settings
   * await installService.setAutoUpdate(installation.id, true);
   * ```
   */
  setAutoUpdate(
    installationId: string,
    enabled: boolean
  ): Promise<GameInstallation>;

  /**
   * Get the latest build for a game on a platform.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns Latest build, or null if none available
   *
   * @example
   * ```typescript
   * const latestBuild = await installService.getLatestBuild(gameId, platformId);
   * if (latestBuild) {
   *   console.log(`Latest version: ${latestBuild.version}`);
   *   console.log(`Download size: ${formatBytes(latestBuild.sizeBytes)}`);
   * }
   * ```
   */
  getLatestBuild(gameId: string, platformId: string): Promise<GameBuild | null>;

  /**
   * List all builds for a game on a platform.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns All available builds
   *
   * @example
   * ```typescript
   * const builds = await installService.listGameBuilds(gameId, platformId);
   *
   * // Show version history
   * for (const build of builds) {
   *   console.log(`${build.version} - ${build.releaseDate}`);
   * }
   * ```
   */
  listGameBuilds(gameId: string, platformId: string): Promise<GameBuild[]>;

  /**
   * Check if an update is available.
   *
   * Compares installed version with latest build.
   *
   * @param installationId - The installation ID
   * @returns New build if update available, null otherwise
   *
   * @example
   * ```typescript
   * const update = await installService.checkForUpdates(installation.id);
   *
   * if (update) {
   *   showUpdateAvailable({
   *     currentVersion: installation.version,
   *     newVersion: update.version,
   *     downloadSize: update.sizeBytes,
   *   });
   * }
   * ```
   */
  checkForUpdates(installationId: string): Promise<GameBuild | null>;

  /**
   * Subscribe to installation events.
   *
   * @param userId - The player's user ID
   * @param callback - Function called on each event
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = installService.subscribeToEvents(userId, (event) => {
   *   switch (event.type) {
   *     case 'download_progress':
   *       updateProgressBar(event.progress);
   *       break;
   *     case 'install_complete':
   *       showNotification('Game ready to play!');
   *       break;
   *     case 'update_available':
   *       showUpdateBadge(event.game);
   *       break;
   *   }
   * });
   *
   * // Cleanup
   * window.addEventListener('beforeunload', unsubscribe);
   * ```
   */
  subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
