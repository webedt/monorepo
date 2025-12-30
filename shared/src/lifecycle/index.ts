/**
 * Lifecycle Management
 *
 * Provides coordinated startup and shutdown of background services.
 */

export { AShutdownManager } from './AShutdownManager.js';
export { shutdownManager, createShutdownHandler, ShutdownPriority } from './shutdownManager.js';

export type {
  IShutdownHandler,
  ShutdownResult,
  HandlerResult,
  ShutdownManagerConfig,
  ShutdownManagerStats,
} from './shutdownManager.js';
