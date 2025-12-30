/**
 * Mock API Layer
 * Provides mocks for testing API calls with configurable responses
 */

import { vi } from 'vitest';

/**
 * Mock response configuration
 */
export interface MockResponse<T = unknown> {
  ok?: boolean;
  status?: number;
  statusText?: string;
  data?: T;
  error?: string;
  headers?: Record<string, string>;
}

/**
 * Create a mock fetch response
 */
export function createMockResponse<T>(config: MockResponse<T> = {}): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    data,
    error,
    headers = {},
  } = config;

  const body = ok ? data : { error: error || 'Request failed' };

  return {
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    blob: vi.fn().mockResolvedValue(new Blob([JSON.stringify(body)])),
    clone: vi.fn().mockReturnThis(),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    formData: vi.fn().mockResolvedValue(new FormData()),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
  } as unknown as Response;
}

/**
 * Create a mock fetch function with configurable responses
 */
export function createMockFetch(responses: Map<string, MockResponse> = new Map()) {
  return vi.fn().mockImplementation((url: string, _options?: RequestInit) => {
    // Find matching response by URL pattern
    for (const [pattern, response] of responses.entries()) {
      if (url.includes(pattern)) {
        return Promise.resolve(createMockResponse(response));
      }
    }

    // Default success response
    return Promise.resolve(createMockResponse({ ok: true, data: {} }));
  });
}

/**
 * Mock successful API responses for common endpoints
 */
export const mockApiResponses = {
  // Auth API
  '/api/auth/session': {
    ok: true,
    data: { success: true, data: { user: null } },
  },
  '/api/auth/login': {
    ok: true,
    data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
  },
  '/api/auth/register': {
    ok: true,
    data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
  },
  '/api/auth/logout': {
    ok: true,
    data: { success: true },
  },
  '/api/auth/csrf-token': {
    ok: true,
    data: { success: true, data: { csrfToken: 'test-csrf-token', headerName: 'x-csrf-token' } },
  },

  // Sessions API
  '/api/sessions': {
    ok: true,
    data: { success: true, data: { sessions: [] } },
  },

  // GitHub API
  '/api/github/repos': {
    ok: true,
    data: { success: true, data: [] },
  },
};

/**
 * Setup global fetch mock for tests
 */
export function setupFetchMock(customResponses: Record<string, MockResponse> = {}) {
  const allResponses = new Map<string, MockResponse>();

  // Add default responses
  Object.entries(mockApiResponses).forEach(([url, response]) => {
    allResponses.set(url, response);
  });

  // Add custom responses (override defaults)
  Object.entries(customResponses).forEach(([url, response]) => {
    allResponses.set(url, response);
  });

  const mockFetch = createMockFetch(allResponses);
  vi.stubGlobal('fetch', mockFetch);

  return mockFetch;
}

/**
 * Create mock cookies for CSRF testing
 */
export function setMockCsrfCookie(token: string = 'test-csrf-token') {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: `csrf_token=${token}`,
  });
}

/**
 * Clear mock cookies
 */
export function clearMockCookies() {
  Object.defineProperty(document, 'cookie', {
    writable: true,
    value: '',
  });
}

/**
 * Mock window.location for path-based routing tests
 */
export function setMockLocation(pathname: string) {
  Object.defineProperty(window, 'location', {
    value: { pathname, href: `http://localhost${pathname}` },
    writable: true,
  });
}

/**
 * Reset window.location to default
 */
export function resetMockLocation() {
  setMockLocation('/');
}
