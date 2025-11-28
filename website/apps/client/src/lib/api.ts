// Detect API base URL for path-based routing
function getApiBaseUrl(): string {
  // If explicitly set via env var, use it
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (envBaseUrl) {
    return envBaseUrl;
  }

  // Detect from current pathname for path-based routing
  // Example: https://github.etdofresh.com/webedt/website/branch/ -> /webedt/website/branch
  // Monorepo: https://github.etdofresh.com/webedt/monorepo/website/branch/ -> /webedt/monorepo/website/branch
  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check if we're in a path-based deployment (3+ path segments)
  // and first segment is not a route name
  if (pathSegments.length >= 3 && !['login', 'register', 'session', 'settings'].includes(pathSegments[0])) {
    // Check for monorepo pattern: /owner/repo/website/branch/
    if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
      return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
    }
    // Standard format: /owner/repo/branch/...
    return `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
  }

  // Default to empty string for root-based deployments
  return '';
}

export const API_BASE_URL = getApiBaseUrl();
console.log('[API] Detected API_BASE_URL:', API_BASE_URL);
console.log('[API] Current pathname:', window.location.pathname);

interface ApiOptions extends RequestInit {
  body?: any;
}

async function fetchApi<T = any>(endpoint: string, options: ApiOptions = {}): Promise<T> {
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

  const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Auth API
export const authApi = {
  register: (email: string, password: string) =>
    fetchApi('/api/auth/register', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password },
    }),

  login: (email: string, password: string, rememberMe: boolean = false) =>
    fetchApi('/api/auth/login', {
      method: 'POST',
      body: { email: email.toLowerCase().trim(), password, rememberMe },
    }),

  logout: () =>
    fetchApi('/api/auth/logout', {
      method: 'POST',
    }),

  getSession: () => fetchApi('/api/auth/session'),
};

// GitHub API
export const githubApi = {
  connect: () => {
    window.location.href = `${API_BASE_URL}/api/github/oauth`;
  },

  getRepos: () => fetchApi('/api/github/repos'),

  getBranches: (owner: string, repo: string) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches`),

  disconnect: () =>
    fetchApi('/api/github/disconnect', {
      method: 'POST',
    }),

  // Pull Request operations
  getPulls: (owner: string, repo: string, head?: string, base?: string) => {
    const params = new URLSearchParams();
    if (head) params.append('head', head);
    if (base) params.append('base', base);
    const queryString = params.toString();
    return fetchApi(`/api/github/repos/${owner}/${repo}/pulls${queryString ? `?${queryString}` : ''}`);
  },

  generatePRContent: (owner: string, repo: string, data: { head: string; base: string; userRequest?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/generate-pr-content`, {
      method: 'POST',
      body: data,
    }),

  createPull: (owner: string, repo: string, data: { title?: string; head: string; base: string; body?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: data,
    }),

  mergePull: (owner: string, repo: string, pullNumber: number, data?: { merge_method?: string; commit_title?: string; commit_message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
      method: 'POST',
      body: data || {},
    }),

  mergeBase: (owner: string, repo: string, branch: string, base: string) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches/${branch}/merge-base`, {
      method: 'POST',
      body: { base },
    }),

  autoPR: (owner: string, repo: string, branch: string, data: { base: string; title?: string; body?: string; sessionId?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches/${branch}/auto-pr`, {
      method: 'POST',
      body: data,
    }),
};

// User API
export const userApi = {
  updateClaudeAuth: (claudeAuth: any) =>
    fetchApi('/api/user/claude-auth', {
      method: 'POST',
      body: { claudeAuth },
    }),

  removeClaudeAuth: () =>
    fetchApi('/api/user/claude-auth', {
      method: 'DELETE',
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

  updateDefaultLandingPage: (landingPage: 'store' | 'library' | 'community' | 'sessions') =>
    fetchApi('/api/user/default-landing-page', {
      method: 'POST',
      body: { landingPage },
    }),
};

// Sessions API
export const sessionsApi = {
  list: () => fetchApi('/api/sessions'),

  listDeleted: (params?: { limit?: number; offset?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.offset) queryParams.append('offset', String(params.offset));
    const queryString = queryParams.toString();
    return fetchApi(`/api/sessions/deleted${queryString ? `?${queryString}` : ''}`);
  },

  get: (id: string) => fetchApi(`/api/sessions/${id}`),

  getMessages: (id: string) => fetchApi(`/api/sessions/${id}/messages`),

  getEvents: (id: string) => fetchApi(`/api/sessions/${id}/events`),

  createMessage: (id: string, type: string, content: string) =>
    fetchApi(`/api/sessions/${id}/messages`, {
      method: 'POST',
      body: { type, content },
    }),

  update: (id: string, userRequest: string) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: { userRequest },
    }),

  delete: (id: string) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'DELETE',
    }),

  deleteBulk: (ids: string[]) =>
    fetchApi('/api/sessions/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  restore: (id: string) =>
    fetchApi(`/api/sessions/${id}/restore`, {
      method: 'POST',
    }),

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
};

// Admin API
export const adminApi = {
  // User management
  listUsers: () => fetchApi('/api/admin/users'),

  getUser: (id: string) => fetchApi(`/api/admin/users/${id}`),

  createUser: (data: { email: string; displayName?: string; password: string; isAdmin?: boolean }) =>
    fetchApi('/api/admin/users', {
      method: 'POST',
      body: data,
    }),

  updateUser: (id: string, data: { email?: string; displayName?: string; isAdmin?: boolean; password?: string }) =>
    fetchApi(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  deleteUser: (id: string) =>
    fetchApi(`/api/admin/users/${id}`, {
      method: 'DELETE',
    }),

  impersonateUser: (id: string) =>
    fetchApi(`/api/admin/users/${id}/impersonate`, {
      method: 'POST',
    }),

  getStats: () => fetchApi('/api/admin/stats'),
};

// Storage Worker API
export const storageWorkerApi = {
  listSessions: async () => {
    const response = await fetchApi('/api/storage-worker/sessions');
    // Map sessionPath to sessionId for compatibility with frontend
    if (response.sessions) {
      response.sessions = response.sessions.map((session: any) => ({
        sessionId: session.sessionPath, // Use sessionPath as the ID
        createdAt: session.createdAt,
        lastModified: session.lastModified,
        size: session.size,
      }));
    }
    return response;
  },

  getSession: async (sessionId: string) => {
    const response = await fetchApi(`/api/storage-worker/sessions/${sessionId}`);
    // Map sessionPath to sessionId for compatibility
    return {
      sessionId: response.sessionPath || sessionId,
      createdAt: response.createdAt,
      lastModified: response.lastModified,
      size: response.size,
    };
  },

  sessionExists: async (sessionId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/storage-worker/sessions/${sessionId}`, {
        method: 'HEAD',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};

// Execute API (SSE)
export function createExecuteEventSource(data: {
  userRequest: string;
  github?: {
    repoUrl: string;
    branch: string;
  };
  autoCommit?: boolean;
  websiteSessionId?: string;
}) {
  const params = new URLSearchParams();

  // Add non-github params directly
  if (data.userRequest !== undefined) {
    params.append('userRequest', String(data.userRequest));
  }
  if (data.autoCommit !== undefined) {
    params.append('autoCommit', String(data.autoCommit));
  }
  if (data.websiteSessionId !== undefined) {
    params.append('websiteSessionId', String(data.websiteSessionId));
  }

  // Add github params as nested object by stringifying
  if (data.github) {
    params.append('github', JSON.stringify(data.github));
  }

  const fullUrl = `${API_BASE_URL}/api/execute?${params}`;
  console.log('[API] Creating EventSource with URL:', fullUrl);
  console.log('[API] API_BASE_URL:', API_BASE_URL);

  return new EventSource(fullUrl, {
    withCredentials: true,
  });
}
