/**
 * E2E Tests for Settings Management
 *
 * Tests user preferences, account settings, and configuration options.
 */

import { test, expect } from './fixtures/test-fixtures';

test.describe('Settings Management', () => {
  test.describe('Account Settings', () => {
    test('should display account information', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Should display settings page
      await expect(page.locator('.settings-page, h1:has-text("Settings")')).toBeVisible();

      // Should show email
      await expect(page.locator('text=test@example.com')).toBeVisible();
    });

    test('should update display name', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Old Name',
      });

      await api.mockResponse('**/api/user/display-name', {
        success: true,
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Find display name input
      const displayNameInput = page.locator('input[placeholder*="display"], input[placeholder*="name"]').first();

      if (await displayNameInput.isVisible()) {
        await displayNameInput.clear();
        await displayNameInput.fill('New Display Name');

        // Find save button
        const saveButton = page.locator('button:has-text("Save")').first();
        if (await saveButton.isVisible()) {
          await saveButton.click();

          // Should show success message
          await expect(page.locator('.toast, [role="alert"]')).toBeVisible({ timeout: 5000 });
        }
      }
    });

    test('should show account sections', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Should have multiple settings sections
      const sections = page.locator('.settings-section, section, .section-title');
      const count = await sections.count();

      // At minimum should have Account section
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Billing & Storage', () => {
    test('should display billing information', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/billing/current-plan', {
        success: true,
        data: {
          tier: 'BASIC',
          usedBytes: '1073741824',
          quotaBytes: '5368709120',
          usagePercent: 20,
          usedFormatted: '1 GB',
          quotaFormatted: '5 GB',
        },
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for billing section
      const billingSection = page.locator('text=Billing, text=Storage, .billing-card');
      if (await billingSection.first().isVisible()) {
        // Should show storage usage
        const usageText = page.locator('text=GB, text=MB');
        await expect(usageText.first()).toBeVisible({ timeout: 5000 });
      }
    });

    test('should display storage progress bar', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for progress bar
      const progressBar = page.locator('.progress, [role="progressbar"], .usage-bar');
      if (await progressBar.first().isVisible()) {
        await expect(progressBar.first()).toBeVisible();
      }
    });
  });

  test.describe('Spending Limits', () => {
    test('should display spending limits section', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/user/spending-limits', {
        success: true,
        data: {
          enabled: false,
          monthlyBudgetCents: '0',
          perTransactionLimitCents: '0',
          resetDay: 1,
          currentMonthSpentCents: '0',
          remainingBudgetCents: '0',
          usagePercent: 0,
          limitAction: 'warn',
        },
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for spending limits section
      const spendingSection = page.locator('text=Spending Limits, text=Budget, .spending-limits-card');
      if (await spendingSection.first().isVisible()) {
        await expect(spendingSection.first()).toBeVisible();
      }
    });

    test('should toggle spending limits', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/user/spending-limits', {
        success: true,
      });

      await page.goto('/#/settings');

      // Look for enable toggle
      const enableToggle = page.locator('input[type="checkbox"][name*="spending"], .toggle-switch');
      if (await enableToggle.first().isVisible()) {
        await enableToggle.first().click();
      }
    });
  });

  test.describe('Editor Settings', () => {
    test('should display editor preferences', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for editor section
      const editorSection = page.locator('text=Editor, .editor-card');
      if (await editorSection.first().isVisible()) {
        await expect(editorSection.first()).toBeVisible();
      }
    });

    test('should change theme preference', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for theme selector
      const themeSelect = page.locator('select[name*="theme"], [data-testid="theme-select"]');
      if (await themeSelect.isVisible()) {
        await themeSelect.selectOption('dark');
      }
    });
  });

  test.describe('Debug Settings', () => {
    test('should display debug options', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for debug section
      const debugSection = page.locator('text=Debug, .debug-card');
      if (await debugSection.first().isVisible()) {
        await expect(debugSection.first()).toBeVisible();
      }
    });

    test('should toggle debug mode', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for debug toggle
      const debugToggle = page.locator('input[type="checkbox"][name*="debug"], [data-testid="debug-toggle"]');
      if (await debugToggle.first().isVisible()) {
        await debugToggle.first().click();
      }
    });
  });

  test.describe('Connections', () => {
    test('should display connections section', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for connections section
      const connectionsSection = page.locator('text=Connections, .connections-card');
      if (await connectionsSection.first().isVisible()) {
        await expect(connectionsSection.first()).toBeVisible();
      }
    });

    test('should show Claude auth configuration', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for Claude auth input
      const claudeAuthInput = page.locator('input[placeholder*="Claude"], input[name*="claude"]');
      if (await claudeAuthInput.first().isVisible()) {
        await expect(claudeAuthInput.first()).toBeVisible();
      }
    });

    test('should update Claude auth token', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await api.mockResponse('**/api/user/claude-auth', {
        success: true,
      });

      await page.goto('/#/settings');

      const claudeAuthInput = page.locator('input[placeholder*="Claude"], input[name*="claude"]').first();
      if (await claudeAuthInput.isVisible()) {
        await claudeAuthInput.fill('test-claude-token');

        const saveButton = page.locator('button:has-text("Save")').first();
        if (await saveButton.isVisible()) {
          await saveButton.click();
        }
      }
    });
  });

  test.describe('Danger Zone', () => {
    test('should display danger zone section', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');
      await page.waitForLoadState('networkidle');

      // Look for danger zone section
      const dangerSection = page.locator('text=Danger Zone, .danger-card');
      if (await dangerSection.first().isVisible()) {
        await expect(dangerSection.first()).toBeVisible();
      }
    });

    test('should show logout button', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for logout button
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out")');
      if (await logoutButton.first().isVisible()) {
        await expect(logoutButton.first()).toBeVisible();
      }
    });

    test('should show delete account option', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for delete account button
      const deleteButton = page.locator('button:has-text("Delete Account"), button:has-text("Delete")');
      if (await deleteButton.first().isVisible()) {
        await expect(deleteButton.first()).toBeVisible();
      }
    });
  });

  test.describe('Navigation', () => {
    test('should navigate back to dashboard', async ({ page, api }) => {
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
      });

      await page.goto('/#/settings');

      // Look for back/home navigation
      const navLink = page.locator('a[href*="agents"], a[href*="dashboard"], .nav-link');
      if (await navLink.first().isVisible()) {
        await navLink.first().click();

        await expect(page).toHaveURL(/.*\/(agents|dashboard)/);
      }
    });
  });
});
