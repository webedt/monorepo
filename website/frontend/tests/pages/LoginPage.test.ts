/**
 * Tests for LoginPage
 * Covers login form rendering, validation, submission, and navigation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  simulateInput,
  simulateClick,
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
import { LoginPage } from '../../src/pages/login/LoginPage';
import { AuthStore } from '../../src/stores/authStore';

describe('LoginPage', () => {
  let container: HTMLElement;
  let authStore: AuthStore;
  let navigations: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();
    navigations = [];

    // Create a fresh auth store for each test
    authStore = new AuthStore();

    // Mock window.location.hash for navigation
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '#/login',
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
    it('should render the login page structure', () => {
      const page = new LoginPage();
      page.mount(container);

      expect(container.querySelector('.login-page')).not.toBeNull();
      expect(container.querySelector('.login-title')).not.toBeNull();
      expect(container.querySelector('.login-subtitle')).not.toBeNull();
    });

    it('should display WebEDT title', () => {
      const page = new LoginPage();
      page.mount(container);

      const title = container.querySelector('.login-title');
      expect(title?.textContent).toBe('WebEDT');
    });

    it('should display login subtitle', () => {
      const page = new LoginPage();
      page.mount(container);

      const subtitle = container.querySelector('.login-subtitle');
      expect(subtitle?.textContent).toBe('AI-Powered Code Editor');
    });

    it('should have a link to register page', () => {
      const page = new LoginPage();
      page.mount(container);

      const registerLink = container.querySelector('a[href="#/register"]');
      expect(registerLink).not.toBeNull();
      expect(registerLink?.textContent).toBe('Register');
    });
  });

  describe('Form Elements', () => {
    it('should render email input', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const emailInput = container.querySelector('input[type="email"]');
      expect(emailInput).not.toBeNull();
    });

    it('should render password input', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const passwordInput = container.querySelector('input[type="password"]');
      expect(passwordInput).not.toBeNull();
    });

    it('should render remember me checkbox', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const checkbox = container.querySelector('#remember');
      expect(checkbox).not.toBeNull();
    });

    it('should render submit button', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const button = container.querySelector('button[type="submit"]');
      expect(button).not.toBeNull();
      expect(button?.textContent).toContain('Sign In');
    });
  });

  describe('Form Validation', () => {
    it('should show error when submitting with empty fields', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Please fill in all fields');
    });

    it('should show error when email is empty', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      // Fill only password
      const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;
      if (passwordInput) {
        simulateInput(passwordInput, 'password123');
      }

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Please fill in all fields');
    });

    it('should show error when password is empty', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      // Fill only email
      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      if (emailInput) {
        simulateInput(emailInput, 'test@example.com');
      }

      const form = container.querySelector('form');
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      await waitForRender();

      expect(mockToast.error).toHaveBeenCalledWith('Please fill in all fields');
    });
  });

  describe('Form Interaction', () => {
    it('should be able to type into email and password fields', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const emailInput = container.querySelector('input[type="email"]') as HTMLInputElement;
      const passwordInput = container.querySelector('input[type="password"]') as HTMLInputElement;

      if (emailInput && passwordInput) {
        simulateInput(emailInput, 'test@example.com');
        simulateInput(passwordInput, 'password123');
      }

      expect(emailInput?.value).toBe('test@example.com');
      expect(passwordInput?.value).toBe('password123');
    });

    it('should have a submit button', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      const button = container.querySelector('button[type="submit"]');
      expect(button).not.toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      // Should not throw
      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new LoginPage();
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(container.querySelector('.login-page')).toBeNull();
    });
  });
});
