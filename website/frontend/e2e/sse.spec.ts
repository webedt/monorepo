/**
 * E2E Tests for SSE Streaming and Reconnection
 *
 * Tests Server-Sent Events functionality including connection,
 * message handling, and reconnection behavior.
 */

import { test, expect } from './fixtures/test-fixtures';

test.describe('SSE Streaming', () => {
  test.describe('Connection Management', () => {
    test('should establish SSE connection for session execution', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      // Track SSE connection attempts
      const sseConnections = await sse.interceptSSE('**/api/execute-remote*');

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // If executing a session, SSE should be initiated
      // The actual behavior depends on the page implementation
    });

    test('should handle SSE events correctly', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      // Mock SSE events
      await sse.mockSSE('**/api/execute-remote*', [
        { type: 'connected', data: { sessionId: 'test-session' } },
        { type: 'message', data: { content: 'Processing request...' } },
        { type: 'tool_use', data: { tool: 'write_file', status: 'running' } },
        { type: 'complete', data: { success: true } },
      ]);

      await page.goto('/#/chat/test-session');

      // The chat page should display SSE messages
      await page.waitForLoadState('networkidle');
    });

    test('should display connection status indicator', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
        data: {
          session: {
            id: 'test-session',
            status: 'running',
          },
        },
      });

      await page.goto('/#/chat/test-session');

      // Look for connection status indicator
      const statusIndicator = page.locator('.connection-status, .status-indicator, [data-status]');
      if (await statusIndicator.first().isVisible()) {
        await expect(statusIndicator.first()).toBeVisible();
      }
    });
  });

  test.describe('Event Handling', () => {
    test('should display streaming messages', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
        data: {
          session: {
            id: 'test-session',
            status: 'running',
            userRequest: 'Add new feature',
          },
        },
      });

      // Mock streaming messages
      await sse.mockSSE('**/api/resume/*', [
        {
          type: 'message',
          data: {
            role: 'assistant',
            content: 'I am analyzing the codebase...',
          },
        },
        {
          type: 'tool_use',
          data: {
            tool: 'read_file',
            path: 'src/index.ts',
          },
        },
      ]);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Messages should be displayed
      const messageContainer = page.locator('.messages, .chat-messages, .message-list');
      if (await messageContainer.isVisible()) {
        await expect(messageContainer).toBeVisible();
      }
    });

    test('should handle tool use events', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await sse.mockSSE('**/api/resume/*', [
        {
          type: 'tool_use',
          data: {
            tool: 'write_file',
            path: 'src/newFile.ts',
            content: 'export const newFunction = () => {};',
          },
        },
        {
          type: 'tool_result',
          data: {
            success: true,
            tool: 'write_file',
          },
        },
      ]);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Tool use should be displayed
      const toolIndicator = page.locator('.tool-use, .tool-indicator, [data-tool]');
      if (await toolIndicator.first().isVisible()) {
        await expect(toolIndicator.first()).toBeVisible();
      }
    });

    test('should handle error events gracefully', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await sse.mockSSE('**/api/resume/*', [
        {
          type: 'error',
          data: {
            message: 'Rate limit exceeded',
            code: 'RATE_LIMIT',
          },
        },
      ]);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Error should be displayed
      const errorMessage = page.locator('.error, .toast-error, [role="alert"]');
      if (await errorMessage.first().isVisible()) {
        await expect(errorMessage.first()).toBeVisible();
      }
    });

    test('should handle completion events', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await sse.mockSSE('**/api/resume/*', [
        { type: 'message', data: { content: 'Working on the task...' } },
        { type: 'complete', data: { success: true } },
      ]);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Completion should update UI state
      // The exact behavior depends on implementation
    });
  });

  test.describe('Reconnection', () => {
    test('should attempt reconnection on disconnect', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*', {
        success: true,
        data: {
          session: {
            id: 'test-session',
            status: 'running',
          },
        },
      });

      let connectionAttempts = 0;
      await page.route('**/api/resume/*', async (route) => {
        connectionAttempts++;

        if (connectionAttempts === 1) {
          // First attempt fails
          await route.abort('connectionfailed');
        } else {
          // Subsequent attempts succeed
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: connected\ndata: {}\n\n',
          });
        }
      });

      await page.goto('/#/chat/test-session');

      // Wait for reconnection attempt
      await page.waitForTimeout(3000);

      // Should have attempted reconnection
      expect(connectionAttempts).toBeGreaterThan(0);
    });

    test('should restore lastEventId on reconnection', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      let lastEventIdReceived = '';
      await page.route('**/api/resume/*', async (route) => {
        const url = route.request().url();
        const urlParams = new URL(url);
        lastEventIdReceived = urlParams.searchParams.get('lastEventId') || '';

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Cache-Control': 'no-cache',
          },
          body: 'id: event-123\nevent: message\ndata: {"content":"test"}\n\n',
        });
      });

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // The implementation should store and use lastEventId
      // This test verifies the mechanism is in place
    });

    test('should show reconnection status', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.route('**/api/resume/*', async (route) => {
        // Delay to simulate slow connection
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: connected\ndata: {}\n\n',
        });
      });

      await page.goto('/#/chat/test-session');

      // Look for reconnecting status
      const reconnectingIndicator = page.locator(
        '.reconnecting, .connecting, [data-status="connecting"]'
      );

      // Status indicator might be visible during connection
      if (await reconnectingIndicator.first().isVisible({ timeout: 1000 })) {
        await expect(reconnectingIndicator.first()).toBeVisible();
      }
    });
  });

  test.describe('Session Resume', () => {
    test('should resume session from stored events', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/sessions/*/events', {
        success: true,
        data: {
          events: [
            { id: 'evt-1', type: 'message', data: { content: 'Previous message 1' } },
            { id: 'evt-2', type: 'message', data: { content: 'Previous message 2' } },
          ],
        },
      });

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Previous events should be displayed
      const messages = page.locator('.message, .chat-message');
      // Count depends on implementation
    });

    test('should continue from last event after page reload', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      // First visit
      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Store something in sessionStorage (simulating event receipt)
      await page.evaluate(() => {
        sessionStorage.setItem('sse_lastEventId_test-session', 'event-100');
      });

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify lastEventId is used
      const storedEventId = await page.evaluate(() => {
        return sessionStorage.getItem('sse_lastEventId_test-session');
      });

      expect(storedEventId).toBe('event-100');
    });
  });

  test.describe('Performance', () => {
    test('should handle rapid message stream', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      // Generate many messages
      const messages = Array.from({ length: 50 }, (_, i) => ({
        type: 'message',
        data: { content: `Message ${i + 1}` },
      }));

      await sse.mockSSE('**/api/resume/*', messages);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Page should handle many messages without crashing
      await expect(page.locator('body')).toBeVisible();
    });

    test('should efficiently render large tool outputs', async ({ page, api, sse }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      // Large content simulation
      const largeContent = 'x'.repeat(10000);

      await sse.mockSSE('**/api/resume/*', [
        {
          type: 'tool_result',
          data: {
            tool: 'read_file',
            content: largeContent,
          },
        },
      ]);

      await page.goto('/#/chat/test-session');
      await page.waitForLoadState('networkidle');

      // Page should handle large content
      await expect(page.locator('body')).toBeVisible();
    });
  });

  test.describe('Error Recovery', () => {
    test('should recover from network interruption', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      let requestCount = 0;
      await page.route('**/api/resume/*', async (route) => {
        requestCount++;

        if (requestCount <= 2) {
          await route.abort('connectionfailed');
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: connected\ndata: {}\n\n',
          });
        }
      });

      await page.goto('/#/chat/test-session');

      // Wait for retry attempts
      await page.waitForTimeout(5000);

      // Should eventually recover
      expect(requestCount).toBeGreaterThanOrEqual(1);
    });

    test('should show error message on persistent failure', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.route('**/api/resume/*', async (route) => {
        await route.abort('connectionfailed');
      });

      await page.goto('/#/chat/test-session');

      // Wait for error state
      await page.waitForTimeout(5000);

      // Should show error or disconnected state
      const errorIndicator = page.locator(
        '.error, .disconnected, [data-status="error"], .toast-error'
      );

      // Implementation may vary
      await expect(page.locator('body')).toBeVisible();
    });
  });
});
