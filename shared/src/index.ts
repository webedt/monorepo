/**
 * Shared utilities and core business logic for WebEDT monorepo
 */

// =============================================================================
// TYPES - Shared type definitions
// =============================================================================
export type { SessionMetadata, StorageSessionInfo, AIProvider } from './types.js';

// =============================================================================
// UTILITIES - Logging, resilience, monitoring, helpers
// =============================================================================
export * from './utils/index.js';

// =============================================================================
// DOMAIN MODULES
// =============================================================================

// Authentication
export * from './auth/index.js';

// Configuration
export * from './config/index.js';

// Database
// Note: db/index.ts exports Session type (database session record)
export * from './db/index.js';

// Execution providers
export * from './execution/index.js';

// GitHub operations
export * from './github/index.js';

// Claude Web Sessions API
// Note: Exports Session type (API session) as ClaudeSession, SessionEvent as ClaudeSessionEvent
// to avoid conflicts with db/schema types
export { ClaudeWebClient, fetchEnvironmentIdFromSessions, generateTitle, generateTitleSync, ClaudeRemoteError, AClaudeWebClient } from './claudeWeb/index.js';
export type {
  ClaudeRemoteAuth,
  ClaudeRemoteClientConfig,
  CreateSessionParams,
  CreateSessionResult,
  Session as ClaudeSession,
  SessionStatus as ClaudeSessionStatus,
  SessionEvent as ClaudeSessionEvent,
  ToolUseInfo,
  MessageInfo,
  MessageContentBlock,
  ContentBlock as ClaudeContentBlock,
  EventsResponse,
  ListSessionsResponse,
  ResumeSessionParams,
  EventCallback,
  PollOptions,
  SessionResult,
  GitOutcomeInfo,
  GeneratedTitle,
  TitleGeneratorConfig,
  TitleGenerationEvent,
  TitleGenerationCallback,
} from './claudeWeb/index.js';

// Session management
// Note: Exports BroadcastEvent (renamed from SessionEvent) to avoid conflict with ClaudeSessionEvent
export * from './sessions/index.js';

// LLM - One-off LLM requests
export * from './llm/index.js';

// Organizations/Studios - Group accounts with multi-user support
export * from './organizations/index.js';

// Discovery - Task discovery and scanning
export * from './discovery/index.js';

// Code Analysis - AI-powered code analysis using ClaudeWebClient
export * from './codeAnalysis/index.js';

// Storage - User storage quota management
export * from './storage/index.js';

// =============================================================================
// SERVICES - Dependency injection and service registry
// =============================================================================
export * from './services/index.js';
