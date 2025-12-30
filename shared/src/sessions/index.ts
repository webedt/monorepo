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

// Cleanup service
export { ASessionCleanupService, type CleanupResult } from './ASessionCleanupService.js';
export { SessionCleanupService, sessionCleanupService } from './SessionCleanupService.js';

// Trash cleanup service (automatic cleanup of old deleted sessions)
export { ATrashCleanupService, type TrashCleanupResult, type TrashCleanupSession } from './ATrashCleanupService.js';
export { TrashCleanupService, trashCleanupService } from './TrashCleanupService.js';

// Invitation cleanup service (automatic cleanup of expired organization invitations)
export { AInvitationCleanupService, type InvitationCleanupResult, type ExpiredInvitation } from './AInvitationCleanupService.js';
export { InvitationCleanupService, invitationCleanupService } from './InvitationCleanupService.js';

// Event storage service
export { AEventStorageService, type StoredEvent, type StoreEventResult } from './AEventStorageService.js';
export { EventStorageService, eventStorageService } from './EventStorageService.js';

// Query service
export {
  ASessionQueryService,
  type SessionQueryOptions,
  type SessionSearchOptions,
  type PaginatedResult,
  type SessionWithPreview,
} from './ASessionQueryService.js';
export { SessionQueryService, sessionQueryService } from './SessionQueryService.js';

// Authorization service
export {
  ASessionAuthorizationService,
  type AuthorizationResult,
  type ValidationResult,
  type CleanupConditions,
} from './ASessionAuthorizationService.js';
export { SessionAuthorizationService, sessionAuthorizationService } from './SessionAuthorizationService.js';

// Implementations
export * from './claudeSessionSync.js';
export * from './sessionEventBroadcaster.js';
export * from './sessionListBroadcaster.js';

// Session locking (optimistic and pessimistic locking for concurrent updates)
export {
  updateSessionWithOptimisticLock,
  lockSessionForUpdate,
  updateSessionStatusWithLock,
  getSessionWithVersion,
  isValidStatusTransition,
  isVersionConflict,
  isSessionNotFound,
  isInvalidStatusTransition,
  isSessionLocked,
  VersionConflictError,
  SessionNotFoundError,
  InvalidStatusTransitionError,
  SessionLockedError,
} from './sessionLocking.js';
export type {
  SessionStatus,
  SessionStatusUpdate,
  OptimisticUpdateResult,
} from './sessionLocking.js';
