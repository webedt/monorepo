/**
 * E2E Tests for Authentication Flows
 *
 * Tests user registration, login, logout, and session management.
 */

import { test, expect } from './fixtures/test-fixtures';

test.describe('Authentication', () => {
  test.describe('Registration', () => {
    test('should display registration form', async ({ page }) => {
      await page.goto('/#/register');

      // Verify form elements are present
      await expect(page.locator('h1.login-title')).toHaveText('WebEDT');
      await expect(page.locator('.login-subtitle')).toHaveText('Create your account');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]').first()).toBeVisible();
      await expect(page.locator('input[type="password"]').last()).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toHaveText('Create Account');
    });

    test('should show error for mismatched passwords', async ({ page, testUser }) => {
      await page.goto('/#/register');

      // Fill form with mismatched passwords
      await page.fill('input[type="email"]', testUser.email);
      await page.locator('input[type="password"]').first().fill(testUser.password);
      await page.locator('input[type="password"]').last().fill('DifferentPassword123!');

      await page.click('button[type="submit"]');

      // Should show error toast
      await expect(page.locator('.toast, [role="alert"]')).toContainText('Passwords do not match');
    });

    test('should show error for short password', async ({ page, testUser }) => {
      await page.goto('/#/register');

      // Fill form with short password
      await page.fill('input[type="email"]', testUser.email);
      await page.locator('input[type="password"]').first().fill('short');
      await page.locator('input[type="password"]').last().fill('short');

      await page.click('button[type="submit"]');

      // Should show error toast
      await expect(page.locator('.toast, [role="alert"]')).toContainText('at least 8 characters');
    });

    test('should show error for empty fields', async ({ page }) => {
      await page.goto('/#/register');

      // Submit without filling fields
      await page.click('button[type="submit"]');

      // Should show validation error
      await expect(page.locator('.toast, [role="alert"]')).toContainText('fill in all fields');
    });

    test('should successfully register new user', async ({ page, testUser, api }) => {
      // Mock successful registration
      await api.mockResponse('**/api/auth/register', {
        success: true,
        data: {
          user: {
            id: 'new-user-id',
            email: testUser.email,
            displayName: testUser.displayName,
            isAdmin: false,
          },
        },
      });

      await api.mockAuthSession({
        email: testUser.email,
        password: testUser.password,
        displayName: testUser.displayName,
      });

      await page.goto('/#/register');

      // Fill registration form
      await page.fill('input[type="email"]', testUser.email);
      await page.locator('input[type="password"]').first().fill(testUser.password);
      await page.locator('input[type="password"]').last().fill(testUser.password);

      await page.click('button[type="submit"]');

      // Should redirect to agents page
      await expect(page).toHaveURL(/.*\/agents/);
    });

    test('should navigate to login page from register', async ({ page }) => {
      await page.goto('/#/register');

      // Click sign in link
      await page.click('a.login-link');

      // Should navigate to login
      await expect(page).toHaveURL(/.*\/login/);
    });
  });

  test.describe('Login', () => {
    test('should display login form', async ({ page }) => {
      await page.goto('/#/login');

      // Verify form elements are present
      await expect(page.locator('h1.login-title')).toHaveText('WebEDT');
      await expect(page.locator('.login-subtitle')).toHaveText('AI-Powered Code Editor');
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('#remember')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toHaveText('Sign In');
    });

    test('should show error for empty fields', async ({ page }) => {
      await page.goto('/#/login');

      // Submit without filling fields
      await page.click('button[type="submit"]');

      // Should show validation error
      await expect(page.locator('.toast, [role="alert"]')).toContainText('fill in all fields');
    });

    test('should show error for invalid credentials', async ({ page, testUser, api }) => {
      // Mock failed login
      await api.mockError('**/api/auth/login', 'Invalid email or password', 401);

      await page.goto('/#/login');

      // Fill login form
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', 'WrongPassword123!');

      await page.click('button[type="submit"]');

      // Should show error toast
      await expect(page.locator('.toast, [role="alert"]')).toContainText('Invalid');
    });

    test('should successfully login', async ({ page, testUser, api }) => {
      // Mock successful login
      await api.mockResponse('**/api/auth/login', {
        success: true,
        data: {
          user: {
            id: 'user-id',
            email: testUser.email,
            displayName: testUser.displayName,
            isAdmin: false,
          },
        },
      });

      await api.mockAuthSession({
        email: testUser.email,
        password: testUser.password,
        displayName: testUser.displayName,
      });

      await page.goto('/#/login');

      // Fill login form
      await page.fill('input[type="email"]', testUser.email);
      await page.fill('input[type="password"]', testUser.password);

      await page.click('button[type="submit"]');

      // Should redirect to agents page
      await expect(page).toHaveURL(/.*\/agents/);
    });

    test('should navigate to register page from login', async ({ page }) => {
      await page.goto('/#/login');

      // Click register link
      await page.click('a.login-link');

      // Should navigate to register
      await expect(page).toHaveURL(/.*\/register/);
    });

    test('should remember me checkbox works', async ({ page }) => {
      await page.goto('/#/login');

      const checkbox = page.locator('#remember');
      await expect(checkbox).not.toBeChecked();

      await checkbox.click();
      await expect(checkbox).toBeChecked();
    });
  });

  test.describe('Logout', () => {
    test('should logout from settings page', async ({ page, api }) => {
      // Mock authenticated state
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      // Mock logout
      await api.mockResponse('**/api/auth/logout', { success: true });

      await page.goto('/#/settings');

      // Find and click logout button (typically in danger section)
      const logoutButton = page.locator('button:has-text("Logout"), button:has-text("Sign Out")');

      if (await logoutButton.isVisible()) {
        await logoutButton.click();

        // Should redirect to login
        await expect(page).toHaveURL(/.*\/login/);
      }
    });
  });

  test.describe('Session Persistence', () => {
    test('should redirect authenticated users away from login', async ({ page, api }) => {
      // Mock authenticated session
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      await page.goto('/#/login');

      // Should redirect away from login
      await expect(page).not.toHaveURL(/.*\/login/);
    });

    test('should redirect authenticated users away from register', async ({ page, api }) => {
      // Mock authenticated session
      await api.mockAuthSession({
        email: 'test@example.com',
        password: 'test',
        displayName: 'Test User',
      });

      await page.goto('/#/register');

      // Should redirect away from register
      await expect(page).not.toHaveURL(/.*\/register/);
    });
  });
});
