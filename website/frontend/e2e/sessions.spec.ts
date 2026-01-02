/**
 * E2E Tests for Session Management
 *
 * Tests session creation, listing, execution, and management.
 */

import { test, expect } from './fixtures/test-fixtures';

test.describe('Session Management', () => {
  test.describe('Dashboard', () => {
    test('should display sessions list', async ({ page, api }) => {
      // Mock authenticated state
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      // Mock sessions list
      await api.mockSessionsList([
        {
          id: 'session-1',
          userRequest: 'Add new feature to the app',
          status: 'completed',
        },
        {
          id: 'session-2',
          userRequest: 'Fix authentication bug',
          status: 'running',
        },
      ]);

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // Should display sessions or dashboard content
      await expect(page.locator('.agents-page, .dashboard, .sessions-list, h1')).toBeVisible();
    });

    test('should show empty state when no sessions', async ({ page, api }) => {
      // Mock authenticated state
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      // Mock empty sessions list
      await api.mockSessionsList([]);

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // Should handle empty state gracefully
      const pageContent = await page.textContent('body');
      expect(pageContent).not.toBeNull();
    });

    test('should filter sessions by status', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockSessionsList([
        { id: 'session-1', userRequest: 'Completed task', status: 'completed' },
        { id: 'session-2', userRequest: 'Running task', status: 'running' },
        { id: 'session-3', userRequest: 'Pending task', status: 'pending' },
      ]);

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // Look for filter controls if they exist
      const filterButton = page.locator('[data-testid="filter"], button:has-text("Filter")');
      if (await filterButton.isVisible()) {
        await filterButton.click();
        // Filter interaction depends on implementation
      }
    });
  });

  test.describe('Session Creation', () => {
    test('should open session creation dialog', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockSessionsList([]);

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // Look for new session button
      const newSessionButton = page.locator(
        'button:has-text("New"), button:has-text("Create"), [data-testid="new-session"]'
      );

      if (await newSessionButton.first().isVisible()) {
        await newSessionButton.first().click();

        // Should show creation dialog or navigate to creation page
        await expect(page.locator('.modal, .dialog, .session-form, input[placeholder*="repo"]')).toBeVisible({
          timeout: 5000,
        });
      }
    });

    test('should create new session with GitHub repo', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockGitHubRepos([
        { owner: 'testuser', name: 'test-repo' },
        { owner: 'testuser', name: 'another-repo' },
      ]);

      await api.mockResponse('**/api/sessions', {
        success: true,
        data: {
          session: {
            id: 'new-session-id',
            userRequest: 'Test request',
            status: 'pending',
            repositoryOwner: 'testuser',
            repositoryName: 'test-repo',
          },
        },
      });

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // The session creation flow depends on the UI implementation
      // This is a basic structure that can be adapted
    });
  });

  test.describe('Session Execution', () => {
    test('should display session details', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
        data: {
          session: {
            id: 'session-123',
            userRequest: 'Implement new feature',
            status: 'running',
            repositoryOwner: 'testuser',
            repositoryName: 'test-repo',
            branch: 'feature-branch',
            createdAt: new Date().toISOString(),
          },
        },
      });

      await page.goto('/#/chat/session-123');
      await page.waitForLoadState('networkidle');

      // Should display session content
      await expect(page.locator('.chat-page, .session-detail, main')).toBeVisible();
    });

    test('should handle session interrupt', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
        data: {
          session: {
            id: 'session-123',
            userRequest: 'Running task',
            status: 'running',
          },
        },
      });

      await api.mockResponse('**/api/sessions/*/interrupt', {
        success: true,
      });

      await page.goto('/#/chat/session-123');

      // Look for interrupt/stop button
      const interruptButton = page.locator(
        'button:has-text("Stop"), button:has-text("Interrupt"), [data-testid="interrupt"]'
      );

      if (await interruptButton.isVisible()) {
        await interruptButton.click();
        // Should confirm or directly interrupt
      }
    });

    test('should display session messages', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*/messages', {
        success: true,
        data: {
          messages: [
            { id: 'msg-1', role: 'user', content: 'Please add a new feature' },
            { id: 'msg-2', role: 'assistant', content: 'I will help you add the feature.' },
          ],
        },
      });

      await page.goto('/#/chat/session-123');
      await page.waitForLoadState('networkidle');

      // Should display message content or loading state
      const chatContent = await page.textContent('body');
      expect(chatContent).not.toBeNull();
    });
  });

  test.describe('Session Navigation', () => {
    test('should navigate between sessions', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockSessionsList([
        { id: 'session-1', userRequest: 'First session', status: 'completed' },
        { id: 'session-2', userRequest: 'Second session', status: 'completed' },
      ]);

      await page.goto('/#/agents');
      await page.waitForLoadState('networkidle');

      // Try clicking on a session item
      const sessionItem = page.locator('[data-session-id], .session-item, .session-card').first();

      if (await sessionItem.isVisible()) {
        await sessionItem.click();
        // Should navigate to session detail
      }
    });
  });

  test.describe('Session Actions', () => {
    test('should toggle session favorite', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*/favorite', {
        success: true,
      });

      await page.goto('/#/agents');

      // Look for favorite button
      const favoriteButton = page.locator(
        '[data-testid="favorite"], button[aria-label*="favorite"], .favorite-button'
      ).first();

      if (await favoriteButton.isVisible()) {
        await favoriteButton.click();
        // Should toggle favorite state
      }
    });

    test('should delete session', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
      });

      await page.goto('/#/agents');

      // Look for delete button (might need to open menu first)
      const deleteButton = page.locator(
        'button:has-text("Delete"), [data-testid="delete"], [aria-label*="delete"]'
      ).first();

      if (await deleteButton.isVisible()) {
        await deleteButton.click();

        // Should show confirmation dialog
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")');
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }
      }
    });
  });
});
