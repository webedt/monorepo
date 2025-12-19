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

  // SPECIAL CASE: Check for /github/owner/repo/branch/ pattern FIRST
  // This is path-based routing even though 'github' looks like an app route
  if (pathSegments[0] === 'github' && pathSegments.length >= 4) {
    cachedApiBaseUrl = `/${pathSegments[0]}/${pathSegments[1]}/${pathSegments[2]}/${pathSegments[3]}`;
  } else {
    // Check if we're in a path-based deployment and first segment is not a route name
    const appRoutes = ['login', 'register', 'session', 'sessions', 'agents', 'orchestrator', 'trash', 'settings', 'admin',
                       'code', 'images', 'sound', 'scene-editor', 'preview', 'library', 'community',
                       'item', 'store', 'quick-setup', 'dashboard', 'landing', 'editor', 'image-editor', 'workspace'];

    if (pathSegments.length >= 1 && !appRoutes.includes(pathSegments[0])) {
      // Check for monorepo pattern: /owner/repo/website/branch/
      if (pathSegments.length >= 4 && pathSegments[2] === 'website') {
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

  console.log(`[fetchApi] Response for ${fullUrl}:`, {
    status: response.status,
    ok: response.ok,
    statusText: response.statusText
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[fetchApi] Error for ${fullUrl}:`, error);
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

  updatePreferredProvider: (provider: 'claude' | 'codex' | 'copilot' | 'gemini' | 'claude-remote') =>
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

  updateDefaultLandingPage: (landingPage: 'dashboard' | 'store' | 'library' | 'community' | 'sessions') =>
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
  // eventData should be the raw event object containing 'type' field
  createEvent: (id: string, eventData: any) =>
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

  // Get the URL for streaming events from a session (SSE endpoint)
  // Pattern: GET /api/sessions/:id/events/stream
  // Aligns with Claude's /v1/sessions/:id/events pattern
  getStreamUrl: (id: string) => `${getApiBaseUrl()}/api/sessions/${id}/events/stream`,

  // Check if a session stream is available
  // Returns true if session exists (stream will replay events and/or provide live updates)
  checkStreamActive: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/sessions/${id}/events/stream`, {
        method: 'HEAD',
        credentials: 'include',
      });
      // 200 means stream is available
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

  // Sync sessions from Anthropic's Claude Remote API
  // Imports any sessions created on claude.ai that don't exist locally
  sync: (params?: { activeOnly?: boolean; limit?: number }) => {
    const queryParams = new URLSearchParams();
    if (params?.activeOnly !== undefined) queryParams.append('activeOnly', String(params.activeOnly));
    if (params?.limit) queryParams.append('limit', String(params.limit));
    const queryString = queryParams.toString();
    return fetchApi(`/api/sessions/sync${queryString ? `?${queryString}` : ''}`, {
      method: 'POST',
    });
  },

  // Sync events for a specific session from Anthropic API
  syncEvents: (id: string) =>
    fetchApi(`/api/sessions/${id}/sync-events`, {
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

  // Logs management
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
    fetchApi('/api/logs', {
      method: 'DELETE',
    }),

  getLogsStatus: () => fetchApi('/api/logs/status'),
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

// Live Chat API (branch-based workspace chat)
export const liveChatApi = {
  // Get messages for a branch-based live chat
  getMessages: (owner: string, repo: string, branch: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages${queryString ? `?${queryString}` : ''}`);
  },

  // Add a message to a branch-based live chat
  addMessage: (owner: string, repo: string, branch: string, data: {
    role: 'user' | 'assistant';
    content: string;
    images?: Array<{ id: string; data: string; mediaType: string; fileName?: string }>;
  }) =>
    fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages`, {
      method: 'POST',
      body: data,
    }),

  // Clear all messages for a branch-based live chat
  clearMessages: (owner: string, repo: string, branch: string) =>
    fetchApi(`/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/messages`, {
      method: 'DELETE',
    }),

  // Get execute URL for SSE streaming
  getExecuteUrl: (owner: string, repo: string, branch: string) =>
    `${getApiBaseUrl()}/api/live-chat/${owner}/${repo}/${encodeURIComponent(branch)}/execute`,

  // Create an EventSource for live chat execution
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
    console.log('[LiveChat] Creating EventSource with URL:', fullUrl);

    return new EventSource(fullUrl, {
      withCredentials: true,
    });
  },
};

// Workspace API (collaboration - presence and events)
export const workspaceApi = {
  // Update presence on a branch
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
    fetchApi('/api/workspace/presence', {
      method: 'PUT',
      body: data,
    }),

  // Get active users on a branch
  getPresence: (owner: string, repo: string, branch: string) =>
    fetchApi(`/api/workspace/presence/${owner}/${repo}/${encodeURIComponent(branch)}`),

  // Remove presence (leaving workspace)
  leaveWorkspace: (owner: string, repo: string, branch: string) =>
    fetchApi(`/api/workspace/presence/${owner}/${repo}/${encodeURIComponent(branch)}`, {
      method: 'DELETE',
    }),

  // Log a workspace event
  logEvent: (data: {
    owner: string;
    repo: string;
    branch: string;
    eventType: string;
    page?: string;
    path?: string;
    payload?: Record<string, unknown>;
  }) =>
    fetchApi('/api/workspace/events', {
      method: 'POST',
      body: data,
    }),

  // Get recent events for a branch
  getEvents: (owner: string, repo: string, branch: string, options?: { limit?: number; since?: string }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.since) params.append('since', options.since);
    const queryString = params.toString();
    return fetchApi(`/api/workspace/events/${owner}/${repo}/${encodeURIComponent(branch)}${queryString ? `?${queryString}` : ''}`);
  },

  // Get event stream URL (SSE)
  getEventStreamUrl: (owner: string, repo: string, branch: string) =>
    `${getApiBaseUrl()}/api/workspace/events/${owner}/${repo}/${encodeURIComponent(branch)}/stream`,
};

// Execute API (SSE)
export function createExecuteEventSource(data: {
  userRequest: string;
  provider?: 'claude' | 'codex' | 'copilot' | 'gemini' | 'claude-remote';
  github?: {
    repoUrl: string;
  };
  autoCommit?: boolean;
  websiteSessionId?: string;
}) {
  // If provider is claude-remote, use the execute-remote endpoint
  if (data.provider === 'claude-remote') {
    return createExecuteRemoteEventSource(data);
  }

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

// Execute Remote API (Claude Remote Sessions - SSE)
// Uses Anthropic's Remote Sessions API instead of local ai-coding-worker
export function createExecuteRemoteEventSource(data: {
  userRequest: string;
  provider?: string;
  github?: {
    repoUrl: string;
  };
  autoCommit?: boolean;
  websiteSessionId?: string;
}) {
  const params = new URLSearchParams();

  // Add params
  if (data.userRequest !== undefined) {
    params.append('userRequest', String(data.userRequest));
  }
  if (data.websiteSessionId !== undefined) {
    params.append('websiteSessionId', String(data.websiteSessionId));
  }

  // GitHub is required for execute-remote
  if (data.github) {
    params.append('github', JSON.stringify(data.github));
  }

  const fullUrl = `${getApiBaseUrl()}/api/execute-remote?${params}`;
  console.log('[API] Creating Claude Remote EventSource with URL:', fullUrl);
  console.log('[API] API_BASE_URL:', getApiBaseUrl());

  return new EventSource(fullUrl, {
    withCredentials: true,
  });
}

// Orchestrator API - Long-running multi-cycle agent orchestration
export interface OrchestratorJob {
  id: string;
  userId: string;
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch: string;
  sessionPath: string;
  requestDocument: string;
  taskList: string | null;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';
  currentCycle: number;
  maxCycles: number | null;
  timeLimitMinutes: number | null;
  maxParallelTasks: number;
  provider: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestratorCycle {
  id: string;
  jobId: string;
  cycleNumber: number;
  phase: string;
  tasksDiscovered: number;
  tasksLaunched: number;
  tasksCompleted: number;
  tasksFailed: number;
  summary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface OrchestratorTask {
  id: string;
  cycleId: string;
  jobId: string;
  taskNumber: number;
  description: string;
  context: string | null;
  priority: string;
  canRunParallel: boolean;
  status: string;
  agentSessionId: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  resultSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

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
  // Create a new orchestrator job
  create: (data: CreateOrchestratorJobRequest) =>
    fetchApi<{ success: boolean; data: OrchestratorJob }>('/api/orchestrator', {
      method: 'POST',
      body: data,
    }),

  // List all jobs for current user
  list: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    const queryString = params.toString();
    return fetchApi<{ success: boolean; data: OrchestratorJob[] }>(
      `/api/orchestrator${queryString ? `?${queryString}` : ''}`
    );
  },

  // Get a specific job with its cycles
  get: (id: string) =>
    fetchApi<{ success: boolean; data: OrchestratorJob & { cycles: OrchestratorCycle[] } }>(
      `/api/orchestrator/${id}`
    ),

  // Start a pending or paused job
  start: (id: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/start`, {
      method: 'POST',
    }),

  // Pause a running job
  pause: (id: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/pause`, {
      method: 'POST',
    }),

  // Resume a paused job
  resume: (id: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/resume`, {
      method: 'POST',
    }),

  // Cancel a job
  cancel: (id: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/cancel`, {
      method: 'POST',
    }),

  // Get cycles for a job
  getCycles: (id: string) =>
    fetchApi<{ success: boolean; data: OrchestratorCycle[] }>(`/api/orchestrator/${id}/cycles`),

  // Get a specific cycle with its tasks
  getCycle: (jobId: string, cycleNumber: number) =>
    fetchApi<{ success: boolean; data: OrchestratorCycle & { tasks: OrchestratorTask[] } }>(
      `/api/orchestrator/${jobId}/cycles/${cycleNumber}`
    ),

  // Update request document
  updateRequestDocument: (id: string, requestDocument: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/request`, {
      method: 'PUT',
      body: { requestDocument },
    }),

  // Update task list
  updateTaskList: (id: string, taskList: string) =>
    fetchApi<{ success: boolean; message: string }>(`/api/orchestrator/${id}/tasklist`, {
      method: 'PUT',
      body: { taskList },
    }),

  // Get SSE stream URL for job events
  getStreamUrl: (id: string) => `${getApiBaseUrl()}/api/orchestrator/${id}/stream`,

  // Create EventSource for job events
  createEventSource: (id: string) => {
    const url = `${getApiBaseUrl()}/api/orchestrator/${id}/stream`;
    console.log('[Orchestrator] Creating EventSource:', url);
    return new EventSource(url, { withCredentials: true });
  },
};
