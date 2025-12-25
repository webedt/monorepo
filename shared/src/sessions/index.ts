/**
 * Session management module exports
 */

// Session lifecycle (ASession pattern)
export { ASession } from './ASession.js';
export { SessionService } from './SessionService.js';
export type {
  SessionExecuteParams,
  SessionResumeParams,
  SessionSyncParams,
  SessionResult,
  SessionInfo,
  SessionEventCallback,
} from './types.js';

// Abstract classes and types
export { ASessionEventBroadcaster, type BroadcastEvent, type SessionEvent as BroadcasterSessionEvent } from './ASessionEventBroadcaster.js';
export { ASessionListBroadcaster, type SessionUpdateType, type SessionListEvent } from './ASessionListBroadcaster.js';

// Implementations
export * from './claudeSessionSync.js';
export * from './sessionEventBroadcaster.js';
export * from './sessionListBroadcaster.js';
