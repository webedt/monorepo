/**
 * Authentication Setup for E2E Tests
 *
 * This file runs before other tests to establish authenticated sessions.
 * Storage state is saved and reused by authenticated test projects.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_DIR = path.join(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'user.json');

/**
 * Test user credentials for E2E testing.
 * In a real environment, these would come from environment variables.
 */
const TEST_USER = {
  email: process.env.E2E_TEST_EMAIL || `e2e-setup-${Date.now()}@example.com`,
  password: process.env.E2E_TEST_PASSWORD || 'TestPassword123!',
};

setup.describe.configure({ mode: 'serial' });

setup('create .auth directory', async () => {
  // Ensure the .auth directory exists
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
});

setup('authenticate test user', async ({ page }) => {
  // Skip if storage state already exists and is recent (within 1 hour)
  if (fs.existsSync(STORAGE_STATE_PATH)) {
    const stats = fs.statSync(STORAGE_STATE_PATH);
    const ageMs = Date.now() - stats.mtimeMs;
    const oneHourMs = 60 * 60 * 1000;

    if (ageMs < oneHourMs) {
      console.log('Using cached authentication state');
      return;
    }
  }

  // Navigate to the application
  await page.goto('/');

  // Wait for the application to load
  await page.waitForLoadState('networkidle');

  // Check if we're already authenticated
  const isLoginPage = page.url().includes('/login') || page.url().includes('/register');

  if (isLoginPage) {
    // Try to register a new user first, fallback to login if user exists
    try {
      await page.goto('/#/register');
      await page.waitForSelector('.login-page', { timeout: 5000 });

      // Fill registration form
      await page.fill('input[type="email"]', TEST_USER.email);
      await page.locator('input[type="password"]').first().fill(TEST_USER.password);
      await page.locator('input[type="password"]').last().fill(TEST_USER.password);

      // Submit form
      await page.click('button[type="submit"]');

      // Wait for redirect or error
      await Promise.race([
        page.waitForURL(/.*\/(agents|dashboard)/, { timeout: 10000 }),
        page.waitForSelector('.toast-error, [role="alert"]', { timeout: 10000 }),
      ]);

      // Check if registration succeeded or user already exists
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl.includes('/register')) {
        // Registration failed, try login instead
        await page.goto('/#/login');
        await page.waitForSelector('.login-page', { timeout: 5000 });

        await page.fill('input[type="email"]', TEST_USER.email);
        await page.fill('input[type="password"]', TEST_USER.password);
        await page.click('button[type="submit"]');

        await page.waitForURL(/.*\/(agents|dashboard)/, { timeout: 10000 });
      }
    } catch {
      // If registration flow fails, try login directly
      await page.goto('/#/login');
      await page.waitForSelector('.login-page', { timeout: 5000 });

      await page.fill('input[type="email"]', TEST_USER.email);
      await page.fill('input[type="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      await page.waitForURL(/.*\/(agents|dashboard)/, { timeout: 10000 });
    }
  }

  // Verify we're authenticated by checking for protected content
  await expect(page).not.toHaveURL(/.*\/login/);
  await expect(page).not.toHaveURL(/.*\/register/);

  // Save storage state
  await page.context().storageState({ path: STORAGE_STATE_PATH });

  console.log('Authentication state saved to:', STORAGE_STATE_PATH);
});
