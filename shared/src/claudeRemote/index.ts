/**
 * Claude Remote Sessions API Client
 *
 * Provides a TypeScript client for Anthropic's Remote Sessions API,
 * allowing execution of Claude Code tasks on Anthropic's infrastructure.
 */

export { ClaudeRemoteClient } from './claudeRemoteClient.js';
export type {
  ClaudeAuth,
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session,
  SessionStatus,
  SessionEvent,
  SessionEventType,
  ContentBlock,
  EventsResponse,
  ResumeSessionParams,
  EventCallback,
  PollOptions,
  SessionResult,
  GitOutcomeInfo,
} from './types.js';
export { ClaudeRemoteError } from './types.js';
