/**
 * Tests for API Client
 * Covers the core fetchApi wrapper, CSRF protection, path-based routing,
 * and individual API modules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResponse,
  setMockCsrfCookie,
  clearMockCookies,
} from '../mocks/api';
import { MockEventSource } from '../mocks/eventSource';

// Store original fetch and EventSource
const originalFetch = global.fetch;
const originalEventSource = global.EventSource;

describe('API Client', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock EventSource globally
    global.EventSource = MockEventSource as unknown as typeof EventSource;

    // Reset cached API base URL
    vi.resetModules();

    // Set default mock location
    Object.defineProperty(window, 'location', {
      value: { pathname: '/', href: 'http://localhost/' },
      writable: true,
      configurable: true,
    });

    // Set a CSRF cookie for tests
    setMockCsrfCookie('test-csrf-token');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.EventSource = originalEventSource;
    clearMockCookies();
  });

  describe('fetchApi Core', () => {
    it('should make GET request with correct headers', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: { test: 'data' } }));

      // Dynamic import to get fresh module
      const { authApi } = await import('../../src/lib/api');
      await authApi.getSession();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/session'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'include',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should make POST request with JSON body', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
        })
      );

      const { authApi } = await import('../../src/lib/api');
      await authApi.login('test@example.com', 'password123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/login'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('password123'),
        })
      );
    });

    it('should throw error on non-OK response', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          error: 'Invalid credentials',
        })
      );

      const { authApi } = await import('../../src/lib/api');

      await expect(authApi.login('test@example.com', 'wrong')).rejects.toThrow(
        'Invalid credentials'
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const { authApi } = await import('../../src/lib/api');

      await expect(authApi.getSession()).rejects.toThrow('Network error');
    });
  });

  describe('CSRF Protection', () => {
    it('should include CSRF token in POST requests', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
        })
      );

      const { authApi } = await import('../../src/lib/api');
      await authApi.login('test@example.com', 'password');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-csrf-token': 'test-csrf-token',
          }),
        })
      );
    });

    it('should include CSRF token in DELETE requests', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { userApi } = await import('../../src/lib/api');
      await userApi.removeClaudeAuth();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            'x-csrf-token': 'test-csrf-token',
          }),
        })
      );
    });

    it('should include CSRF token in PUT requests', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { githubApi } = await import('../../src/lib/api');
      await githubApi.updateFile('owner', 'repo', 'path/to/file', {
        content: 'new content',
        branch: 'main',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'x-csrf-token': 'test-csrf-token',
          }),
        })
      );
    });

    it('should include CSRF token in PATCH requests', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { sessionsApi } = await import('../../src/lib/api');
      await sessionsApi.update('session-123', { userRequest: 'Updated request' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            'x-csrf-token': 'test-csrf-token',
          }),
        })
      );
    });

    it('should NOT include CSRF token in GET requests', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, data: { success: true, data: { user: null } } })
      );

      const { authApi } = await import('../../src/lib/api');
      await authApi.getSession();

      // Verify the call was made
      expect(mockFetch).toHaveBeenCalled();

      // Check that CSRF token is NOT in the headers
      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers).not.toHaveProperty('x-csrf-token');
    });

    it('should handle missing CSRF cookie', async () => {
      clearMockCookies();

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { authApi } = await import('../../src/lib/api');
      await authApi.logout();

      // Should warn about missing token
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('CSRF token missing')
      );

      consoleSpy.mockRestore();
    });

    it('should decode URI-encoded CSRF token', async () => {
      // Set a URI-encoded token
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: 'csrf_token=' + encodeURIComponent('token/with+special=chars'),
      });

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { authApi } = await import('../../src/lib/api');
      await authApi.logout();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-csrf-token': 'token/with+special=chars',
          }),
        })
      );
    });
  });

  describe('Path-Based Routing', () => {
    it('should use empty base URL for root path', async () => {
      Object.defineProperty(window, 'location', {
        value: { pathname: '/', href: 'http://localhost/' },
        writable: true,
        configurable: true,
      });

      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, data: { success: true, data: { user: null } } })
      );

      // Force re-import to reset cached URL
      vi.resetModules();
      const { authApi } = await import('../../src/lib/api');
      await authApi.getSession();

      expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', expect.anything());
    });

    it('should detect /github/owner/repo/branch pattern', async () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/github/anthropic/claude-code/main/chat',
          href: 'http://localhost/github/anthropic/claude-code/main/chat',
        },
        writable: true,
        configurable: true,
      });

      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, data: { success: true, data: { user: null } } })
      );

      vi.resetModules();
      const { authApi } = await import('../../src/lib/api');
      await authApi.getSession();

      expect(mockFetch).toHaveBeenCalledWith(
        '/github/anthropic/claude-code/main/api/auth/session',
        expect.anything()
      );
    });

    it('should detect /owner/repo/branch pattern', async () => {
      Object.defineProperty(window, 'location', {
        value: {
          pathname: '/myorg/myrepo/feature-branch/dashboard',
          href: 'http://localhost/myorg/myrepo/feature-branch/dashboard',
        },
        writable: true,
        configurable: true,
      });

      mockFetch.mockResolvedValue(
        createMockResponse({ ok: true, data: { success: true, data: { user: null } } })
      );

      vi.resetModules();
      const { authApi } = await import('../../src/lib/api');
      await authApi.getSession();

      expect(mockFetch).toHaveBeenCalledWith(
        '/myorg/myrepo/feature-branch/api/auth/session',
        expect.anything()
      );
    });

    it('should use empty base URL for app routes', async () => {
      const appRoutes = ['login', 'register', 'dashboard', 'settings', 'admin'];

      for (const route of appRoutes) {
        Object.defineProperty(window, 'location', {
          value: { pathname: `/${route}`, href: `http://localhost/${route}` },
          writable: true,
          configurable: true,
        });

        mockFetch.mockResolvedValue(
          createMockResponse({ ok: true, data: { success: true, data: { user: null } } })
        );

        vi.resetModules();
        const { authApi } = await import('../../src/lib/api');
        await authApi.getSession();

        expect(mockFetch).toHaveBeenCalledWith('/api/auth/session', expect.anything());
      }
    });
  });

  describe('Auth API', () => {
    it('should register a new user', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { user: { id: 'new-user', email: 'new@example.com' } } },
        })
      );

      const { authApi } = await import('../../src/lib/api');
      const result = await authApi.register('new@example.com', 'password123');

      expect(result.user.email).toBe('new@example.com');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/register'),
        expect.objectContaining({
          body: expect.stringContaining('new@example.com'),
        })
      );
    });

    it('should normalize email to lowercase', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
        })
      );

      const { authApi } = await import('../../src/lib/api');
      await authApi.login('TEST@EXAMPLE.COM', 'password');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('test@example.com'),
        })
      );
    });

    it('should pass rememberMe flag', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { user: { id: 'user-1', email: 'test@example.com' } } },
        })
      );

      const { authApi } = await import('../../src/lib/api');
      await authApi.login('test@example.com', 'password', true);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.rememberMe).toBe(true);
    });
  });

  describe('Sessions API', () => {
    it('should list sessions', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: {
              sessions: [
                { id: 'session-1', title: 'Test Session' },
                { id: 'session-2', title: 'Another Session' },
              ],
            },
          },
        })
      );

      const { sessionsApi } = await import('../../src/lib/api');
      const result = await sessionsApi.list();

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].id).toBe('session-1');
    });

    it('should search sessions with query params', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: {
              sessions: [],
              total: 0,
              limit: 20,
              offset: 0,
              hasMore: false,
              query: 'test',
            },
          },
        })
      );

      const { sessionsApi } = await import('../../src/lib/api');
      await sessionsApi.search({ q: 'test', limit: 20, favorite: true });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/q=test.*limit=20.*favorite=true/),
        expect.anything()
      );
    });

    it('should get stream URL', async () => {
      const { sessionsApi } = await import('../../src/lib/api');
      const url = sessionsApi.getStreamUrl('session-123');

      expect(url).toContain('/api/sessions/session-123/events/stream');
    });

    it('should abort a session', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { sessionsApi } = await import('../../src/lib/api');
      await sessionsApi.abort('session-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/sessions/session-123/abort'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should toggle favorite', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, session: { id: 'session-1', favorite: true } },
        })
      );

      const { sessionsApi } = await import('../../src/lib/api');
      const result = await sessionsApi.toggleFavorite('session-1');

      expect(result.session.favorite).toBe(true);
    });

    it('should delete sessions in bulk', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { sessionsApi } = await import('../../src/lib/api');
      await sessionsApi.deleteBulk(['session-1', 'session-2', 'session-3']);

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.ids).toEqual(['session-1', 'session-2', 'session-3']);
    });
  });

  describe('GitHub API', () => {
    it('should get repositories', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: [
              { id: 'repo-1', name: 'repo1', full_name: 'owner/repo1' },
              { id: 'repo-2', name: 'repo2', full_name: 'owner/repo2' },
            ],
          },
        })
      );

      const { githubApi } = await import('../../src/lib/api');
      const result = await githubApi.getRepos();

      expect(result.repos).toHaveLength(2);
    });

    it('should get branches for a repo', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: [
              { name: 'main', protected: true },
              { name: 'develop', protected: false },
            ],
          },
        })
      );

      const { githubApi } = await import('../../src/lib/api');
      const result = await githubApi.getBranches('owner', 'repo');

      expect(result.branches).toHaveLength(2);
      expect(result.branches[0].name).toBe('main');
    });

    it('should create a branch', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { githubApi } = await import('../../src/lib/api');
      await githubApi.createBranch('owner', 'repo', {
        branchName: 'feature-new',
        baseBranch: 'main',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/github/repos/owner/repo/branches'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('feature-new'),
        })
      );
    });

    it('should get file content', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            content: 'file content',
            encoding: 'utf-8',
          },
        })
      );

      const { githubApi } = await import('../../src/lib/api');
      const result = await githubApi.getFileContent('owner', 'repo', 'path/to/file.ts', 'main');

      expect(result.content).toBe('file content');
    });

    it('should get pull requests with filters', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { pulls: [] },
        })
      );

      const { githubApi } = await import('../../src/lib/api');
      await githubApi.getPulls('owner', 'repo', 'feature-branch', 'main');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/head=feature-branch.*base=main/),
        expect.anything()
      );
    });

    it('should commit files', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { sha: 'new-commit-sha', url: 'https://github.com/...' },
        })
      );

      const { githubApi } = await import('../../src/lib/api');
      const result = await githubApi.commit('owner', 'repo', {
        branch: 'main',
        files: [{ path: 'file.txt', content: 'new content' }],
        message: 'Update file',
      });

      expect(result.sha).toBe('new-commit-sha');
    });
  });

  describe('Collections API', () => {
    it('should list collections', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: {
              collections: [{ id: 'col-1', name: 'Favorites' }],
              total: 1,
            },
          },
        })
      );

      const { collectionsApi } = await import('../../src/lib/api');
      const result = await collectionsApi.list();

      expect(result.collections).toHaveLength(1);
      expect(result.collections[0].name).toBe('Favorites');
    });

    it('should create a collection', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: { collection: { id: 'new-col', name: 'New Collection' } },
          },
        })
      );

      const { collectionsApi } = await import('../../src/lib/api');
      const result = await collectionsApi.create({
        name: 'New Collection',
        color: '#ff0000',
      });

      expect(result.collection.name).toBe('New Collection');
    });

    it('should add session to collection', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { membership: { collectionId: 'col-1', sessionId: 'session-1' } } },
        })
      );

      const { collectionsApi } = await import('../../src/lib/api');
      await collectionsApi.addSession('col-1', 'session-1');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/collections/col-1/sessions/session-1'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Admin API', () => {
    it('should list users', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            users: [
              { id: 'user-1', email: 'admin@example.com', isAdmin: true },
              { id: 'user-2', email: 'user@example.com', isAdmin: false },
            ],
          },
        })
      );

      const { adminApi } = await import('../../src/lib/api');
      const result = await adminApi.listUsers();

      expect(result.users).toHaveLength(2);
    });

    it('should create a user', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { user: { id: 'new-user', email: 'new@example.com' } },
        })
      );

      const { adminApi } = await import('../../src/lib/api');
      const result = await adminApi.createUser({
        email: 'new@example.com',
        password: 'password123',
        isAdmin: true,
      });

      expect(result.user.email).toBe('new@example.com');
    });

    it('should impersonate a user', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { adminApi } = await import('../../src/lib/api');
      await adminApi.impersonateUser('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/users/user-123/impersonate'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('User API', () => {
    it('should update display name', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { userApi } = await import('../../src/lib/api');
      await userApi.updateDisplayName('New Name');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.displayName).toBe('New Name');
    });

    it('should update preferred provider', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, data: {} }));

      const { userApi } = await import('../../src/lib/api');
      await userApi.updatePreferredProvider('claude');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.provider).toBe('claude');
    });

    it('should get spending limits', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: {
              enabled: true,
              monthlyBudgetCents: '10000',
              currentMonthSpentCents: '5000',
              usagePercent: 50,
            },
          },
        })
      );

      const { userApi } = await import('../../src/lib/api');
      const result = await userApi.getSpendingLimits();

      expect(result.enabled).toBe(true);
      expect(result.usagePercent).toBe(50);
    });
  });

  describe('Orchestrator API', () => {
    it('should create an orchestrator job', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: {
            success: true,
            data: { id: 'job-1', status: 'pending' },
          },
        })
      );

      const { orchestratorApi } = await import('../../src/lib/api');
      await orchestratorApi.create({
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        baseBranch: 'main',
        requestDocument: 'Build a new feature',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/orchestrator'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should get stream URL', async () => {
      const { orchestratorApi } = await import('../../src/lib/api');
      const url = orchestratorApi.getStreamUrl('job-123');

      expect(url).toContain('/api/orchestrator/job-123/stream');
    });

    it('should start a job', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { success: true, data: { message: 'Job started' } },
        })
      );

      const { orchestratorApi } = await import('../../src/lib/api');
      await orchestratorApi.start('job-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/orchestrator/job-123/start'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Storage Worker API', () => {
    it('should list files', async () => {
      mockFetch.mockResolvedValue(
        createMockResponse({
          ok: true,
          data: { files: ['file1.ts', 'file2.ts', 'dir/file3.ts'] },
        })
      );

      const { storageWorkerApi } = await import('../../src/lib/api');
      const result = await storageWorkerApi.listFiles('session-path');

      expect(result.files).toHaveLength(3);
    });

    it('should get file as text', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('file content here'),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const { storageWorkerApi } = await import('../../src/lib/api');
      const content = await storageWorkerApi.getFileText('session-path', 'file.txt');

      expect(content).toBe('file content here');
    });

    it('should write file with CSRF token', async () => {
      mockFetch.mockResolvedValue(createMockResponse({ ok: true }));

      const { storageWorkerApi } = await import('../../src/lib/api');
      await storageWorkerApi.writeFile('session-path', 'file.txt', 'new content');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'x-csrf-token': 'test-csrf-token',
          }),
          body: 'new content',
        })
      );
    });

    it('should check file exists', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const { storageWorkerApi } = await import('../../src/lib/api');
      const exists = await storageWorkerApi.checkFileExists('session-path', 'file.txt');

      expect(exists).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'HEAD' })
      );
    });
  });

  describe('isApiError helper', () => {
    it('should identify API errors', async () => {
      const { isApiError } = await import('../../src/lib/api');

      expect(isApiError({ message: 'Error', status: 400 })).toBe(true);
      expect(isApiError({ message: 'Error', status: 400, data: { foo: 'bar' } })).toBe(true);
    });

    it('should reject non-API errors', async () => {
      const { isApiError } = await import('../../src/lib/api');

      expect(isApiError(null)).toBe(false);
      expect(isApiError(undefined)).toBe(false);
      expect(isApiError('string error')).toBe(false);
      expect(isApiError({ message: 'Error' })).toBe(false); // Missing status
      expect(isApiError({ status: 400 })).toBe(false); // Missing message
    });
  });

  describe('EventSource Creation', () => {
    it('should create execute remote event source with correct URL', async () => {
      const { createExecuteRemoteEventSource } = await import('../../src/lib/api');

      const eventSource = createExecuteRemoteEventSource({
        userRequest: 'Test request',
        websiteSessionId: 'session-123',
        github: { repoUrl: 'https://github.com/owner/repo' },
      });

      expect(eventSource.url).toContain('/api/execute-remote');
      expect(eventSource.url).toContain('userRequest=');
      expect(eventSource.url).toContain('websiteSessionId=session-123');
      expect(eventSource.url).toContain('github=');

      eventSource.close();
    });

    it('should create session execute event source', async () => {
      const { createSessionExecuteEventSource } = await import('../../src/lib/api');

      const eventSource = createSessionExecuteEventSource({
        id: 'session-123',
        userRequest: 'Build a feature',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      expect(eventSource.url).toContain('/api/execute-remote');
      expect(eventSource.url).toContain('websiteSessionId=session-123');
      expect(eventSource.url).toContain('userRequest=');

      eventSource.close();
    });
  });
});
