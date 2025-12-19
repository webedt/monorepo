/**
 * API Client
 * Centralized API layer with path-based routing support
 */

/// <reference types="vite/client" />

import type {
  User,
  Session,
  Repository,
  Branch,
  TreeItem,
  FileContent,
  PullRequest,
  CommitResult,
  OrchestratorJob,
  OrchestratorCycle,
  OrchestratorTask,
  Provider,
  LandingPage,
  VerbosityLevel,
  ImageAiProvider,
  ImageAiKeys,
  GeminiAuth,
  ApiResponse,
  AdminStats,
} from '../types';

// Cached API base URL - computed once on first access
let cachedApiBaseUrl: string | null = null;

/**
 * Detect API base URL for path-based routing
 * Supports:
 *   /github/owner/repo/branch/...  (preview via /github prefix)
 *   /owner/repo/branch/...         (standard path-based)
 */
function getApiBaseUrl(): string {
  if (cachedApiBaseUrl !== null) {
    return cachedApiBaseUrl;
  }

  // If explicitly set via env var, use it
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envBaseUrl) {
    cachedApiBaseUrl = envBaseUrl;
    console.log('[API] Using env API_BASE_URL:', cachedApiBaseUrl);
    return cachedApiBaseUrl;
  }

  // Detect from current pathname for path-based routing
  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check for /github/owner/repo/branch/ pattern
  if (pathSegments[0] === 'github' && pathSegments.length >= 4) {
    cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
  } else {
    // Check if we're in a path-based deployment
    const appRoutes = [
      'login', 'register', 'session', 'sessions', 'agents', 'orchestrator',
      'trash', 'settings', 'admin', 'code', 'images', 'sound', 'scene-editor',
      'preview', 'library', 'community', 'item', 'store', 'quick-setup',
      'dashboard', 'landing', 'editor', 'image-editor', 'workspace'
    ];

    if (pathSegments.length >= 1 && !appRoutes.includes(pathSegments[0])) {
      // Standard format: /owner/repo/branch/...
      if (pathSegments.length >= 3) {
        cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
      } else {
        cachedApiBaseUrl = '';
      }
    } else {
      cachedApiBaseUrl = '';
    }
  }

  console.log('[API] Detected API_BASE_URL:', cachedApiBaseUrl);
  return cachedApiBaseUrl;
}

export { getApiBaseUrl };

// API Error interface
export interface ApiError {
  message: string;
  status: number;
  data?: unknown;
}

// Check if an error is an ApiError
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    'status' in error
  );
}

// API options type
interface FetchApiOptions extends Omit<RequestInit, 'body'> {
  body?: Record<string, unknown> | unknown[];
}

// Core fetch wrapper
async function fetchApi<T = unknown>(endpoint: string, options: FetchApiOptions = {}): Promise<T> {
  const { body, ...restOptions } = options;

  const config: RequestInit = {
    ...restOptions,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...restOptions.headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const fullUrl = `${getApiBaseUrl()}${endpoint}`;
  console.log(`[API] ${config.method || 'GET'} ${fullUrl}`);

  const response = await fetch(fullUrl, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[API] Error:`, error);
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// ============================================================================
// Auth API
// ============================================================================
export const authApi = {
  register: (email: string, password: string) =>
    fetchApi<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password },
    }),

  login: (email: string, password: string, rememberMe = false) =>
    fetchApi<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password, rememberMe },
    }),

  logout: () =>
    fetchApi('/api/auth/logout', { method: 'POST' }),

  getSession: () =>
    fetchApi<{ user: User | null }>('/api/auth/session'),
};

// ============================================================================
// GitHub API
// ============================================================================
export const githubApi = {
  connect: () => {
    window.location.href = `${getApiBaseUrl()}/api/github/oauth`;
  },

  getRepos: () =>
    fetchApi<{ repos: Repository[] }>('/api/github/repos'),

  getBranches: (owner: string, repo: string) =>
    fetchApi<{ branches: Branch[] }>(`/api/github/repos/${owner}/${repo}/branches`),

  createBranch: (owner: string, repo: string, data: { branchName: string; baseBranch: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches`, {
      method: 'POST',
      body: data,
    }),

  getTree: (owner: string, repo: string, branch: string, recursive = true) =>
    fetchApi<{ tree: TreeItem[] }>(`/api/github/repos/${owner}/${repo}/tree/${branch}?recursive=${recursive}`),

  getFileContent: (owner: string, repo: string, path: string, ref: string) =>
    fetchApi<FileContent>(`/api/github/repos/${owner}/${repo}/contents/${path}?ref=${ref}`),

  disconnect: () =>
    fetchApi('/api/github/disconnect', { method: 'POST' }),

  getPulls: (owner: string, repo: string, head?: string, base?: string) => {
    const params = new URLSearchParams();
    if (head) params.append('head', head);
    if (base) params.append('base', base);
    const queryString = params.toString();
    return fetchApi<{ pulls: PullRequest[] }>(`/api/github/repos/${owner}/${repo}/pulls${queryString ? `?${queryString}` : ''}`);
  },

  generatePRContent: (owner: string, repo: string, data: { head: string; base: string; userRequest?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/generate-pr-content`, {
      method: 'POST',
      body: data,
    }),

  createPull: (owner: string, repo: string, data: { title?: string; head: string; base: string; body?: string }) =>
    fetchApi<{ pull: PullRequest }>(`/api/github/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: data,
    }),

  mergePull: (owner: string, repo: string, pullNumber: number, data?: { merge_method?: string; commit_title?: string; commit_message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
      method: 'POST',
      body: data || {},
    }),

  deleteFile: (owner: string, repo: string, path: string, data: { branch: string; sha?: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      body: data,
    }),

  renameFile: (owner: string, repo: string, oldPath: string, data: { newPath: string; branch: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/rename/${oldPath}`, {
      method: 'POST',
      body: data,
    }),

  updateFile: (owner: string, repo: string, path: string, data: { content: string; branch: string; sha?: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: data,
    }),

  commit: (owner: string, repo: string, data: {
    branch: string;
    files?: Array<{ path: string; content: string; encoding?: string }>;
    images?: Array<{ path: string; content: string; beforeContent?: string }>;
    deletions?: string[];
    message?: string;
  }) =>
    fetchApi<CommitResult>(`/api/github/repos/${owner}/${repo}/commit`, {
      method: 'POST',
      body: data,
    }),
};

// ============================================================================
// User API
// ============================================================================
export const userApi = {
  updateClaudeAuth: (claudeAuth: { sessionKey?: string; organizationId?: string }) =>
    fetchApi('/api/user/claude-auth', {
      method: 'POST',
      body: { claudeAuth },
    }),

  removeClaudeAuth: () =>
    fetchApi('/api/user/claude-auth', { method: 'DELETE' }),

  updateCodexAuth: (codexAuth: { apiKey?: string }) =>
    fetchApi('/api/user/codex-auth', {
      method: 'POST',
      body: { codexAuth },
    }),

  removeCodexAuth: () =>
    fetchApi('/api/user/codex-auth', { method: 'DELETE' }),

  updateGeminiAuth: (geminiAuth: GeminiAuth) =>
    fetchApi('/api/user/gemini-auth', {
      method: 'POST',
      body: { geminiAuth },
    }),

  removeGeminiAuth: () =>
    fetchApi('/api/user/gemini-auth', { method: 'DELETE' }),

  updatePreferredProvider: (provider: Provider) =>
    fetchApi('/api/user/preferred-provider', {
      method: 'POST',
      body: { provider },
    }),

  updateImageResizeSetting: (maxDimension: number) =>
    fetchApi('/api/user/image-resize-setting', {
      method: 'POST',
      body: { maxDimension },
    }),

  updateDisplayName: (displayName: string) =>
    fetchApi('/api/user/display-name', {
      method: 'POST',
      body: { displayName },
    }),

  updateVoiceCommandKeywords: (keywords: string[]) =>
    fetchApi('/api/user/voice-command-keywords', {
      method: 'POST',
      body: { keywords },
    }),

  updateStopListeningAfterSubmit: (stopAfterSubmit: boolean) =>
    fetchApi('/api/user/stop-listening-after-submit', {
      method: 'POST',
      body: { stopAfterSubmit },
    }),

  updateDefaultLandingPage: (landingPage: LandingPage) =>
    fetchApi('/api/user/default-landing-page', {
      method: 'POST',
      body: { landingPage },
    }),

  updatePreferredModel: (preferredModel: string) =>
    fetchApi('/api/user/preferred-model', {
      method: 'POST',
      body: { preferredModel },
    }),

  updateChatVerbosity: (verbosityLevel: VerbosityLevel) =>
    fetchApi('/api/user/chat-verbosity', {
      method: 'POST',
      body: { verbosityLevel },
    }),

  updateImageAiKeys: (imageAiKeys: ImageAiKeys) =>
    fetchApi('/api/user/image-ai-keys', {
      method: 'POST',
      body: { imageAiKeys },
    }),

  updateImageAiProvider: (provider: ImageAiProvider) =>
    fetchApi('/api/user/image-ai-provider', {
      method: 'POST',
      body: { provider },
    }),

  updateImageAiModel: (model: string) =>
    fetchApi('/api/user/image-ai-model', {
      method: 'POST',
      body: { model },
    }),

  updateOpenRouterApiKey: (apiKey: string) =>
    fetchApi('/api/user/openrouter-api-key', {
      method: 'POST',
      body: { apiKey },
    }),

  removeOpenRouterApiKey: () =>
    fetchApi('/api/user/openrouter-api-key', { method: 'DELETE' }),

  updateAutocompleteSettings: (settings: { enabled?: boolean; model?: string }) =>
    fetchApi('/api/user/autocomplete-settings', {
      method: 'POST',
      body: settings,
    }),
};

// ============================================================================
// Sessions API
// ============================================================================
export const sessionsApi = {
  list: () =>
    fetchApi<{ sessions: Session[] }>('/api/sessions'),

  listDeleted: (params?: { limit?: number; offset?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.offset) queryParams.append('offset', String(params.offset));
    const queryString = queryParams.toString();
    return fetchApi<{ sessions: Session[] }>(`/api/sessions/deleted${queryString ? `?${queryString}` : ''}`);
  },

  get: (id: string) =>
    fetchApi<{ session: Session }>(`/api/sessions/${id}`),

  getMessages: (id: string) =>
    fetchApi(`/api/sessions/${id}/messages`),

  getEvents: (id: string) =>
    fetchApi(`/api/sessions/${id}/events`),

  createMessage: (id: string, type: string, content: string) =>
    fetchApi(`/api/sessions/${id}/messages`, {
      method: 'POST',
      body: { type, content },
    }),

  createEvent: (id: string, eventData: unknown) =>
    fetchApi(`/api/sessions/${id}/events`, {
      method: 'POST',
      body: { eventData },
    }),

  update: (id: string, data: { userRequest?: string; branch?: string }) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  delete: (id: string) =>
    fetchApi(`/api/sessions/${id}`, { method: 'DELETE' }),

  deleteBulk: (ids: string[]) =>
    fetchApi('/api/sessions/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  restore: (id: string) =>
    fetchApi(`/api/sessions/${id}/restore`, { method: 'POST' }),

  restoreBulk: (ids: string[]) =>
    fetchApi('/api/sessions/bulk-restore', {
      method: 'POST',
      body: { ids },
    }),

  deletePermanentBulk: (ids: string[]) =>
    fetchApi('/api/sessions/bulk-delete-permanent', {
      method: 'POST',
      body: { ids },
    }),

  createCodeSession: (data: {
    title?: string;
    repositoryUrl?: string;
    repositoryOwner: string;
    repositoryName: string;
    baseBranch: string;
    branch: string;
  }) =>
    fetchApi<{ session: Session }>('/api/sessions/create-code-session', {
      method: 'POST',
      body: data,
    }),

  getStreamUrl: (id: string) =>
    `${getApiBaseUrl()}/api/sessions/${id}/events/stream`,

  checkStreamActive: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${id}/events/stream`, {
        method: 'HEAD',
        credentials: 'include',
      });
      return response.status === 200;
    } catch {
      return false;
    }
  },

  abort: (id: string) =>
    fetchApi(`/api/sessions/${id}/abort`, { method: 'POST' }),

  sendMessage: (id: string, content: string, images?: Array<{ data: string; mediaType: string }>) =>
    fetchApi<{ success: boolean; error?: string }>(`/api/sessions/${id}/send`, {
      method: 'POST',
      body: { content, images },
    }),

  initializeRepository: (id: string) =>
    fetchApi(`/api/sessions/${id}/init-repository`, { method: 'POST' }),

  sync: (params?: { activeOnly?: boolean; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.activeOnly !== undefined) queryParams.append('activeOnly', String(params.activeOnly));
    if (params?.limit) queryParams.append('limit', String(params.limit));
    const queryString = queryParams.toString();
    return fetchApi(`/api/sessions/sync${queryString ? `?${queryString}` : ''}`, { method: 'POST' });
  },

  syncEvents: (id: string) =>
    fetchApi(`/api/sessions/${id}/sync-events`, { method: 'POST' }),
};

// ============================================================================
// Admin API
// ============================================================================
export const adminApi = {
  listUsers: () =>
    fetchApi<{ users: User[] }>('/api/admin/users'),

  getUser: (id: string) =>
    fetchApi<{ user: User }>(`/api/admin/users/${id}`),

  createUser: (data: { email: string; displayName?: string; password: string; isAdmin?: boolean }) =>
    fetchApi<{ user: User }>('/api/admin/users', {
      method: 'POST',
      body: data,
    }),

  updateUser: (id: string, data: { email?: string; displayName?: string; isAdmin?: boolean; password?: string }) =>
    fetchApi(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  deleteUser: (id: string) =>
    fetchApi(`/api/admin/users/${id}`, { method: 'DELETE' }),

  impersonateUser: (id: string) =>
    fetchApi(`/api/admin/users/${id}/impersonate`, { method: 'POST' }),

  getStats: () =>
    fetchApi<ApiResponse<AdminStats>>('/api/admin/stats'),

  getLogs: (params?: { level?: string; component?: string; sessionId?: string; since?: string; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.level) queryParams.append('level', params.level);
    if (params?.component) queryParams.append('component', params.component);
    if (params?.sessionId) queryParams.append('sessionId', params.sessionId);
    if (params?.since) queryParams.append('since', params.since);
    if (params?.limit) queryParams.append('limit', String(params.limit));
    const queryString = queryParams.toString();
    return fetchApi(`/api/logs${queryString ? `?${queryString}` : ''}`);
  },

  clearLogs: () =>
    fetchApi('/api/logs', { method: 'DELETE' }),

  getLogsStatus: () =>
    fetchApi('/api/logs/status'),
};

// ============================================================================
// Live Chat API (branch-based workspace chat)
// ============================================================================
export const liveChatApi = {
  getMessages: (owner: string, repo: string, branch: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages${queryString ? `?${queryString}` : ''}`);
  },

  addMessage: (owner: string, repo: string, branch: string, data: {
    role: 'user' | 'assistant';
    content: string;
    images?: Array<{ id: string; data: string; mediaType: string; fileName?: string }>;
  }) =>
    fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages`, {
      method: 'POST',
      body: data,
    }),

  clearMessages: (owner: string, repo: string, branch: string) =>
    fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages`, { method: 'DELETE' }),

  getExecuteUrl: (owner: string, repo: string, branch: string) =>
    `${getApiBaseUrl()}/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/execute`,

  createExecuteEventSource: (owner: string, repo: string, branch: string, data: {
    message: string;
    images?: Array<{ id: string; data: string; mediaType: string; fileName?: string }>;
  }) => {
    const params = new URLSearchParams();
    params.append('message', data.message);
    if (data.images) {
      params.append('images', JSON.stringify(data.images));
    }
    const fullUrl = `${getApiBaseUrl()}/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/execute?${params}`;
    return new EventSource(fullUrl, { withCredentials: true });
  },
};

// ============================================================================
// Orchestrator API
// ============================================================================
export interface CreateOrchestratorJobRequest {
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch?: string;
  requestDocument: string;
  initialTaskList?: string;
  maxCycles?: number;
  timeLimitMinutes?: number;
  maxParallelTasks?: number;
  provider?: 'claude' | 'claude-remote';
  autoStart?: boolean;
}

export const orchestratorApi = {
  create: (data: CreateOrchestratorJobRequest) =>
    fetchApi<ApiResponse<OrchestratorJob>>('/api/orchestrator', {
      method: 'POST',
      body: data as unknown as Record<string, unknown>,
    }),

  list: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<ApiResponse<OrchestratorJob[]>>(`/api/orchestrator${queryString ? `?${queryString}` : ''}`);
  },

  get: (id: string) =>
    fetchApi<ApiResponse<OrchestratorJob & { cycles: OrchestratorCycle[] }>>(`/api/orchestrator/${id}`),

  start: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/start`, { method: 'POST' }),

  pause: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/pause`, { method: 'POST' }),

  resume: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/resume`, { method: 'POST' }),

  cancel: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/cancel`, { method: 'POST' }),

  getCycles: (id: string) =>
    fetchApi<ApiResponse<OrchestratorCycle[]>>(`/api/orchestrator/${id}/cycles`),

  getCycle: (jobId: string, cycleNumber: number) =>
    fetchApi<ApiResponse<OrchestratorCycle & { tasks: OrchestratorTask[] }>>(`/api/orchestrator/${jobId}/cycles/${cycleNumber}`),

  updateRequestDocument: (id: string, requestDocument: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/request`, {
      method: 'PUT',
      body: { requestDocument },
    }),

  updateTaskList: (id: string, taskList: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/orchestrator/${id}/tasklist`, {
      method: 'PUT',
      body: { taskList },
    }),

  getStreamUrl: (id: string) =>
    `${getApiBaseUrl()}/api/orchestrator/${id}/stream`,

  createEventSource: (id: string) => {
    const url = `${getApiBaseUrl()}/api/orchestrator/${id}/stream`;
    return new EventSource(url, { withCredentials: true });
  },
};

// ============================================================================
// Execute Remote API (Claude Remote Sessions - SSE)
// ============================================================================
export function createExecuteRemoteEventSource(data: {
  userRequest: string;
  provider?: string;
  github?: { repoUrl: string };
  autoCommit?: boolean;
  websiteSessionId?: string;
}): EventSource {
  const params = new URLSearchParams();
  if (data.userRequest !== undefined) {
    params.append('userRequest', String(data.userRequest));
  }
  if (data.websiteSessionId !== undefined) {
    params.append('websiteSessionId', String(data.websiteSessionId));
  }
  if (data.github) {
    params.append('github', JSON.stringify(data.github));
  }
  const fullUrl = `${getApiBaseUrl()}/api/execute-remote?${params}`;
  console.log('[API] Creating Claude Remote EventSource:', fullUrl);
  return new EventSource(fullUrl, { withCredentials: true });
}
