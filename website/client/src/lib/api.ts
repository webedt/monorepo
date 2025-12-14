// Cached API base URL - computed once on first access
let cachedApiBaseUrl: string | null = null;

// Detect API base URL for path-based routing
function getApiBaseUrl(): string {
  // Return cached value if already computed
  if (cachedApiBaseUrl !== null) {
    return cachedApiBaseUrl;
  }

  // If explicitly set via env var, use it
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (envBaseUrl) {
    cachedApiBaseUrl = envBaseUrl;
    console.log('[API] Using env API_BASE_URL:', cachedApiBaseUrl);
    return cachedApiBaseUrl;
  }

  // Detect from current pathname for path-based routing
  // Patterns:
  //   /github/owner/repo/branch/...  (preview via /github prefix)
  //   /owner/repo/branch/...         (standard path-based)
  //   /owner/repo/website/branch/... (monorepo website folder)
  const pathname = window.location.pathname;
  const pathSegments = pathname.split('/').filter(Boolean);

  // Check if we're in a path-based deployment and first segment is not a route name
  const appRoutes = ['login', 'register', 'session', 'sessions', 'settings', 'new-session',
                     'code', 'images', 'sound', 'scene-editor', 'preview', 'quick-setup', 'item'];

  if (pathSegments.length >= 1 && !appRoutes.includes(pathSegments[0])) {
    // Check for /github/ prefix pattern: /github/owner/repo/branch/
    if (pathSegments[0] === 'github' && pathSegments.length >= 4) {
      cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
    }
    // Check for monorepo pattern: /owner/repo/website/branch/
    else if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
      cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
    }
    // Standard format: /owner/repo/branch/...
    else if (pathSegments.length >= 3) {
      cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}`;
    } else {
      // Not enough segments for path-based routing
      cachedApiBaseUrl = '';
    }
  } else {
    // Default to empty string for root-based deployments
    cachedApiBaseUrl = '';
  }

  console.log('[API] Detected API_BASE_URL:', cachedApiBaseUrl);
  console.log('[API] Current pathname:', pathname);
  return cachedApiBaseUrl;
}

// Export the function for runtime URL detection (preferred for code-split bundles)
export { getApiBaseUrl };

// Also export a static constant for backward compatibility (computed once at module load)
export const API_BASE_URL = getApiBaseUrl();

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

  const fullUrl = `${getApiBaseUrl()}${endpoint}`;
  console.log(`[fetchApi] Requesting: ${fullUrl}`);

  const response = await fetch(fullUrl, config);

  console.log(`[fetchApi] Response for ${endpoint}:`, {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[fetchApi] Error for ${endpoint}:`, error);
    throw new Error(error.error || 'Request failed');
  }

  const data = await response.json();
  console.log(`[fetchApi] Success for ${endpoint}:`, { dataKeys: Object.keys(data || {}) });
  return data;
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
    window.location.href = `${getApiBaseUrl()}/api/github/oauth`;
  },

  getRepos: () => fetchApi('/api/github/repos'),

  getBranches: (owner: string, repo: string) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches`),

  // Create a new branch
  createBranch: (owner: string, repo: string, data: { branchName: string; baseBranch: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/branches`, {
      method: 'POST',
      body: data,
    }),

  // Get repository file tree
  getTree: (owner: string, repo: string, branch: string, recursive = true) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/tree/${branch}?recursive=${recursive}`),

  // Get file contents
  getFileContent: (owner: string, repo: string, path: string, ref: string) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}?ref=${ref}`),

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

  // Delete a file
  deleteFile: (owner: string, repo: string, path: string, data: { branch: string; sha?: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}`, {
      method: 'DELETE',
      body: data,
    }),

  // Rename a file
  renameFile: (owner: string, repo: string, oldPath: string, data: { newPath: string; branch: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/rename/${oldPath}`, {
      method: 'POST',
      body: data,
    }),

  // Delete a folder
  deleteFolder: (owner: string, repo: string, folderPath: string, data: { branch: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/folder/${folderPath}`, {
      method: 'DELETE',
      body: data,
    }),

  // Rename a folder
  renameFolder: (owner: string, repo: string, oldFolderPath: string, data: { newFolderPath: string; branch: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/rename-folder/${oldFolderPath}`, {
      method: 'POST',
      body: data,
    }),

  // Update/Create a file
  updateFile: (owner: string, repo: string, path: string, data: { content: string; branch: string; sha?: string; message?: string }) =>
    fetchApi(`/api/github/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: data,
    }),

  // Commit multiple files at once (for Code and Images editors)
  commit: (owner: string, repo: string, data: {
    branch: string;
    files?: Array<{ path: string; content: string; encoding?: string }>;
    images?: Array<{ path: string; content: string; beforeContent?: string }>;
    deletions?: string[];  // Array of file paths to delete
    message?: string;
  }) =>
    fetchApi<{
      success: boolean;
      data: {
        commitSha: string;
        message: string;
        branch: string;
        filesCommitted: number;
        htmlUrl: string;
      };
    }>(`/api/github/repos/${owner}/${repo}/commit`, {
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

  updateCodexAuth: (codexAuth: any) =>
    fetchApi('/api/user/codex-auth', {
      method: 'POST',
      body: { codexAuth },
    }),

  removeCodexAuth: () =>
    fetchApi('/api/user/codex-auth', {
      method: 'DELETE',
    }),

  // Gemini OAuth - accepts raw JSON from ~/.gemini/oauth_creds.json
  // Supports both camelCase and snake_case formats
  updateGeminiAuth: (geminiAuth: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenType?: string;
    scope?: string;
    // Also accept snake_case from Gemini CLI file
    access_token?: string;
    refresh_token?: string;
    expiry_date?: number;
    token_type?: string;
  }) =>
    fetchApi('/api/user/gemini-auth', {
      method: 'POST',
      body: { geminiAuth },
    }),

  removeGeminiAuth: () =>
    fetchApi('/api/user/gemini-auth', {
      method: 'DELETE',
    }),

  updatePreferredProvider: (provider: 'claude' | 'codex' | 'copilot' | 'gemini') =>
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

  updateDefaultLandingPage: (landingPage: 'store' | 'library' | 'community' | 'sessions') =>
    fetchApi('/api/user/default-landing-page', {
      method: 'POST',
      body: { landingPage },
    }),

  updatePreferredModel: (preferredModel: string) =>
    fetchApi('/api/user/preferred-model', {
      method: 'POST',
      body: { preferredModel },
    }),

  updateChatVerbosity: (verbosityLevel: 'minimal' | 'normal' | 'verbose') =>
    fetchApi('/api/user/chat-verbosity', {
      method: 'POST',
      body: { verbosityLevel },
    }),

  // Image AI settings
  updateImageAiKeys: (imageAiKeys: { openrouter?: string; cometapi?: string; google?: string }) =>
    fetchApi('/api/user/image-ai-keys', {
      method: 'POST',
      body: { imageAiKeys },
    }),

  updateImageAiProvider: (provider: 'openrouter' | 'cometapi' | 'google') =>
    fetchApi('/api/user/image-ai-provider', {
      method: 'POST',
      body: { provider },
    }),

  updateImageAiModel: (model: string) =>
    fetchApi('/api/user/image-ai-model', {
      method: 'POST',
      body: { model },
    }),

  // Autocomplete settings (OpenRouter for code completion)
  updateOpenRouterApiKey: (apiKey: string) =>
    fetchApi('/api/user/openrouter-api-key', {
      method: 'POST',
      body: { apiKey },
    }),

  removeOpenRouterApiKey: () =>
    fetchApi('/api/user/openrouter-api-key', {
      method: 'DELETE',
    }),

  updateAutocompleteSettings: (settings: { enabled?: boolean; model?: string }) =>
    fetchApi('/api/user/autocomplete-settings', {
      method: 'POST',
      body: settings,
    }),
};

// Image Generation API
export const imageGenApi = {
  generate: (data: {
    prompt: string;
    imageData?: string;
    selection?: { x: number; y: number; width: number; height: number };
    provider?: 'openrouter' | 'cometapi' | 'google';
    model?: string;
  }) =>
    fetchApi<{
      success: boolean;
      data?: { imageData: string; provider: string; model: string };
      error?: string;
    }>('/api/image-gen/generate', {
      method: 'POST',
      body: data,
    }),

  getModels: () =>
    fetchApi<{
      success: boolean;
      data: {
        models: Array<{ id: string; displayName: string; description: string; providers: string[] }>;
        providers: Array<{ id: string; name: string; description: string }>;
      };
    }>('/api/image-gen/models'),
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

  // Create an event (for streaming-style logs that show up in Chat)
  createEvent: (id: string, eventType: string, eventData: any) =>
    fetchApi(`/api/sessions/${id}/events`, {
      method: 'POST',
      body: { eventType, eventData },
    }),

  update: (id: string, data: { userRequest?: string; branch?: string }) =>
    fetchApi(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: data,
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

  // Create a code-only session (for file editing without AI execution)
  createCodeSession: (data: {
    title?: string;
    repositoryUrl?: string;
    repositoryOwner: string;
    repositoryName: string;
    baseBranch: string;
    branch: string;
  }) =>
    fetchApi('/api/sessions/create-code-session', {
      method: 'POST',
      body: data,
    }),

  // Get the URL for streaming events from a running session (for reconnection)
  getStreamUrl: (id: string) => `${getApiBaseUrl()}/api/sessions/${id}/stream`,

  // Check if a session has an active stream
  checkStreamActive: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${id}/stream`, {
        method: 'HEAD',
        credentials: 'include',
      });
      // 200 means there's an active stream, 204 means no active stream
      return response.status === 200;
    } catch {
      return false;
    }
  },

  // Abort a running session
  abort: (id: string) =>
    fetchApi(`/api/sessions/${id}/abort`, {
      method: 'POST',
    }),

  // Initialize repository for a session - clones repo and uploads to storage
  // This makes files immediately available before any AI execution
  initializeRepository: (id: string) =>
    fetchApi(`/api/sessions/${id}/init-repository`, {
      method: 'POST',
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

// Storage API (connects to internal-api-server storage routes)
export const storageApi = {
  listSessions: async () => {
    const response = await fetchApi('/api/storage/sessions');
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
    const response = await fetchApi(`/api/storage/sessions/${sessionId}`);
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
      const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionId}`, {
        method: 'HEAD',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  // List all files in a session
  listFiles: async (sessionPath: string): Promise<{ path: string; size: number; type: 'file' | 'directory' }[]> => {
    const response = await fetchApi(`/api/storage/sessions/${sessionPath}/files`);
    return response.files || [];
  },

  // Get a file's raw URL (for images, etc.)
  getFileUrl: (sessionPath: string, filePath: string): string => {
    return `${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`;
  },

  // Get file content as blob
  getFileBlob: async (sessionPath: string, filePath: string): Promise<Blob | null> => {
    const url = `${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`;
    try {
      const response = await fetch(url, {
        credentials: 'include',
      });
      if (!response.ok) {
        // Log detailed error info
        const errorText = await response.text().catch(() => '');
        console.log(`[Storage] getFileBlob error:`, {
          status: response.status,
          url,
          sessionPath,
          filePath,
          errorDetails: errorText.substring(0, 1000),
        });
        return null;
      }
      return await response.blob();
    } catch (error) {
      console.error(`[Storage] getFileBlob exception:`, error);
      return null;
    }
  },

  // Get file content as text
  getFileText: async (sessionPath: string, filePath: string): Promise<string | null> => {
    const url = `${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`;

    console.log(`[Storage] getFileText request:`, {
      sessionPath,
      filePath,
      url,
      apiBaseUrl: getApiBaseUrl(),
    });

    try {
      const response = await fetch(url, {
        credentials: 'include',
      });

      console.log(`[Storage] getFileText response:`, {
        status: response.status,
        ok: response.ok,
        url,
      });

      if (!response.ok) {
        // Try to get error details
        const errorText = await response.text().catch(() => '');
        console.log(`[Storage] getFileText error details:`, {
          status: response.status,
          errorText: errorText.substring(0, 500),
        });
        return null;
      }
      return await response.text();
    } catch (error) {
      console.error(`[Storage] getFileText exception:`, error);
      return null;
    }
  },

  // Write/update a file in a session
  writeFile: async (sessionPath: string, filePath: string, content: string | Blob): Promise<boolean> => {
    const body = typeof content === 'string' ? content : content;
    const contentType = typeof content === 'string' ? 'text/plain; charset=utf-8' : content.type;
    const contentSize = typeof content === 'string' ? content.length : content.size;
    const url = `${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`;

    console.log(`[Storage] Writing file:`, {
      sessionPath,
      filePath,
      contentType,
      contentSize,
      url,
      apiBaseUrl: getApiBaseUrl(),
    });

    try {
      const response = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': contentType,
        },
        body,
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        console.log(`[Storage] Successfully wrote file:`, {
          filePath,
          status: response.status,
          response: data,
        });
        return true;
      } else {
        // Try to get error details from response
        let errorBody: string | object = '';
        try {
          errorBody = await response.json();
        } catch {
          try {
            errorBody = await response.text();
          } catch {
            errorBody = '(could not read response body)';
          }
        }

        console.error(`[Storage] Failed to write file:`, {
          filePath,
          sessionPath,
          url,
          status: response.status,
          statusText: response.statusText,
          errorBody,
          headers: Object.fromEntries(response.headers.entries()),
        });

        // If 404, run diagnostics to understand why
        if (response.status === 404) {
          console.log(`[Storage] Running diagnostics for 404 error...`);

          // Check if session exists
          try {
            const sessionCheckUrl = `${getApiBaseUrl()}/api/storage/sessions/${sessionPath}`;
            const sessionCheck = await fetch(sessionCheckUrl, {
              method: 'HEAD',
              credentials: 'include',
            });
            console.log(`[Storage] Session exists check:`, {
              url: sessionCheckUrl,
              exists: sessionCheck.ok,
              status: sessionCheck.status,
            });
          } catch (e) {
            console.log(`[Storage] Session exists check failed:`, e);
          }

          // Check if we can list sessions at all (to verify API is reachable)
          try {
            const listUrl = `${getApiBaseUrl()}/api/storage/sessions`;
            const listCheck = await fetch(listUrl, {
              method: 'GET',
              credentials: 'include',
            });
            const listData = await listCheck.json().catch(() => null);
            console.log(`[Storage] List sessions check:`, {
              url: listUrl,
              ok: listCheck.ok,
              status: listCheck.status,
              sessionCount: listData?.count ?? 'unknown',
            });
          } catch (e) {
            console.log(`[Storage] List sessions check failed:`, e);
          }
        }

        return false;
      }
    } catch (error) {
      console.error(`[Storage] Network error writing file:`, {
        filePath,
        sessionPath,
        url,
        error: error instanceof Error ? error.message : error,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
  },

  // Delete a file from a session
  deleteFile: async (sessionPath: string, filePath: string): Promise<boolean> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/files/${filePath}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  // Delete a folder (and all its contents) from a session
  deleteFolder: async (sessionPath: string, folderPath: string): Promise<{ success: boolean; filesDeleted?: number }> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/storage/sessions/${sessionPath}/folders/${folderPath}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        return { success: true, filesDeleted: data.filesDeleted };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  },
};

// Backwards compatibility alias
export const storageWorkerApi = storageApi;

// Execute API (SSE)
export function createExecuteEventSource(data: {
  userRequest: string;
  provider?: 'claude' | 'codex' | 'copilot' | 'gemini';
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
  if (data.provider !== undefined) {
    params.append('provider', data.provider);
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

  const fullUrl = `${getApiBaseUrl()}/api/execute?${params}`;
  console.log('[API] Creating EventSource with URL:', fullUrl);
  console.log('[API] API_BASE_URL:', getApiBaseUrl());
  console.log('[API] Selected provider:', data.provider || 'default');

  return new EventSource(fullUrl, {
    withCredentials: true,
  });
}
