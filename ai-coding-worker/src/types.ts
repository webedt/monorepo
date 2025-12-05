// Request/Response types for unified API

/**
 * Image block for user messages
 * Supports base64-encoded images in various formats
 */
export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string; // base64-encoded image data
  };
}

/**
 * Text block for user messages
 */
export interface TextBlock {
  type: 'text';
  text: string;
}

/**
 * User request content - can be simple string or structured with images
 */
export type UserRequestContent = string | Array<TextBlock | ImageBlock>;

export interface ExecuteRequest {
  // Required fields
  userRequest: UserRequestContent;
  codingAssistantProvider: string;
  codingAssistantAuthentication: string;

  // Optional: Website session ID (UUID)
  // For new sessions: undefined (will be generated)
  // For resuming: provide the UUID
  // This is separate from the provider's internal session ID (stored in metadata)
  websiteSessionId?: string;

  // Optional: GitHub integration
  github?: {
    repoUrl: string;
    branch?: string;
    directory?: string;
    accessToken?: string;
    refreshToken?: string;
  };

  // Optional: Database persistence
  database?: {
    accessToken: string; // Uses websiteSessionId for session identification
  };

  // Optional: Workspace configuration
  workspace?: {
    path?: string;
    environment?: string;
  };

  // Optional: Provider-specific options
  providerOptions?: {
    skipPermissions?: boolean;
    model?: string;
    [key: string]: any;
  };
}

// SSE Event types
export type EventSource = 'ai-coding-worker' | 'github-worker' | 'storage-worker' | 'claude-agent-sdk' | 'codex-sdk';

export interface SSEEvent {
  type: string;
  timestamp: string;
  source?: EventSource;
  [key: string]: any;
}

export interface ConnectedEvent extends SSEEvent {
  type: 'connected';
  sessionId: string;
  resuming: boolean;
  resumedFrom?: string;
  provider: string;
}

export interface MessageEvent extends SSEEvent {
  type: 'message';
  message: string;
}

export interface GitHubPullProgressEvent extends SSEEvent {
  type: 'github_pull_progress';
  data: {
    type: 'message' | 'completed';
    message?: string;
    targetPath?: string;
  };
}

export interface BranchCreatedEvent extends SSEEvent {
  type: 'branch_created';
  branchName: string;
  baseBranch: string;
  sessionPath: string;
  message: string;
}

export interface SessionNameEvent extends SSEEvent {
  type: 'session_name';
  sessionName: string;
  branchName?: string;
}

export interface AssistantMessageEvent extends SSEEvent {
  type: 'assistant_message';
  content: any;
  model?: string;
}

export interface CompletedEvent extends SSEEvent {
  type: 'completed';
  sessionId: string;
  duration_ms: number;
}

export interface ErrorEvent extends SSEEvent {
  type: 'error';
  error: string;
  code?: string;
}

export interface CommitProgressEvent extends SSEEvent {
  type: 'commit_progress';
  stage: 'analyzing' | 'creating_branch' | 'generating_message' | 'committing' | 'committed' | 'pushing' | 'pushed' | 'push_failed' | 'completed';
  message: string;
  branch?: string;
  commitMessage?: string;
  commitHash?: string;
  error?: string;
}

// Error response types
export interface APIError {
  error: string;
  message: string;
  containerId?: string; // Optional container ID for debugging
  [key: string]: any;
}

// Internal orchestration context
export interface ExecutionContext {
  request: ExecuteRequest;
  sessionId: string;
  volumeName: string;
  workspacePath: string;
  startTime: number;
  provider: any; // Provider-specific client instance
}

// Session metadata stored in volume
export interface SessionMetadata {
  sessionId: string; // UUID primary identifier
  sessionPath?: string; // Format: {owner}/{repo}/{branch} - populated after branch creation
  sessionTitle?: string; // Human-readable session title - populated after generation
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string; // Working branch for this session - populated after branch creation
  providerSessionId?: string; // Internal provider session ID (e.g., Claude Code's session_id)
  provider: string;
  createdAt: string;
  updatedAt: string;
  github?: {
    repoUrl: string;
    baseBranch: string; // Parent branch from which the session was created
    clonedPath: string;
  };
}
