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
};

// Sessions API
export const sessionsApi = {
  list: () => fetchApi('/api/sessions'),

  get: (id: number) => fetchApi(`/api/sessions/${id}`),

  getMessages: (id: number) => fetchApi(`/api/sessions/${id}/messages`),

  update: (id: number, userRequest: string) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: { userRequest },
    }),

  delete: (id: number) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'DELETE',
    }),
};

// Storage Worker API
export const storageWorkerApi = {
  listSessions: () => fetchApi('/api/storage-worker/sessions'),

  getSession: (sessionId: string) => fetchApi(`/api/storage-worker/sessions/${sessionId}`),

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
  repositoryUrl?: string;
  baseBranch?: string;
  branch?: string;
  autoCommit?: boolean;
  chatSessionId?: string;
}) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });

  const fullUrl = `${API_BASE_URL}/api/execute?${params}`;
  console.log('[API] Creating EventSource with URL:', fullUrl);
  console.log('[API] API_BASE_URL:', API_BASE_URL);

  return new EventSource(fullUrl, {
    withCredentials: true,
  });
}
