/**
 * Lifecycle Management Utilities
 *
 * This module provides utilities for managing resources and preventing memory leaks:
 * - ListenerManager: Track and clean up event listeners
 * - TimerManager: Track and clean up setTimeout/setInterval
 * - ShutdownRegistry: Register cleanup handlers for graceful shutdown
 */

export { ListenerManager, createListenerManager } from './listenerManager.js';
export type { IListenerManager } from './listenerManager.js';

export { TimerManager, createTimerManager } from './timerManager.js';
export type { ITimerManager } from './timerManager.js';

export { shutdownRegistry } from './shutdownRegistry.js';
export type { IShutdownRegistry } from './shutdownRegistry.js';
