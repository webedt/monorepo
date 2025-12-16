/**
 * Shared utilities for WebEDT monorepo
 */

// Types
export type { SessionMetadata, StorageSessionInfo, AIProvider } from './types.js';

// Logger
export { logger } from './logger.js';
export type { LogContext } from './logger.js';

// Emoji Mapper
export { getEventEmoji, applyEmoji } from './emojiMapper.js';

// Session Path Helper
export {
  parseRepoUrl,
  generateSessionPath,
  parseSessionPath,
  sessionPathToDir,
  validateSessionPath,
} from './sessionPathHelper.js';

// Preview URL Helper
export {
  getPreviewUrl,
  getPreviewUrlFromSession,
  hasWebedtFile,
  readWebedtConfig,
} from './previewUrlHelper.js';
export type { WebedtConfig } from './previewUrlHelper.js';

// Claude Remote Sessions API
export { ClaudeRemoteClient, ClaudeRemoteError, fetchEnvironmentIdFromSessions } from './claudeRemote/index.js';
export type {
  ClaudeAuth,
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session as ClaudeSession,
  SessionStatus as ClaudeSessionStatus,
  SessionEvent,
  SessionEventType,
  EventsResponse,
  EventCallback,
  PollOptions,
  SessionResult,
} from './claudeRemote/index.js';
