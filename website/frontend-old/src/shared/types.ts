// Chat verbosity level type
export type ChatVerbosityLevel = 'minimal' | 'normal' | 'verbose';

// Image AI provider types
export type ImageAiProvider = 'openrouter' | 'cometapi' | 'google';

// Image AI keys type
export interface ImageAiKeys {
  openrouter?: string;
  cometapi?: string;
  google?: string;
}

// User types
export interface User {
  id: string;
  email: string;
  displayName?: string | null;
  githubId: string | null;
  githubAccessToken: string | null;
  claudeAuth: ClaudeAuth | null;
  codexAuth: CodexAuth | null;           // OpenAI Codex credentials
  geminiAuth: GeminiAuth | null;         // Gemini OAuth credentials
  preferredProvider: AIProvider;          // User's preferred AI provider
  imageResizeMaxDimension: number;
  voiceCommandKeywords: string[];
  stopListeningAfterSubmit: boolean;
  defaultLandingPage: 'dashboard' | 'store' | 'library' | 'community' | 'sessions';
  preferredModel?: string | null;
  chatVerbosityLevel: ChatVerbosityLevel; // Controls how much detail to show in chat
  imageAiProvider?: ImageAiProvider;      // User's preferred image AI provider
  imageAiModel?: string;                  // User's preferred image AI model
  imageAiKeys?: ImageAiKeys;              // API keys for image AI providers
  // Autocomplete settings
  openrouterApiKey?: string | null;       // OpenRouter API key for autocomplete
  autocompleteEnabled?: boolean;          // Whether autocomplete is enabled
  autocompleteModel?: string;             // Preferred autocomplete model
  isAdmin: boolean;
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

// OpenAI/Codex authentication
export interface CodexAuth {
  apiKey?: string;           // For API key auth (OPENAI_API_KEY)
  accessToken?: string;      // For ChatGPT subscription OAuth
  refreshToken?: string;
  expiresAt?: number;
}

// Gemini OAuth authentication (for Gemini CLI)
export interface GeminiAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scope?: string;
}

// Union type for provider authentication
export type ProviderAuth = ClaudeAuth | CodexAuth | GeminiAuth;

// Provider types
export type AIProvider = 'claude' | 'codex' | 'gemini' | 'claude-remote';

// Session types
export interface ChatSession {
  id: string;
  userId: string;
  aiWorkerSessionId: string | null;
  sessionPath: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  userRequest: string;
  status: SessionStatus;
  repositoryUrl: string | null;
  baseBranch: string | null;
  branch: string | null;
  autoCommit: boolean;
  locked: boolean;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
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
  chatSessionId: string;
  type: MessageType;
  content: string;
  images?: ImageAttachment[] | null;
  timestamp: Date;
  model?: string;
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

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  mergeable: boolean | null;
  merged: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutoPRResult {
  step: string;
  pr?: { number: number; htmlUrl: string };
  mergeBase?: { sha: string | null; message: string };
  mergePr?: { merged: boolean; sha: string };
}

// AI Worker types (from API.md)
export interface ExecuteRequest {
  userRequest: string;
  codingAssistantProvider: 'ClaudeAgentSDK' | 'Codex';
  codingAssistantAuthentication: ProviderAuth;  // Claude or Codex auth
  websiteSessionId?: string;
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

// .webedt configuration types
export interface WebedtConfig {
  preview_url?: string;
  [key: string]: any;
}
