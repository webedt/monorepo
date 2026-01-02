/**
 * Custom Playwright Test Fixtures
 *
 * Provides reusable fixtures for authenticated tests, page helpers,
 * and test data management.
 */

import { test as base, expect, type Page, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Test user credentials for E2E testing
 */
export interface TestUser {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Default test user for authenticated tests
 */
export const TEST_USER: TestUser = {
  email: `e2e-test-${Date.now()}@example.com`,
  password: 'TestPassword123!',
  displayName: 'E2E Test User',
};

/**
 * Storage state paths for different auth states
 */
export const STORAGE_STATE_PATH = path.join(__dirname, '../.auth/user.json');
export const ADMIN_STORAGE_STATE_PATH = path.join(__dirname, '../.auth/admin.json');

/**
 * Page Object Model helpers for common operations
 */
export class AuthHelpers {
  constructor(private page: Page) {}

  /**
   * Navigate to login page
   */
  async goToLogin(): Promise<void> {
    await this.page.goto('/#/login');
    await this.page.waitForSelector('.login-page');
  }

  /**
   * Navigate to register page
   */
  async goToRegister(): Promise<void> {
    await this.page.goto('/#/register');
    await this.page.waitForSelector('.login-page');
  }

  /**
   * Fill and submit login form
   */
  async login(email: string, password: string): Promise<void> {
    await this.goToLogin();
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', password);
    await this.page.click('button[type="submit"]');
  }

  /**
   * Fill and submit registration form
   */
  async register(email: string, password: string): Promise<void> {
    await this.goToRegister();
    await this.page.fill('input[type="email"]', email);
    await this.page.locator('input[type="password"]').first().fill(password);
    await this.page.locator('input[type="password"]').last().fill(password);
    await this.page.click('button[type="submit"]');
  }

  /**
   * Logout the current user
   */
  async logout(): Promise<void> {
    // Navigate to settings and click logout, or use API
    await this.page.goto('/#/settings');
    await this.page.click('text=Logout');
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    // Check if the URL redirects away from login or if authenticated elements are visible
    const url = this.page.url();
    return !url.includes('/login') && !url.includes('/register');
  }

  /**
   * Wait for authentication redirect
   */
  async waitForAuthRedirect(): Promise<void> {
    await this.page.waitForURL(/.*\/(agents|dashboard|chat)/);
  }
}

/**
 * Page helpers for common DOM operations
 */
export class PageHelpers {
  constructor(private page: Page) {}

  /**
   * Get all visible toast messages
   */
  async getToastMessages(): Promise<string[]> {
    const toasts = await this.page.locator('.toast, .toast-message, [role="alert"]').all();
    return Promise.all(toasts.map(toast => toast.textContent() ?? ''));
  }

  /**
   * Wait for a toast message to appear
   */
  async waitForToast(text: string, timeout = 5000): Promise<void> {
    await this.page.locator(`.toast:has-text("${text}"), [role="alert"]:has-text("${text}")`).waitFor({
      timeout,
    });
  }

  /**
   * Wait for loading to complete
   */
  async waitForLoadingComplete(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return this.page.title();
  }

  /**
   * Navigate using hash router
   */
  async navigateTo(route: string): Promise<void> {
    await this.page.goto(`/#${route}`);
  }

  /**
   * Wait for specific route
   */
  async waitForRoute(route: string): Promise<void> {
    await this.page.waitForURL(`**/#${route}`);
  }
}

/**
 * SSE helpers for testing Server-Sent Events
 */
export class SSEHelpers {
  constructor(private page: Page) {}

  /**
   * Intercept SSE connections
   */
  async interceptSSE(urlPattern: string): Promise<{ messages: string[] }> {
    const messages: string[] = [];

    await this.page.route(urlPattern, async (route) => {
      const request = route.request();
      if (request.headers()['accept']?.includes('text/event-stream')) {
        // For now, just track that SSE was requested
        messages.push('SSE connection initiated');
      }
      await route.continue();
    });

    return { messages };
  }

  /**
   * Mock SSE response
   */
  async mockSSE(urlPattern: string, events: Array<{ type: string; data: Record<string, unknown> }>): Promise<void> {
    await this.page.route(urlPattern, async (route) => {
      const body = events
        .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
        .join('');

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: {
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
        body,
      });
    });
  }
}

/**
 * API helpers for mocking backend responses
 */
export class APIHelpers {
  constructor(private page: Page) {}

  /**
   * Mock API response
   */
  async mockResponse(urlPattern: string, response: Record<string, unknown>, status = 200): Promise<void> {
    await this.page.route(urlPattern, async (route) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });
  }

  /**
   * Mock API error
   */
  async mockError(urlPattern: string, error: string, status = 500): Promise<void> {
    await this.page.route(urlPattern, async (route) => {
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error }),
      });
    });
  }

  /**
   * Mock auth session response
   */
  async mockAuthSession(user: TestUser | null): Promise<void> {
    await this.mockResponse('**/api/auth/session', {
      success: true,
      data: user
        ? {
            user: {
              id: 'test-user-id',
              email: user.email,
              displayName: user.displayName || 'Test User',
              isAdmin: false,
              createdAt: new Date().toISOString(),
            },
          }
        : { user: null },
    });
  }

  /**
   * Mock sessions list response
   */
  async mockSessionsList(sessions: Array<{ id: string; userRequest: string; status: string }>): Promise<void> {
    await this.mockResponse('**/api/sessions*', {
      success: true,
      data: { sessions },
    });
  }

  /**
   * Mock GitHub repos response
   */
  async mockGitHubRepos(repos: Array<{ owner: string; name: string }>): Promise<void> {
    await this.mockResponse('**/api/github/repos', {
      success: true,
      data: repos.map(repo => ({
        id: Math.random(),
        owner: { login: repo.owner },
        name: repo.name,
        full_name: `${repo.owner}/${repo.name}`,
        private: false,
        html_url: `https://github.com/${repo.owner}/${repo.name}`,
      })),
    });
  }

  /**
   * Intercept and record API calls
   */
  async interceptCalls(urlPattern: string): Promise<{ calls: Array<{ url: string; method: string; body?: unknown }> }> {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];

    await this.page.route(urlPattern, async (route) => {
      const request = route.request();
      let body: unknown = undefined;

      try {
        body = request.postDataJSON();
      } catch {
        // No body or not JSON
      }

      calls.push({
        url: request.url(),
        method: request.method(),
        body,
      });

      await route.continue();
    });

    return { calls };
  }
}

/**
 * Extended test fixture type
 */
interface TestFixtures {
  auth: AuthHelpers;
  pageHelpers: PageHelpers;
  sse: SSEHelpers;
  api: APIHelpers;
  testUser: TestUser;
}

/**
 * Extended test with custom fixtures
 */
export const test = base.extend<TestFixtures>({
  auth: async ({ page }, use) => {
    await use(new AuthHelpers(page));
  },

  pageHelpers: async ({ page }, use) => {
    await use(new PageHelpers(page));
  },

  sse: async ({ page }, use) => {
    await use(new SSEHelpers(page));
  },

  api: async ({ page }, use) => {
    await use(new APIHelpers(page));
  },

  testUser: async ({}, use) => {
    // Generate unique test user for each test
    const testUser: TestUser = {
      email: `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      password: 'TestPassword123!',
      displayName: 'E2E Test User',
    };
    await use(testUser);
  },
});

export { expect };
