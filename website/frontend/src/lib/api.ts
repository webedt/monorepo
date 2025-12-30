/**
 * API Client
 * Centralized API layer with path-based routing support
 */

/// <reference types="vite/client" />

import {
  extractApiErrorMessage,
} from '../types';
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
  Collection,
  SessionCollection,
  Snippet,
  SnippetCollection,
  SnippetLanguage,
  SnippetCategory,
  CreateSnippetRequest,
  UpdateSnippetRequest,
  SnippetListFilters,
} from '../types';

// Cached API base URL - computed once on first access
let cachedApiBaseUrl: string | null = null;

// CSRF token constants (must match backend)
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

// HTTP methods that require CSRF protection
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Get CSRF token from cookie
 * The backend sets this cookie automatically on first request
 */
function getCsrfTokenFromCookie(): string | null {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

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
  const method = (restOptions.method || 'GET').toUpperCase();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(restOptions.headers as Record<string, string>),
  };

  // Add CSRF token for state-changing requests
  if (CSRF_PROTECTED_METHODS.has(method)) {
    const csrfToken = getCsrfTokenFromCookie();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    } else {
      // Log warning - token should be set by server on first response
      // If missing, the request may fail with 403 unless it's an exempt endpoint
      console.warn(`[API] CSRF token missing for ${method} request to ${endpoint}. Request may fail.`);
    }
  }

  const config: RequestInit = {
    ...restOptions,
    method,
    credentials: 'include',
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const fullUrl = `${getApiBaseUrl()}${endpoint}`;
  console.log(`[API] ${method} ${fullUrl}`);

  const response = await fetch(fullUrl, config);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[API] Error:`, errorBody);
    throw new Error(extractApiErrorMessage(errorBody));
  }

  return response.json();
}

// ============================================================================
// Auth API
// ============================================================================
export const authApi = {
  register: (email: string, password: string) =>
    fetchApi<ApiResponse<{ user: User }>>('/api/auth/register', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password },
    }).then(r => r.data),

  login: (email: string, password: string, rememberMe = false) =>
    fetchApi<ApiResponse<{ user: User }>>('/api/auth/login', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password, rememberMe },
    }).then(r => r.data),

  logout: () =>
    fetchApi('/api/auth/logout', { method: 'POST' }),

  getSession: () =>
    fetchApi<ApiResponse<{ user: User | null }>>('/api/auth/session').then(r => r.data),

  /**
   * Fetch CSRF token from server
   * This is called automatically on first API request, but can be called
   * manually to ensure a token is available before making requests
   */
  getCsrfToken: () =>
    fetchApi<ApiResponse<{ csrfToken: string; headerName: string }>>('/api/auth/csrf-token')
      .then(r => r.data),
};

// ============================================================================
// GitHub API
// ============================================================================
export const githubApi = {
  connect: () => {
    window.location.href = `${getApiBaseUrl()}/api/github/oauth`;
  },

  getRepos: () =>
    fetchApi<ApiResponse<Repository[]>>('/api/github/repos').then(r => ({ repos: r.data || [] })),

  getBranches: (owner: string, repo: string) =>
    fetchApi<ApiResponse<Branch[]>>(`/api/github/repos/${owner}/${repo}/branches`).then(r => ({ branches: r.data || [] })),

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

  getSpendingLimits: () =>
    fetchApi<ApiResponse<{
      enabled: boolean;
      monthlyBudgetCents: string;
      perTransactionLimitCents: string;
      resetDay: number;
      currentMonthSpentCents: string;
      remainingBudgetCents: string;
      usagePercent: number;
      limitAction: string;
      lastResetAt: string | null;
    }>>('/api/user/spending-limits').then(r => r.data),

  updateSpendingLimits: (config: {
    enabled?: boolean;
    monthlyBudgetCents?: number;
    perTransactionLimitCents?: number;
    resetDay?: number;
    limitAction?: 'warn' | 'block';
  }) =>
    fetchApi('/api/user/spending-limits', {
      method: 'POST',
      body: config,
    }),

  resetMonthlySpending: () =>
    fetchApi('/api/user/spending-limits/reset', {
      method: 'POST',
    }),
};

// ============================================================================
// Sessions API
// ============================================================================
export const sessionsApi = {
  list: () =>
    fetchApi<ApiResponse<{ sessions: Session[] }>>('/api/sessions')
      .then(r => r.data!),

  search: (params: {
    q: string;
    limit?: number;
    offset?: number;
    status?: string;
    favorite?: boolean;
  }) => {
    const queryParams = new URLSearchParams();
    queryParams.append('q', params.q);
    if (params.limit) queryParams.append('limit', String(params.limit));
    if (params.offset) queryParams.append('offset', String(params.offset));
    if (params.status) queryParams.append('status', params.status);
    if (params.favorite !== undefined) queryParams.append('favorite', String(params.favorite));
    return fetchApi<ApiResponse<{
      sessions: Session[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
      query: string;
    }>>(`/api/sessions/search?${queryParams.toString()}`)
      .then(r => r.data!);
  },

  listDeleted: (params?: { limit?: number; offset?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.offset) queryParams.append('offset', String(params.offset));
    const queryString = queryParams.toString();
    return fetchApi<ApiResponse<{ sessions: Session[] }>>(`/api/sessions/deleted${queryString ? `?${queryString}` : ''}`)
      .then(r => r.data!);
  },

  get: (id: string) =>
    fetchApi<{ success: boolean; session: Session }>(`/api/sessions/${id}`),

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

  interrupt: (id: string) =>
    fetchApi<{ success: boolean; error?: string; data?: { sessionId: string; interrupted: boolean; wasActive: boolean } }>(
      `/api/internal/sessions/${id}/interrupt`,
      { method: 'POST' }
    ),

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

  toggleFavorite: (id: string) =>
    fetchApi<{ success: boolean; session: Session }>(`/api/sessions/${id}/favorite`, { method: 'POST' }),
};

// ============================================================================
// Collections API
// ============================================================================
export const collectionsApi = {
  list: () =>
    fetchApi<ApiResponse<{ collections: Collection[]; total: number }>>('/api/collections')
      .then(r => r.data!),

  get: (id: string) =>
    fetchApi<ApiResponse<{ collection: Collection }>>(`/api/collections/${id}`)
      .then(r => r.data!),

  create: (data: { name: string; description?: string; color?: string; icon?: string; isDefault?: boolean }) =>
    fetchApi<ApiResponse<{ collection: Collection }>>('/api/collections', {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  update: (id: string, data: { name?: string; description?: string; color?: string; icon?: string; sortOrder?: number; isDefault?: boolean }) =>
    fetchApi<ApiResponse<{ collection: Collection }>>(`/api/collections/${id}`, {
      method: 'PATCH',
      body: data,
    }).then(r => r.data!),

  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/api/collections/${id}`, { method: 'DELETE' }),

  getSessions: (id: string) =>
    fetchApi<ApiResponse<{ collection: Collection; sessions: Session[]; total: number }>>(`/api/collections/${id}/sessions`)
      .then(r => r.data!),

  addSession: (collectionId: string, sessionId: string) =>
    fetchApi<ApiResponse<{ membership: SessionCollection }>>(`/api/collections/${collectionId}/sessions/${sessionId}`, {
      method: 'POST',
    }).then(r => r.data!),

  removeSession: (collectionId: string, sessionId: string) =>
    fetchApi<{ success: boolean }>(`/api/collections/${collectionId}/sessions/${sessionId}`, { method: 'DELETE' }),

  getSessionCollections: (sessionId: string) =>
    fetchApi<ApiResponse<{ collections: Collection[]; total: number }>>(`/api/collections/session/${sessionId}`)
      .then(r => r.data!),

  bulkAddSession: (sessionId: string, collectionIds: string[]) =>
    fetchApi<ApiResponse<{ added: number }>>(`/api/collections/session/${sessionId}/bulk`, {
      method: 'POST',
      body: { collectionIds },
    }).then(r => r.data!),

  reorder: (orderedIds: string[]) =>
    fetchApi<{ success: boolean }>('/api/collections/reorder', {
      method: 'POST',
      body: { orderedIds },
    }),
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
  provider?: 'claude';
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

/**
 * Create an EventSource for executing a pending session
 * This starts the AI agent on the session
 */
export function createSessionExecuteEventSource(session: {
  id: string;
  userRequest?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
}): EventSource {
  const params = new URLSearchParams();
  params.append('websiteSessionId', session.id);
  if (session.userRequest) {
    params.append('userRequest', session.userRequest);
  }
  if (session.repositoryOwner && session.repositoryName) {
    params.append('github', JSON.stringify({
      repoUrl: `https://github.com/${session.repositoryOwner}/${session.repositoryName}`,
    }));
  }
  const fullUrl = `${getApiBaseUrl()}/api/execute-remote?${params}`;
  console.log('[API] Creating Session Execute EventSource:', fullUrl);
  return new EventSource(fullUrl, { withCredentials: true });
}

// ============================================================================
// Storage Worker API (File operations)
// ============================================================================
export const storageWorkerApi = {
  listFiles: (sessionPath: string) =>
    fetchApi<{ files: string[] }>(`/api/storage/sessions/${sessionPath}/files`),

  getFileText: async (sessionPath: string, filePath: string): Promise<string> => {
    const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }
    return response.text();
  },

  getFileBlob: async (sessionPath: string, filePath: string): Promise<Blob> => {
    const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }
    return response.blob();
  },

  writeFile: async (sessionPath: string, filePath: string, content: string): Promise<void> => {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
    };
    // Add CSRF token for state-changing request
    const csrfToken = getCsrfTokenFromCookie();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    } else {
      console.warn('[API] CSRF token missing for PUT request to storage. Request may fail.');
    }
    const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: content,
    });
    if (!response.ok) {
      throw new Error(`Failed to write file: ${response.status}`);
    }
  },

  deleteFile: async (sessionPath: string, filePath: string): Promise<void> => {
    const headers: Record<string, string> = {};
    // Add CSRF token for state-changing request
    const csrfToken = getCsrfTokenFromCookie();
    if (csrfToken) {
      headers[CSRF_HEADER_NAME] = csrfToken;
    } else {
      console.warn('[API] CSRF token missing for DELETE request to storage. Request may fail.');
    }
    const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
      method: 'DELETE',
      credentials: 'include',
      headers,
    });
    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.status}`);
    }
  },

  checkFileExists: async (sessionPath: string, filePath: string): Promise<boolean> => {
    const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
      method: 'HEAD',
      credentials: 'include',
    });
    return response.ok;
  },
};

// ============================================================================
// Game Store API
// ============================================================================
import type {
  Game,
  LibraryItem,
  Purchase,
  WishlistItem,
  CommunityPost,
  CommunityComment,
  CommunityChannel,
  ChannelMessage,
} from '../types';

export const storeApi = {
  getFeatured: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<{ games: Game[] }>(`/api/store/featured${queryString ? `?${queryString}` : ''}`);
  },

  browse: (options?: {
    q?: string;
    genre?: string;
    tag?: string;
    sort?: 'releaseDate' | 'title' | 'price' | 'rating' | 'downloads';
    order?: 'asc' | 'desc';
    minPrice?: number;
    maxPrice?: number;
    free?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.q) params.append('q', options.q);
    if (options?.genre) params.append('genre', options.genre);
    if (options?.tag) params.append('tag', options.tag);
    if (options?.sort) params.append('sort', options.sort);
    if (options?.order) params.append('order', options.order);
    if (options?.minPrice !== undefined) params.append('minPrice', String(options.minPrice));
    if (options?.maxPrice !== undefined) params.append('maxPrice', String(options.maxPrice));
    if (options?.free !== undefined) params.append('free', String(options.free));
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ games: Game[]; total: number; limit: number; offset: number; hasMore: boolean }>(
      `/api/store/browse${queryString ? `?${queryString}` : ''}`
    );
  },

  getGame: (id: string) =>
    fetchApi<{ game: Game }>(`/api/store/games/${id}`),

  checkOwnership: (id: string) =>
    fetchApi<{ owned: boolean }>(`/api/store/games/${id}/owned`),

  getGenres: () =>
    fetchApi<{ genres: string[] }>('/api/store/genres'),

  getTags: () =>
    fetchApi<{ tags: string[] }>('/api/store/tags'),

  getWishlist: () =>
    fetchApi<{ items: WishlistItem[]; total: number }>('/api/store/wishlist'),

  addToWishlist: (gameId: string) =>
    fetchApi<{ wishlistItem: WishlistItem }>(`/api/store/wishlist/${gameId}`, { method: 'POST' }),

  removeFromWishlist: (gameId: string) =>
    fetchApi(`/api/store/wishlist/${gameId}`, { method: 'DELETE' }),

  getNew: (options?: { limit?: number; days?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.days) params.append('days', String(options.days));
    const queryString = params.toString();
    return fetchApi<{ games: Game[] }>(`/api/store/new${queryString ? `?${queryString}` : ''}`);
  },

  getHighlights: (options?: { featuredLimit?: number; newLimit?: number; days?: number }) => {
    const params = new URLSearchParams();
    if (options?.featuredLimit) params.append('featuredLimit', String(options.featuredLimit));
    if (options?.newLimit) params.append('newLimit', String(options.newLimit));
    if (options?.days) params.append('days', String(options.days));
    const queryString = params.toString();
    return fetchApi<{ featured: Game[]; new: Game[]; hasHighlights: boolean }>(
      `/api/store/highlights${queryString ? `?${queryString}` : ''}`
    );
  },
};

// ============================================================================
// Library API
// ============================================================================
export const libraryApi = {
  getRecentlyPlayed: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<{ items: LibraryItem[]; total: number }>(
      `/api/library/recent${queryString ? `?${queryString}` : ''}`
    );
  },

  getLibrary: (options?: {
    sort?: 'acquiredAt' | 'title' | 'lastPlayed' | 'playtime';
    order?: 'asc' | 'desc';
    favorite?: boolean;
    installed?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.sort) params.append('sort', options.sort);
    if (options?.order) params.append('order', options.order);
    if (options?.favorite !== undefined) params.append('favorite', String(options.favorite));
    if (options?.installed !== undefined) params.append('installed', String(options.installed));
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ items: LibraryItem[]; total: number; limit: number; offset: number; hasMore: boolean }>(
      `/api/library${queryString ? `?${queryString}` : ''}`
    );
  },

  getLibraryItem: (gameId: string) =>
    fetchApi<LibraryItem>(`/api/library/${gameId}`),

  toggleFavorite: (gameId: string) =>
    fetchApi<{ item: LibraryItem }>(`/api/library/${gameId}/favorite`, { method: 'POST' }),

  hideGame: (gameId: string, hidden: boolean) =>
    fetchApi<{ item: LibraryItem }>(`/api/library/${gameId}/hide`, {
      method: 'POST',
      body: { hidden },
    }),

  updateInstallStatus: (gameId: string, status: 'not_installed' | 'installing' | 'installed') =>
    fetchApi<{ item: LibraryItem }>(`/api/library/${gameId}/install-status`, {
      method: 'POST',
      body: { status },
    }),

  addPlaytime: (gameId: string, minutes: number) =>
    fetchApi<{ item: LibraryItem }>(`/api/library/${gameId}/playtime`, {
      method: 'POST',
      body: { minutes },
    }),

  getHiddenGames: () =>
    fetchApi<{ items: LibraryItem[]; total: number }>('/api/library/hidden/all'),

  getStats: () =>
    fetchApi<{
      totalGames: number;
      installedGames: number;
      favoriteGames: number;
      totalPlaytimeMinutes: number;
      totalPlaytimeHours: number;
    }>('/api/library/stats/summary'),
};

// ============================================================================
// Purchases API
// ============================================================================
export const purchasesApi = {
  buyGame: (gameId: string, paymentMethod?: string) =>
    fetchApi<{ purchase: Purchase; libraryItem: LibraryItem; message: string }>(`/api/purchases/buy/${gameId}`, {
      method: 'POST',
      body: { paymentMethod },
    }),

  getHistory: (options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ purchases: Purchase[]; total: number; limit: number; offset: number; hasMore: boolean }>(
      `/api/purchases/history${queryString ? `?${queryString}` : ''}`
    );
  },

  getPurchase: (purchaseId: string) =>
    fetchApi<Purchase>(`/api/purchases/${purchaseId}`),

  requestRefund: (purchaseId: string, reason?: string) =>
    fetchApi<{ purchase: Purchase; message: string }>(`/api/purchases/${purchaseId}/refund`, {
      method: 'POST',
      body: { reason },
    }),

  getStats: () =>
    fetchApi<{
      totalPurchases: number;
      completedPurchases: number;
      refundedPurchases: number;
      totalSpentCents: number;
      totalRefundedCents: number;
      netSpentCents: number;
    }>('/api/purchases/stats/summary'),
};

// ============================================================================
// Community API
// ============================================================================
export const communityApi = {
  getPosts: (options?: {
    type?: 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement';
    gameId?: string;
    sort?: 'createdAt';
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.type) params.append('type', options.type);
    if (options?.gameId) params.append('gameId', options.gameId);
    if (options?.sort) params.append('sort', options.sort);
    if (options?.order) params.append('order', options.order);
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ posts: CommunityPost[]; total: number; limit: number; offset: number; hasMore: boolean }>(
      `/api/community/posts${queryString ? `?${queryString}` : ''}`
    );
  },

  getPost: (id: string) =>
    fetchApi<CommunityPost & { comments: CommunityComment[] }>(`/api/community/posts/${id}`),

  createPost: (data: {
    type: 'discussion' | 'review' | 'guide' | 'artwork' | 'announcement';
    title: string;
    content: string;
    gameId?: string;
    rating?: number;
    images?: string[];
  }) =>
    fetchApi<{ post: CommunityPost }>('/api/community/posts', {
      method: 'POST',
      body: data,
    }),

  updatePost: (id: string, data: { title?: string; content?: string; images?: string[] }) =>
    fetchApi<{ post: CommunityPost }>(`/api/community/posts/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  deletePost: (id: string) =>
    fetchApi(`/api/community/posts/${id}`, { method: 'DELETE' }),

  addComment: (postId: string, data: { content: string; parentId?: string }) =>
    fetchApi<{ comment: CommunityComment }>(`/api/community/posts/${postId}/comments`, {
      method: 'POST',
      body: data,
    }),

  deleteComment: (commentId: string) =>
    fetchApi(`/api/community/comments/${commentId}`, { method: 'DELETE' }),

  votePost: (postId: string, vote: 1 | -1 | 0) =>
    fetchApi<{ upvotes: number; downvotes: number; userVote: number }>(`/api/community/posts/${postId}/vote`, {
      method: 'POST',
      body: { vote },
    }),

  voteComment: (commentId: string, vote: 1 | -1 | 0) =>
    fetchApi<{ upvotes: number; downvotes: number; userVote: number }>(`/api/community/comments/${commentId}/vote`, {
      method: 'POST',
      body: { vote },
    }),

  getUserPosts: (userId: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ posts: CommunityPost[] }>(`/api/community/users/${userId}/posts${queryString ? `?${queryString}` : ''}`);
  },

  getGameReviews: (gameId: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{ reviews: CommunityPost[] }>(`/api/community/games/${gameId}/reviews${queryString ? `?${queryString}` : ''}`);
  },
};

// ============================================================================
// Universal Search API
// ============================================================================
export interface SearchResultItem {
  id: string;
  type: 'game' | 'user' | 'session' | 'post';
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  matchedFields?: string[];
}

export interface SearchResults {
  items: SearchResultItem[];
  total: number;
  query: string;
}

export const searchApi = {
  search: (options: {
    q: string;
    types?: ('game' | 'user' | 'session' | 'post')[];
    limit?: number;
  }) => {
    const params = new URLSearchParams();
    params.append('q', options.q);
    if (options.types?.length) params.append('types', options.types.join(','));
    if (options.limit) params.append('limit', String(options.limit));
    const queryString = params.toString();
    return fetchApi<SearchResults>(`/api/search${queryString ? `?${queryString}` : ''}`);
  },

  getSuggestions: (q: string, limit?: number) => {
    const params = new URLSearchParams();
    params.append('q', q);
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<{ suggestions: string[] }>(`/api/search/suggestions${queryString ? `?${queryString}` : ''}`);
  },
};

// ============================================================================
// Channels API (Community Activity)
// ============================================================================
export const channelsApi = {
  getChannels: () =>
    fetchApi<{ channels: CommunityChannel[] }>('/api/channels'),

  getChannel: (id: string) =>
    fetchApi<CommunityChannel>(`/api/channels/${id}`),

  getChannelBySlug: (slug: string) =>
    fetchApi<CommunityChannel>(`/api/channels/by-slug/${slug}`),

  getMessages: (channelId: string, options?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<{
      messages: ChannelMessage[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>(`/api/channels/${channelId}/messages${queryString ? `?${queryString}` : ''}`);
  },

  getRecentActivity: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<{ messages: ChannelMessage[] }>(
      `/api/channels/activity/recent${queryString ? `?${queryString}` : ''}`
    );
  },

  postMessage: (channelId: string, data: { content: string; replyToId?: string; images?: string[] }) =>
    fetchApi<{ message: ChannelMessage }>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: data,
    }),

  editMessage: (messageId: string, content: string) =>
    fetchApi<{ message: ChannelMessage }>(`/api/channels/messages/${messageId}`, {
      method: 'PATCH',
      body: { content },
    }),

  deleteMessage: (messageId: string) =>
    fetchApi(`/api/channels/messages/${messageId}`, { method: 'DELETE' }),

  // Admin operations
  createChannel: (data: {
    name: string;
    slug: string;
    description?: string;
    gameId?: string;
    isDefault?: boolean;
    isReadOnly?: boolean;
    sortOrder?: number;
  }) =>
    fetchApi<{ channel: CommunityChannel }>('/api/channels', {
      method: 'POST',
      body: data,
    }),

  updateChannel: (id: string, data: {
    name?: string;
    description?: string;
    isDefault?: boolean;
    isReadOnly?: boolean;
    sortOrder?: number;
    status?: 'active' | 'archived';
  }) =>
    fetchApi<{ channel: CommunityChannel }>(`/api/channels/${id}`, {
      method: 'PATCH',
      body: data,
    }),
};

// ============================================================================
// Billing API
// ============================================================================
export interface BillingInfo {
  tier: string;
  tierLabel: string;
  price: number;
  priceLabel: string;
  usedBytes: string;
  quotaBytes: string;
  availableBytes: string;
  usagePercent: number;
  usedFormatted: string;
  quotaFormatted: string;
  availableFormatted: string;
}

export interface PricingTier {
  id: string;
  name: string;
  bytes: string;
  formatted: string;
  price: number;
  priceLabel: string;
  features: string[];
}

export const billingApi = {
  getCurrentPlan: () =>
    fetchApi<ApiResponse<BillingInfo>>('/api/billing/current').then(r => r.data),

  getTiers: () =>
    fetchApi<ApiResponse<{ tiers: PricingTier[] }>>('/api/billing/tiers').then(r => r.data),

  changePlan: (tier: string) =>
    fetchApi<ApiResponse<{
      message: string;
      tier: string;
      tierLabel: string;
      price: number;
      priceLabel: string;
      newQuotaBytes: string;
      newQuotaFormatted: string;
    }>>('/api/billing/change-plan', {
      method: 'POST',
      body: { tier },
    }).then(r => r.data),
};

// ============================================================================
// Taxonomy API (Admin-configurable categories, tags, genres)
// ============================================================================
import type {
  Taxonomy,
  TaxonomyTerm,
  ItemTaxonomy,
  TaxonomyWithTerms,
  Announcement,
  AnnouncementType,
  AnnouncementPriority,
  AnnouncementStatus,
  CloudSave,
  CloudSaveVersion,
  CloudSaveSyncLog,
  CloudSaveStats,
  CloudSaveSyncConflict,
  CloudSavePlatformData,
  CloudSaveGameProgress,
  LocalSaveInfo,
} from '../types';

export const taxonomyApi = {
  // Taxonomy CRUD
  list: () =>
    fetchApi<ApiResponse<Taxonomy[]>>('/api/taxonomies').then(r => r.data || []),

  get: (id: string) =>
    fetchApi<ApiResponse<TaxonomyWithTerms>>(`/api/taxonomies/${id}`).then(r => r.data!),

  getBySlug: (slug: string) =>
    fetchApi<ApiResponse<TaxonomyWithTerms>>(`/api/taxonomies/by-slug/${slug}`).then(r => r.data!),

  create: (data: {
    name: string;
    displayName: string;
    description?: string;
    allowMultiple?: boolean;
    isRequired?: boolean;
    itemTypes?: string[];
    sortOrder?: number;
  }) =>
    fetchApi<ApiResponse<Taxonomy>>('/api/taxonomies', {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  update: (id: string, data: {
    name?: string;
    displayName?: string;
    description?: string;
    allowMultiple?: boolean;
    isRequired?: boolean;
    itemTypes?: string[];
    sortOrder?: number;
    status?: 'active' | 'archived';
  }) =>
    fetchApi<ApiResponse<Taxonomy>>(`/api/taxonomies/${id}`, {
      method: 'PATCH',
      body: data,
    }).then(r => r.data!),

  delete: (id: string) =>
    fetchApi<ApiResponse<{ id: string }>>(`/api/taxonomies/${id}`, { method: 'DELETE' }),

  // Term CRUD
  getTerms: (taxonomyId: string) =>
    fetchApi<ApiResponse<TaxonomyTerm[]>>(`/api/taxonomies/${taxonomyId}/terms`).then(r => r.data || []),

  getTerm: (termId: string) =>
    fetchApi<ApiResponse<TaxonomyTerm>>(`/api/taxonomies/terms/${termId}`).then(r => r.data!),

  createTerm: (taxonomyId: string, data: {
    name: string;
    description?: string;
    parentId?: string;
    color?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
    sortOrder?: number;
  }) =>
    fetchApi<ApiResponse<TaxonomyTerm>>(`/api/taxonomies/${taxonomyId}/terms`, {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  updateTerm: (termId: string, data: {
    name?: string;
    description?: string;
    parentId?: string;
    color?: string;
    icon?: string;
    metadata?: Record<string, unknown>;
    sortOrder?: number;
    status?: 'active' | 'archived';
  }) =>
    fetchApi<ApiResponse<TaxonomyTerm>>(`/api/taxonomies/terms/${termId}`, {
      method: 'PATCH',
      body: data,
    }).then(r => r.data!),

  deleteTerm: (termId: string) =>
    fetchApi<ApiResponse<{ id: string }>>(`/api/taxonomies/terms/${termId}`, { method: 'DELETE' }),

  // Item taxonomy assignments
  getItemTaxonomies: (itemType: string, itemId: string) =>
    fetchApi<ApiResponse<Array<{ taxonomy: Taxonomy; terms: TaxonomyTerm[] }>>>(
      `/api/taxonomies/items/${itemType}/${itemId}`
    ).then(r => r.data || []),

  assignTerm: (itemType: string, itemId: string, termId: string) =>
    fetchApi<ApiResponse<ItemTaxonomy>>(`/api/taxonomies/items/${itemType}/${itemId}/terms/${termId}`, {
      method: 'POST',
    }).then(r => r.data!),

  removeTerm: (itemType: string, itemId: string, termId: string) =>
    fetchApi<ApiResponse<{ id: string }>>(`/api/taxonomies/items/${itemType}/${itemId}/terms/${termId}`, {
      method: 'DELETE',
    }),

  bulkUpdateItemTerms: (itemType: string, itemId: string, termIds: string[]) =>
    fetchApi<ApiResponse<ItemTaxonomy[]>>(`/api/taxonomies/items/${itemType}/${itemId}`, {
      method: 'PUT',
      body: { termIds },
    }).then(r => r.data || []),

  getItemsByTerm: (termId: string, itemType?: string) => {
    const params = new URLSearchParams();
    if (itemType) params.append('itemType', itemType);
    const queryString = params.toString();
    return fetchApi<ApiResponse<ItemTaxonomy[]>>(
      `/api/taxonomies/items/by-term/${termId}${queryString ? `?${queryString}` : ''}`
    ).then(r => r.data || []);
  },
};

// ============================================================================
// Announcements API (Official platform updates)
// ============================================================================
export const announcementsApi = {
  // Get published announcements (public)
  list: (options?: {
    type?: AnnouncementType;
    priority?: AnnouncementPriority;
    pinned?: boolean;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.type) params.append('type', options.type);
    if (options?.priority) params.append('priority', options.priority);
    if (options?.pinned !== undefined) params.append('pinned', String(options.pinned));
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<ApiResponse<{
      announcements: Announcement[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>>(`/api/announcements${queryString ? `?${queryString}` : ''}`).then(r => r.data!);
  },

  // Get single announcement
  get: (id: string) =>
    fetchApi<ApiResponse<Announcement>>(`/api/announcements/${id}`).then(r => r.data!),

  // Admin: List all announcements (including drafts and archived)
  adminList: (options?: {
    type?: AnnouncementType;
    priority?: AnnouncementPriority;
    status?: AnnouncementStatus;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (options?.type) params.append('type', options.type);
    if (options?.priority) params.append('priority', options.priority);
    if (options?.status) params.append('status', options.status);
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.offset) params.append('offset', String(options.offset));
    const queryString = params.toString();
    return fetchApi<ApiResponse<{
      announcements: Announcement[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    }>>(`/api/announcements/admin/all${queryString ? `?${queryString}` : ''}`).then(r => r.data!);
  },

  // Admin: Create announcement
  create: (data: {
    title: string;
    content: string;
    type?: AnnouncementType;
    priority?: AnnouncementPriority;
    status?: AnnouncementStatus;
    pinned?: boolean;
    expiresAt?: string;
  }) =>
    fetchApi<ApiResponse<{ announcement: Announcement }>>('/api/announcements', {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  // Admin: Update announcement
  update: (id: string, data: {
    title?: string;
    content?: string;
    type?: AnnouncementType;
    priority?: AnnouncementPriority;
    status?: AnnouncementStatus;
    pinned?: boolean;
    expiresAt?: string | null;
  }) =>
    fetchApi<ApiResponse<{ announcement: Announcement }>>(`/api/announcements/${id}`, {
      method: 'PATCH',
      body: data,
    }).then(r => r.data!),

  // Admin: Delete announcement
  delete: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/announcements/${id}`, {
      method: 'DELETE',
    }),
};

// ============================================================================
// Diffs API (Branch comparison and visualization)
// ============================================================================
export interface DiffLine {
  type: 'addition' | 'deletion' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  oldPath: string;
  newPath: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  hunks: DiffHunk[];
  isBinary: boolean;
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalFilesChanged: number;
}

export interface CompareResult {
  diff: ParsedDiff;
  rawDiff: string;
  baseBranch: string;
  headBranch: string;
  aheadBy: number;
  behindBy: number;
  mergeBaseCommit: string;
}

export interface FileChange {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  previousFilename?: string;
}

export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  totalChanges: number;
  commits: number;
  aheadBy: number;
  behindBy: number;
  status: string;
}

export const diffsApi = {
  compare: (owner: string, repo: string, base: string, head: string) =>
    fetchApi<ApiResponse<CompareResult>>(`/api/diffs/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}/${encodeURIComponent(head)}`)
      .then(r => r.data!),

  getChangedFiles: (owner: string, repo: string, base: string, head: string) =>
    fetchApi<ApiResponse<{
      files: FileChange[];
      totalFiles: number;
      totalAdditions: number;
      totalDeletions: number;
      aheadBy: number;
      behindBy: number;
    }>>(`/api/diffs/repos/${owner}/${repo}/changed-files/${encodeURIComponent(base)}/${encodeURIComponent(head)}`)
      .then(r => r.data!),

  getFileDiff: (owner: string, repo: string, base: string, head: string, filePath: string) =>
    fetchApi<ApiResponse<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
      rawDiff: string;
      parsedDiff: FileDiff | null;
      previousFilename?: string;
    }>>(`/api/diffs/repos/${owner}/${repo}/file-diff/${encodeURIComponent(base)}/${encodeURIComponent(head)}/${filePath}`)
      .then(r => r.data!),

  getStats: (owner: string, repo: string, base: string, head: string) =>
    fetchApi<ApiResponse<DiffStats>>(`/api/diffs/repos/${owner}/${repo}/stats/${encodeURIComponent(base)}/${encodeURIComponent(head)}`)
      .then(r => r.data!),
};

// ============================================================================
// Cloud Saves API (Game save synchronization across devices)
// ============================================================================
export const cloudSavesApi = {
  // Get cloud save statistics
  getStats: () =>
    fetchApi<ApiResponse<CloudSaveStats>>('/api/cloud-saves/stats').then(r => r.data!),

  // Get sync history
  getSyncHistory: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<ApiResponse<{ history: CloudSaveSyncLog[] }>>(
      `/api/cloud-saves/sync-history${queryString ? `?${queryString}` : ''}`
    ).then(r => r.data!);
  },

  // List all saves for the current user
  listAll: () =>
    fetchApi<ApiResponse<{ saves: CloudSave[]; total: number }>>('/api/cloud-saves/all')
      .then(r => r.data!),

  // Check for sync conflicts
  checkConflicts: (localSaves: LocalSaveInfo[]) =>
    fetchApi<ApiResponse<{ conflicts: CloudSaveSyncConflict[]; hasConflicts: boolean }>>('/api/cloud-saves/check-conflicts', {
      method: 'POST',
      body: { localSaves },
    }).then(r => r.data!),

  // List saves for a specific game
  listByGame: (gameId: string) =>
    fetchApi<ApiResponse<{ saves: CloudSave[]; total: number }>>(`/api/cloud-saves/games/${gameId}`)
      .then(r => r.data!),

  // Get a specific save slot (includes save data)
  getSave: (gameId: string, slotNumber: number) =>
    fetchApi<ApiResponse<{ save: CloudSave; game: { id: string; title: string } | null }>>(
      `/api/cloud-saves/games/${gameId}/slots/${slotNumber}`
    ).then(r => r.data!),

  // Upload/update a save
  uploadSave: (gameId: string, slotNumber: number, data: {
    slotName?: string;
    saveData: string;
    platformData?: CloudSavePlatformData;
    screenshotUrl?: string;
    playTimeSeconds?: number;
    gameProgress?: CloudSaveGameProgress;
  }) =>
    fetchApi<ApiResponse<{ save: CloudSave }>>(`/api/cloud-saves/games/${gameId}/slots/${slotNumber}`, {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  // Delete a save
  deleteSave: (gameId: string, slotNumber: number, platformData?: CloudSavePlatformData) =>
    fetchApi<ApiResponse<void>>(`/api/cloud-saves/games/${gameId}/slots/${slotNumber}`, {
      method: 'DELETE',
      body: platformData ? { platformData } : undefined,
    }),

  // Get save versions for recovery
  getVersions: (saveId: string) =>
    fetchApi<ApiResponse<{ versions: CloudSaveVersion[]; total: number }>>(
      `/api/cloud-saves/saves/${saveId}/versions`
    ).then(r => r.data!),

  // Get a specific version (includes save data)
  getVersion: (saveId: string, versionId: string) =>
    fetchApi<ApiResponse<{ version: CloudSaveVersion }>>(
      `/api/cloud-saves/saves/${saveId}/versions/${versionId}`
    ).then(r => r.data!),

  // Restore a save from a previous version
  restoreVersion: (saveId: string, versionId: string, platformData?: CloudSavePlatformData) =>
    fetchApi<ApiResponse<{ save: CloudSave }>>(`/api/cloud-saves/saves/${saveId}/versions/${versionId}/restore`, {
      method: 'POST',
      body: platformData ? { platformData } : undefined,
    }).then(r => r.data!),
};

// ============================================================================
// Autocomplete API (AI-powered code completion)
// ============================================================================
export interface AutocompleteRequest {
  prefix: string;
  suffix: string;
  language: string;
  filePath?: string;
  maxSuggestions?: number;
  additionalContext?: Array<{
    filePath: string;
    content: string;
    language: string;
  }>;
}

export interface AutocompleteSuggestion {
  text: string;
  label: string;
  kind: 'function' | 'method' | 'variable' | 'class' | 'interface' | 'property' | 'keyword' | 'snippet' | 'text';
  detail?: string;
  confidence?: number;
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
  latencyMs: number;
  cached?: boolean;
}

export const autocompleteApi = {
  complete: (request: AutocompleteRequest) =>
    fetchApi<ApiResponse<AutocompleteResponse>>('/api/autocomplete', {
      method: 'POST',
      body: request as unknown as Record<string, unknown>,
    }).then(r => r.data!),

  getLanguages: () =>
    fetchApi<ApiResponse<{
      languages: Array<{
        id: string;
        name: string;
        extensions: string[];
      }>;
    }>>('/api/autocomplete/languages').then(r => r.data!),
};

// ============================================================================
// Snippets API (User code snippets and templates)
// ============================================================================
export const snippetsApi = {
  // List user's snippets with optional filtering
  list: (filters?: SnippetListFilters) => {
    const params = new URLSearchParams();
    if (filters?.language) params.append('language', filters.language);
    if (filters?.category) params.append('category', filters.category);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.favorite) params.append('favorite', 'true');
    if (filters?.collectionId) params.append('collectionId', filters.collectionId);
    if (filters?.sortBy) params.append('sortBy', filters.sortBy);
    if (filters?.order) params.append('order', filters.order);
    const queryString = params.toString();
    return fetchApi<ApiResponse<{
      snippets: Snippet[];
      total: number;
      languages: readonly SnippetLanguage[];
      categories: readonly SnippetCategory[];
    }>>(`/api/snippets${queryString ? `?${queryString}` : ''}`).then(r => r.data!);
  },

  // Get a single snippet
  get: (id: string) =>
    fetchApi<ApiResponse<Snippet>>(`/api/snippets/${id}`).then(r => r.data!),

  // Create a new snippet
  create: (data: CreateSnippetRequest) =>
    fetchApi<ApiResponse<Snippet>>('/api/snippets', {
      method: 'POST',
      body: data as unknown as Record<string, unknown>,
    }).then(r => r.data!),

  // Update a snippet
  update: (id: string, data: UpdateSnippetRequest) =>
    fetchApi<ApiResponse<Snippet>>(`/api/snippets/${id}`, {
      method: 'PUT',
      body: data as unknown as Record<string, unknown>,
    }).then(r => r.data!),

  // Delete a snippet
  delete: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/snippets/${id}`, {
      method: 'DELETE',
    }),

  // Record snippet usage
  use: (id: string) =>
    fetchApi<ApiResponse<Snippet>>(`/api/snippets/${id}/use`, {
      method: 'POST',
    }).then(r => r.data!),

  // Toggle favorite status
  toggleFavorite: (id: string) =>
    fetchApi<ApiResponse<Snippet>>(`/api/snippets/${id}/favorite`, {
      method: 'POST',
    }).then(r => r.data!),

  // Duplicate a snippet
  duplicate: (id: string) =>
    fetchApi<ApiResponse<Snippet>>(`/api/snippets/${id}/duplicate`, {
      method: 'POST',
    }).then(r => r.data!),

  // List snippet collections
  listCollections: () =>
    fetchApi<ApiResponse<{
      collections: SnippetCollection[];
      total: number;
    }>>('/api/snippets/collections/list').then(r => r.data!),

  // Create a snippet collection
  createCollection: (data: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    isDefault?: boolean;
  }) =>
    fetchApi<ApiResponse<SnippetCollection>>('/api/snippets/collections', {
      method: 'POST',
      body: data,
    }).then(r => r.data!),

  // Update a snippet collection
  updateCollection: (id: string, data: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
    sortOrder?: number;
    isDefault?: boolean;
  }) =>
    fetchApi<ApiResponse<SnippetCollection>>(`/api/snippets/collections/${id}`, {
      method: 'PUT',
      body: data,
    }).then(r => r.data!),

  // Delete a snippet collection
  deleteCollection: (id: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/snippets/collections/${id}`, {
      method: 'DELETE',
    }),

  // Add snippet to collection
  addToCollection: (collectionId: string, snippetId: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/snippets/collections/${collectionId}/snippets/${snippetId}`, {
      method: 'POST',
    }),

  // Remove snippet from collection
  removeFromCollection: (collectionId: string, snippetId: string) =>
    fetchApi<ApiResponse<{ message: string }>>(`/api/snippets/collections/${collectionId}/snippets/${snippetId}`, {
      method: 'DELETE',
    }),
};

// ============================================================================
// Workspace Presence API (Collaborative cursors and real-time presence)
// ============================================================================
export interface PresenceUser {
  userId: string;
  displayName: string;
  page: string | null;
  cursorX: number | null;
  cursorY: number | null;
  selection: {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    startCol?: number;
    endCol?: number;
  } | null;
  isCurrentUser: boolean;
}

export interface PresenceUpdate {
  users: PresenceUser[];
}

export const workspacePresenceApi = {
  // Update presence (heartbeat with cursor position)
  updatePresence: (data: {
    owner: string;
    repo: string;
    branch: string;
    page?: string;
    cursorX?: number;
    cursorY?: number;
    selection?: {
      filePath?: string;
      startLine?: number;
      endLine?: number;
      startCol?: number;
      endCol?: number;
    };
  }) =>
    fetchApi<{ success: boolean }>('/api/workspace/presence', {
      method: 'PUT',
      body: data,
    }),

  // Get active users on a branch
  getPresence: (owner: string, repo: string, branch: string) =>
    fetchApi<{
      success: boolean;
      data: {
        users: PresenceUser[];
        branch: string;
        owner: string;
        repo: string;
      };
    }>(`/api/workspace/presence/${owner}/${repo}/${encodeURIComponent(branch)}`),

  // Remove presence (leaving workspace)
  removePresence: (owner: string, repo: string, branch: string) =>
    fetchApi<{ success: boolean }>(`/api/workspace/presence/${owner}/${repo}/${encodeURIComponent(branch)}`, {
      method: 'DELETE',
    }),

  // Get SSE stream URL for presence updates
  getStreamUrl: (owner: string, repo: string, branch: string) =>
    `${getApiBaseUrl()}/api/workspace/events/${owner}/${repo}/${encodeURIComponent(branch)}/stream`,
};

// ============================================================================
// Import API (Import files from external URLs)
// ============================================================================
export interface UrlValidationResult {
  valid: boolean;
  suggestedFilename?: string;
  contentType?: string;
  contentLength?: number;
  error?: string;
}

export interface UrlImportResult {
  filePath: string;
  contentType: string;
  size: number;
  isBinary: boolean;
}

export const importApi = {
  validate: (url: string) =>
    fetchApi<{ success: boolean; data: UrlValidationResult }>('/api/import/validate', {
      method: 'POST',
      body: { url },
    }),

  fromUrl: (url: string, sessionPath: string, targetPath?: string) =>
    fetchApi<{ success: boolean; data: UrlImportResult }>('/api/import/url', {
      method: 'POST',
      body: { url, sessionPath, targetPath },
    }),
};

// ============================================================================
// MIDI API
// ============================================================================

/**
 * MIDI file validation result
 */
export interface MidiValidationResult {
  valid: boolean;
  fileName?: string;
  contentType?: string;
  size?: number;
  error?: string;
}

export const midiApi = {
  /**
   * Validate a MIDI file URL before importing
   * Checks if the URL is accessible and appears to be a MIDI file
   */
  validateUrl: async (url: string): Promise<{ success: boolean; data: MidiValidationResult }> => {
    const result = await fetchApi<{ success: boolean; data: UrlValidationResult }>('/api/import/validate', {
      method: 'POST',
      body: { url },
    });

    // Check if it looks like a MIDI file
    const fileName = result.data.suggestedFilename || url.split('/').pop() || '';
    const isMidi = Boolean(
      fileName.toLowerCase().endsWith('.mid') ||
      fileName.toLowerCase().endsWith('.midi') ||
      result.data.contentType?.includes('audio/midi') ||
      result.data.contentType?.includes('audio/x-midi')
    );

    const isValid = Boolean(result.data.valid) && isMidi;
    const hasSuccess = Boolean(result.success);

    return {
      success: hasSuccess && isValid,
      data: {
        valid: isValid,
        fileName: result.data.suggestedFilename,
        contentType: result.data.contentType,
        size: result.data.contentLength,
        error: !isMidi ? 'Not a valid MIDI file' : result.data.error,
      },
    };
  },
};
