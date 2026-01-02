/**
 * API Utilities
 *
 * Shared utilities for route handlers.
 */

export {
  setupSSEResponse,
  writeSSEHeaders,
  onClientDisconnect,
  createDisconnectTracker,
  createSSEWriter,
  createSSEWriterWithDisconnect,
  createHeartbeat,
} from './sseHandler.js';

export type {
  SSESetupOptions,
  SSEWriterWithDisconnectOptions,
} from './sseHandler.js';
