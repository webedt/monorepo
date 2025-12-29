/**
 * Lifecycle Management Utilities
 *
 * This module provides utilities for managing resources and preventing memory leaks:
 * - ListenerManager: Track and clean up event listeners on EventEmitters
 * - TimerManager: Track and clean up setTimeout/setInterval timers
 * - ShutdownRegistry: Register cleanup handlers for graceful shutdown
 *
 * These utilities are designed for use in new code where structured cleanup is needed.
 * Existing code may use manual cleanup patterns (removeAllListeners, clearInterval, etc.)
 * which are equally valid. The choice depends on complexity and code organization needs.
 *
 * Example use cases:
 * - ListenerManager: Services that register multiple listeners across different emitters
 * - TimerManager: Background tasks with multiple coordinated timers
 * - ShutdownRegistry: CLI tools and services needing simple shutdown coordination
 *   (Note: The backend uses gracefulShutdown.ts for HTTP-specific shutdown concerns)
 */

export { ListenerManager, createListenerManager } from './listenerManager.js';
export type { IListenerManager } from './listenerManager.js';

export { TimerManager, createTimerManager } from './timerManager.js';
export type { ITimerManager } from './timerManager.js';

export { shutdownRegistry } from './shutdownRegistry.js';
export type { IShutdownRegistry } from './shutdownRegistry.js';
