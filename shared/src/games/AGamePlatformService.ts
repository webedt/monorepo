/**
 * Abstract Game Platform Service
 * Defines the interface for platform management
 */

import type { CreatePlatformRequest } from './types.js';
import type { CreateSystemRequirementsRequest } from './types.js';
import type { Platform } from './types.js';
import type { PlatformOS } from './types.js';
import type { SystemRequirements } from './types.js';

export abstract class AGamePlatformService {
  abstract createPlatform(
    request: CreatePlatformRequest
  ): Promise<Platform>;

  abstract getPlatform(
    platformId: string
  ): Promise<Platform | null>;

  abstract getPlatformByOsArch(
    os: PlatformOS,
    architecture: string
  ): Promise<Platform | null>;

  abstract listPlatforms(): Promise<Platform[]>;

  abstract listActivePlatforms(): Promise<Platform[]>;

  abstract updatePlatform(
    platformId: string,
    updates: Partial<CreatePlatformRequest>
  ): Promise<Platform>;

  abstract deactivatePlatform(
    platformId: string
  ): Promise<void>;

  abstract createSystemRequirements(
    request: CreateSystemRequirementsRequest
  ): Promise<SystemRequirements>;

  abstract getSystemRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements[]>;

  abstract getMinimumRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null>;

  abstract getRecommendedRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null>;

  abstract updateSystemRequirements(
    requirementsId: string,
    updates: Partial<CreateSystemRequirementsRequest>
  ): Promise<SystemRequirements>;

  abstract deleteSystemRequirements(
    requirementsId: string
  ): Promise<void>;

  abstract getGamePlatforms(
    gameId: string
  ): Promise<Platform[]>;

  abstract isGameAvailableOnPlatform(
    gameId: string,
    platformId: string
  ): Promise<boolean>;
}
