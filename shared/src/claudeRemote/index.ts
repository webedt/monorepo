/**
 * Claude Remote Sessions API Client
 *
 * Provides a TypeScript client for Anthropic's Remote Sessions API,
 * allowing execution of Claude Code tasks on Anthropic's infrastructure.
 */

export { ClaudeRemoteClient, fetchEnvironmentIdFromSessions } from './claudeRemoteClient.js';
export { generateTitle, generateTitleSync } from './titleGenerator.js';
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
  GeneratedTitle,
  TitleGeneratorConfig,
  TitleGenerationEvent,
  TitleGenerationCallback,
} from './types.js';
export { ClaudeRemoteError } from './types.js';
