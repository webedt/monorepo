// User types
export interface User {
  id: number;
  email: string;
  githubId: string | null;
  githubAccessToken: string | null;
  claudeAuth: ClaudeAuth | null;
  imageResizeMaxDimension: number;
  createdAt: Date;
}

export interface ClaudeAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType: string;
  rateLimitTier: string;
}

// Session types
export interface ChatSession {
  id: number;
  userId: number;
  aiWorkerSessionId: string | null;
  userRequest: string;
  status: SessionStatus;
  repositoryUrl: string | null;
  branch: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'error';

// Message types
export interface ImageAttachment {
  id: string;
  data: string; // base64 data
  mediaType: string;
  fileName: string;
}

export interface Message {
  id: number;
  chatSessionId: number;
  type: MessageType;
  content: string;
  images?: ImageAttachment[] | null;
  timestamp: Date;
}

export type MessageType = 'user' | 'assistant' | 'system' | 'error';

// GitHub types
export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
  commit: {
    sha: string;
    url: string;
  };
}

// AI Worker types (from API.md)
export interface ExecuteRequest {
  userRequest: string;
  codingAssistantProvider: 'ClaudeAgentSDK' | 'Codex';
  codingAssistantAuthentication: ClaudeAuth;
  resumeSessionId?: string;
  github?: {
    repoUrl: string;
    branch?: string;
    accessToken: string;
  };
  database?: {
    type: string;
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  providerOptions?: Record<string, any>;
}

export interface SSEEvent {
  event: string;
  data: any;
}

export type SSEEventType =
  | 'connected'
  | 'message'
  | 'assistant_message'
  | 'github_pull_progress'
  | 'commit_progress'
  | 'completed'
  | 'error';

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface AuthResponse {
  user: User;
  sessionId: string;
}

export interface SessionListResponse {
  sessions: ChatSession[];
  total: number;
}

export interface MessageListResponse {
  messages: Message[];
  total: number;
}
