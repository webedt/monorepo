/**
 * Tests for RegisterPage
 * Covers registration form rendering, validation (including password confirmation),
 * submission, and navigation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  simulateInput,
} from './testUtils';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthApi = vi.hoisted(() => ({
  getSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  authApi: mockAuthApi,
}));

vi.mock('../../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

// Import after mocking
import { RegisterPage } from '../../src/pages/register/RegisterPage';

describe('RegisterPage', () => {
  let container: HTMLElement;
  let navigations: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();
    navigations = [];

    // Mock window.location.hash for navigation
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '#/register',
        replace: vi.fn((url: string) => {
          navigations.push(url);
        }),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanupPageContainer();
  });

  describe('Rendering', () => {
    it('should render the register page structure', () => {
      const page = new RegisterPage();
      page.mount(container);

      expect(container.querySelector('.login-page')).not.toBeNull();
      expect(container.querySelector('.login-title')).not.toBeNull();
    });

    it('should display WebEDT title', () => {
      const page = new RegisterPage();
      page.mount(container);

      const title = container.querySelector('.login-title');
      expect(title?.textContent).toBe('WebEDT');
    });

    it('should display create account subtitle', () => {
      const page = new RegisterPage();
      page.mount(container);

      const subtitle = container.querySelector('.login-subtitle');
      expect(subtitle?.textContent).toBe('Create your account');
    });

    it('should have a link to login page', () => {
      const page = new RegisterPage();
      page.mount(container);

      const loginLink = container.querySelector('a[href="#/login"]');
      expect(loginLink).not.toBeNull();
      expect(loginLink?.textContent).toBe('Sign in');
    });
  });

  describe('Form Elements', () => {
    it('should render email input', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const emailInput = container.querySelector('input[type="email"]');
      expect(emailInput).not.toBeNull();
    });

    it('should render password input', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const passwordInputs = container.querySelectorAll('input[type="password"]');
      expect(passwordInputs.length).toBeGreaterThanOrEqual(2);
    });

    it('should render confirm password input', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const confirmLabel = container.querySelector('.confirm-password-input');
      expect(confirmLabel).not.toBeNull();
    });

    it('should render submit button with Create Account label', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const button = container.querySelector('button[type="submit"]');
      expect(button).not.toBeNull();
      expect(button?.textContent).toContain('Create Account');
    });
  });

  describe('Form Validation', () => {
    it('should show error when submitting with empty fields', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Please fill in all fields');
    });

    it('should show error when passwords do not match', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      // Fill form with mismatched passwords
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInputs = container.querySelectorAll('input[type="password"]');
      const passwordInput = passwordInputs[0] as HTMLInputElement;
      const confirmInput = passwordInputs[1] as HTMLInputElement;

      if (emailInput && passwordInput && confirmInput) {
        simulateInput(emailInput, 'test@example.com');
        simulateInput(passwordInput, 'password123');
        simulateInput(confirmInput, 'password456');
      }

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Passwords do not match');
    });

    it('should show error when password is too short', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      // Fill form with short password
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInputs = container.querySelectorAll('input[type="password"]');
      const passwordInput = passwordInputs[0] as HTMLInputElement;
      const confirmInput = passwordInputs[1] as HTMLInputElement;

      if (emailInput && passwordInput && confirmInput) {
        simulateInput(emailInput, 'test@example.com');
        simulateInput(passwordInput, 'short');
        simulateInput(confirmInput, 'short');
      }

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Password must be at least 8 characters');
    });
  });

  describe('Form Interaction', () => {
    it('should be able to type into email and password fields', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInputs = container.querySelectorAll('input[type="password"]');
      const passwordInput = passwordInputs[0] as HTMLInputElement;
      const confirmInput = passwordInputs[1] as HTMLInputElement;

      if (emailInput && passwordInput && confirmInput) {
        simulateInput(emailInput, 'newuser@example.com');
        simulateInput(passwordInput, 'password123');
        simulateInput(confirmInput, 'password123');
      }

      expect(emailInput?.value).toBe('newuser@example.com');
      expect(passwordInput?.value).toBe('password123');
      expect(confirmInput?.value).toBe('password123');
    });

    it('should have a submit button with Create Account label', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      const button = container.querySelector('button[type="submit"]');
      expect(button).not.toBeNull();
      expect(button?.textContent).toContain('Create Account');
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new RegisterPage();
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(container.querySelector('.login-page')).toBeNull();
    });
  });
});
