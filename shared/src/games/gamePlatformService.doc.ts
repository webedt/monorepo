/**
 * Game Platform Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Game Platform Service.
 * The service manages supported platforms (Windows, macOS, Linux) and system
 * requirements for games.
 *
 * @see AGamePlatformService for the abstract base class
 * @see GamePlatformService for the implementation
 */

import type { CreatePlatformRequest } from './types.js';
import type { CreateSystemRequirementsRequest } from './types.js';
import type { Platform } from './types.js';
import type { PlatformOS } from './types.js';
import type { SystemRequirements } from './types.js';

export type { CreatePlatformRequest } from './types.js';
export type { CreateSystemRequirementsRequest } from './types.js';
export type { Platform } from './types.js';
export type { PlatformOS } from './types.js';
export type { SystemRequirements } from './types.js';

/**
 * Interface for Game Platform Service with full documentation.
 *
 * The Game Platform Service manages the platforms supported by the game store
 * and tracks system requirements for each game on each platform. This enables
 * platform-specific downloads and compatibility checking.
 *
 * ## Features
 *
 * - **Platform Management**: Define supported OS and architecture combinations
 * - **System Requirements**: Track minimum and recommended specs per game
 * - **Compatibility Checking**: Verify game availability on specific platforms
 * - **Multi-Platform Support**: Windows, macOS, Linux with x64/ARM variants
 *
 * ## Supported Platforms
 *
 * | OS | Architectures |
 * |----|--------------|
 * | windows | x64, arm64 |
 * | macos | x64, arm64 (Apple Silicon) |
 * | linux | x64, arm64 |
 *
 * ## Requirement Types
 *
 * Each game can have two requirement levels per platform:
 * - **Minimum**: Lowest specs to run the game
 * - **Recommended**: Specs for optimal experience
 *
 * ## Usage
 *
 * ```typescript
 * // Check if game supports the user's platform
 * const isAvailable = await platformService.isGameAvailableOnPlatform(
 *   gameId,
 *   platformId
 * );
 *
 * if (isAvailable) {
 *   const minReqs = await platformService.getMinimumRequirements(gameId, platformId);
 *   displaySystemRequirements(minReqs);
 * }
 * ```
 */
export interface IGamePlatformServiceDocumentation {
  /**
   * Create a new platform definition.
   *
   * @param request - Platform creation parameters
   * @param request.os - Operating system (windows, macos, linux)
   * @param request.architecture - CPU architecture (x64, arm64)
   * @param request.displayName - User-friendly platform name
   * @param request.iconUrl - URL to platform icon
   * @returns Created platform record
   *
   * @example
   * ```typescript
   * const platform = await platformService.createPlatform({
   *   os: 'windows',
   *   architecture: 'x64',
   *   displayName: 'Windows (64-bit)',
   *   iconUrl: 'https://cdn.example.com/icons/windows.svg',
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Apple Silicon Mac
   * await platformService.createPlatform({
   *   os: 'macos',
   *   architecture: 'arm64',
   *   displayName: 'macOS (Apple Silicon)',
   *   iconUrl: 'https://cdn.example.com/icons/macos.svg',
   * });
   * ```
   */
  createPlatform(request: CreatePlatformRequest): Promise<Platform>;

  /**
   * Get a platform by ID.
   *
   * @param platformId - The platform ID
   * @returns Platform if found, null otherwise
   *
   * @example
   * ```typescript
   * const platform = await platformService.getPlatform('plat-123');
   * console.log(`${platform?.displayName}`);
   * ```
   */
  getPlatform(platformId: string): Promise<Platform | null>;

  /**
   * Find a platform by OS and architecture.
   *
   * @param os - Operating system
   * @param architecture - CPU architecture
   * @returns Matching platform, or null if not found
   *
   * @example
   * ```typescript
   * // Detect user's platform
   * const userOS = detectOS(); // 'windows'
   * const userArch = detectArch(); // 'x64'
   *
   * const platform = await platformService.getPlatformByOsArch(userOS, userArch);
   * if (platform) {
   *   showGamesForPlatform(platform.id);
   * }
   * ```
   */
  getPlatformByOsArch(os: PlatformOS, architecture: string): Promise<Platform | null>;

  /**
   * List all platforms.
   *
   * @returns All platform records
   *
   * @example
   * ```typescript
   * const platforms = await platformService.listPlatforms();
   * console.log(`Supporting ${platforms.length} platforms`);
   * ```
   */
  listPlatforms(): Promise<Platform[]>;

  /**
   * List only active platforms.
   *
   * Excludes deactivated platforms from the list.
   *
   * @returns Active platforms only
   *
   * @example
   * ```typescript
   * const platforms = await platformService.listActivePlatforms();
   * renderPlatformFilters(platforms);
   * ```
   */
  listActivePlatforms(): Promise<Platform[]>;

  /**
   * Update a platform.
   *
   * @param platformId - The platform ID to update
   * @param updates - Partial updates to apply
   * @returns Updated platform
   *
   * @example
   * ```typescript
   * const updated = await platformService.updatePlatform('plat-123', {
   *   displayName: 'Windows 11 (64-bit)',
   * });
   * ```
   */
  updatePlatform(
    platformId: string,
    updates: Partial<CreatePlatformRequest>
  ): Promise<Platform>;

  /**
   * Deactivate a platform.
   *
   * Deactivated platforms are hidden from the store but preserved
   * for existing installations.
   *
   * @param platformId - The platform ID to deactivate
   *
   * @example
   * ```typescript
   * // Discontinue 32-bit Windows support
   * await platformService.deactivatePlatform('plat-windows-x86');
   * ```
   */
  deactivatePlatform(platformId: string): Promise<void>;

  /**
   * Create system requirements for a game on a platform.
   *
   * @param request - System requirements parameters
   * @param request.gameId - The game ID
   * @param request.platformId - The platform ID
   * @param request.type - 'minimum' or 'recommended'
   * @param request.os - OS version requirement
   * @param request.processor - CPU requirement
   * @param request.memory - RAM requirement (e.g., "8 GB")
   * @param request.graphics - GPU requirement
   * @param request.storage - Disk space requirement
   * @param request.additionalNotes - Other requirements
   * @returns Created system requirements
   *
   * @example
   * ```typescript
   * // Minimum requirements
   * await platformService.createSystemRequirements({
   *   gameId: 'game-123',
   *   platformId: 'plat-windows-x64',
   *   type: 'minimum',
   *   os: 'Windows 10 64-bit',
   *   processor: 'Intel Core i5-4460 / AMD FX-6300',
   *   memory: '8 GB RAM',
   *   graphics: 'NVIDIA GTX 760 / AMD Radeon R7 260x',
   *   storage: '50 GB available space',
   *   additionalNotes: 'SSD recommended',
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Recommended requirements
   * await platformService.createSystemRequirements({
   *   gameId: 'game-123',
   *   platformId: 'plat-windows-x64',
   *   type: 'recommended',
   *   os: 'Windows 10/11 64-bit',
   *   processor: 'Intel Core i7-8700K / AMD Ryzen 5 3600X',
   *   memory: '16 GB RAM',
   *   graphics: 'NVIDIA RTX 2070 / AMD RX 5700 XT',
   *   storage: '50 GB SSD',
   * });
   * ```
   */
  createSystemRequirements(
    request: CreateSystemRequirementsRequest
  ): Promise<SystemRequirements>;

  /**
   * Get all system requirements for a game on a platform.
   *
   * Returns both minimum and recommended if available.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns Array of system requirements (min and/or recommended)
   *
   * @example
   * ```typescript
   * const reqs = await platformService.getSystemRequirements(gameId, platformId);
   * const min = reqs.find(r => r.type === 'minimum');
   * const rec = reqs.find(r => r.type === 'recommended');
   * ```
   */
  getSystemRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements[]>;

  /**
   * Get minimum system requirements.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns Minimum requirements, or null if not set
   *
   * @example
   * ```typescript
   * const minReqs = await platformService.getMinimumRequirements(gameId, platformId);
   * if (minReqs) {
   *   displayRequirements('Minimum', minReqs);
   * }
   * ```
   */
  getMinimumRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null>;

  /**
   * Get recommended system requirements.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns Recommended requirements, or null if not set
   *
   * @example
   * ```typescript
   * const recReqs = await platformService.getRecommendedRequirements(gameId, platformId);
   * if (recReqs) {
   *   displayRequirements('Recommended', recReqs);
   * }
   * ```
   */
  getRecommendedRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null>;

  /**
   * Update system requirements.
   *
   * @param requirementsId - The requirements record ID
   * @param updates - Partial updates to apply
   * @returns Updated system requirements
   *
   * @example
   * ```typescript
   * const updated = await platformService.updateSystemRequirements('req-123', {
   *   memory: '16 GB RAM',
   *   graphics: 'NVIDIA RTX 3060 / AMD RX 6600',
   * });
   * ```
   */
  updateSystemRequirements(
    requirementsId: string,
    updates: Partial<CreateSystemRequirementsRequest>
  ): Promise<SystemRequirements>;

  /**
   * Delete system requirements.
   *
   * @param requirementsId - The requirements record ID to delete
   *
   * @example
   * ```typescript
   * await platformService.deleteSystemRequirements('req-123');
   * ```
   */
  deleteSystemRequirements(requirementsId: string): Promise<void>;

  /**
   * Get all platforms a game is available on.
   *
   * @param gameId - The game ID
   * @returns Platforms with builds for this game
   *
   * @example
   * ```typescript
   * const platforms = await platformService.getGamePlatforms(gameId);
   *
   * // Show platform icons on game page
   * for (const platform of platforms) {
   *   renderPlatformBadge(platform);
   * }
   * ```
   */
  getGamePlatforms(gameId: string): Promise<Platform[]>;

  /**
   * Check if a game is available on a specific platform.
   *
   * @param gameId - The game ID
   * @param platformId - The platform ID
   * @returns True if game has a build for this platform
   *
   * @example
   * ```typescript
   * const userPlatform = await platformService.getPlatformByOsArch('macos', 'arm64');
   *
   * if (await platformService.isGameAvailableOnPlatform(gameId, userPlatform.id)) {
   *   showPurchaseButton();
   * } else {
   *   showNotAvailableMessage('This game is not available for your platform');
   * }
   * ```
   */
  isGameAvailableOnPlatform(gameId: string, platformId: string): Promise<boolean>;
}
