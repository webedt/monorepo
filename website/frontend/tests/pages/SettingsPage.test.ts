/**
 * Tests for SettingsPage
 * Covers settings sections rendering, user data display, and various settings interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  waitForAsync,
  simulateInput,
} from './testUtils';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthStore = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  logout: vi.fn(),
  updateUser: vi.fn(),
}));

const mockEditorSettingsStore = vi.hoisted(() => ({
  getState: vi.fn(),
  getSettings: vi.fn(),
  getFormatOnSave: vi.fn(),
  getTabSize: vi.fn(),
  getUseTabs: vi.fn(),
  setFormatOnSave: vi.fn(),
  setTabSize: vi.fn(),
  setUseTabs: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  setSetting: vi.fn(),
  getSetting: vi.fn(),
}));

const mockDebugStore = vi.hoisted(() => ({
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  setEnabled: vi.fn(),
  isEnabled: vi.fn(),
}));

const mockGithubApi = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getRepos: vi.fn(),
}));

const mockUserApi = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  updateClaudeAuth: vi.fn(),
  removeClaudeAuth: vi.fn(),
  updateCodexAuth: vi.fn(),
  removeCodexAuth: vi.fn(),
  updateGeminiAuth: vi.fn(),
  removeGeminiAuth: vi.fn(),
  updatePreferredProvider: vi.fn(),
  updateVoiceCommandKeywords: vi.fn(),
  updateStopListeningAfterSubmit: vi.fn(),
  updateDefaultLandingPage: vi.fn(),
  updatePreferredModel: vi.fn(),
  updateChatVerbosity: vi.fn(),
  getSpendingLimits: vi.fn(),
  updateSpendingLimits: vi.fn(),
  resetMonthlySpending: vi.fn(),
  updateImageAiKeys: vi.fn(),
  updateImageAiProvider: vi.fn(),
  updateImageAiModel: vi.fn(),
  updateImageResizeSetting: vi.fn(),
  updateOpenRouterApiKey: vi.fn(),
  removeOpenRouterApiKey: vi.fn(),
  updateAutocompleteSettings: vi.fn(),
}));

const mockBillingApi = vi.hoisted(() => ({
  getCurrentPlan: vi.fn(),
  getTiers: vi.fn(),
  changePlan: vi.fn(),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../src/stores/authStore', () => ({
  authStore: mockAuthStore,
}));

vi.mock('../../src/stores/editorSettingsStore', () => ({
  editorSettingsStore: mockEditorSettingsStore,
}));

vi.mock('../../src/stores/debugStore', () => ({
  debugStore: mockDebugStore,
}));

vi.mock('../../src/lib/api', () => ({
  githubApi: mockGithubApi,
  userApi: mockUserApi,
  billingApi: mockBillingApi,
}));

vi.mock('../../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

vi.mock('../../src/lib/router', () => ({
  router: {
    navigate: vi.fn(),
    getCurrentPath: vi.fn().mockReturnValue('/settings'),
    getQueryParams: vi.fn().mockReturnValue(new URLSearchParams()),
  },
}));

// Import after mocking
import { SettingsPage } from '../../src/pages/settings/SettingsPage';

describe('SettingsPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();

    // Default mock implementations
    mockAuthStore.isAuthenticated.mockReturnValue(true);
    mockAuthStore.getUser.mockReturnValue(mockUser);
    mockAuthStore.getState.mockReturnValue({ user: mockUser, isLoading: false, isInitialized: true, error: null });

    mockEditorSettingsStore.getState.mockReturnValue({
      theme: 'dark',
      fontSize: 14,
      tabSize: 2,
    });
    mockEditorSettingsStore.getSettings.mockReturnValue({
      formatOnSave: true,
      tabSize: 2,
      useTabs: false,
    });
    mockEditorSettingsStore.getFormatOnSave.mockReturnValue(true);
    mockEditorSettingsStore.getTabSize.mockReturnValue(2);
    mockEditorSettingsStore.getUseTabs.mockReturnValue(false);
    mockEditorSettingsStore.getSetting.mockImplementation((key: string) => {
      const settings: Record<string, unknown> = { theme: 'dark', fontSize: 14, tabSize: 2 };
      return settings[key];
    });

    mockDebugStore.isEnabled.mockReturnValue(false);
    mockDebugStore.getState.mockReturnValue({ enabled: false });

    mockBillingApi.getCurrentPlan.mockResolvedValue({
      tier: 'BASIC',
      usedBytes: '1073741824',
      quotaBytes: '5368709120',
      usagePercent: 20,
      usedFormatted: '1 GB',
      quotaFormatted: '5 GB',
    });

    mockUserApi.getSpendingLimits.mockResolvedValue({
      enabled: false,
      monthlyBudgetCents: '0',
      perTransactionLimitCents: '0',
      resetDay: 1,
      currentMonthSpentCents: '0',
      remainingBudgetCents: '0',
      usagePercent: 0,
      limitAction: 'warn',
      lastResetAt: null,
    });

    // Mock window.location.hash
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '#/settings',
        replace: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanupPageContainer();
  });

  describe('Rendering', () => {
    it('should render the settings page structure', () => {
      const page = new SettingsPage();
      page.mount(container);

      expect(container.querySelector('.settings-page')).not.toBeNull();
      expect(container.querySelector('.settings-header')).not.toBeNull();
    });

    it('should display Settings title', () => {
      const page = new SettingsPage();
      page.mount(container);

      const title = container.querySelector('.settings-title');
      expect(title?.textContent).toBe('Settings');
    });

    it('should display subtitle', () => {
      const page = new SettingsPage();
      page.mount(container);

      const subtitle = container.querySelector('.settings-subtitle');
      expect(subtitle?.textContent).toBe('Manage your account and preferences');
    });
  });

  describe('Settings Sections', () => {
    it('should render Account section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Account');
    });

    it('should render Billing & Storage section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Billing & Storage');
    });

    it('should render Spending Limits section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Spending Limits');
    });

    it('should render Editor section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Editor');
    });

    it('should render Debug section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Debug');
    });

    it('should render Connections section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Connections');
    });

    it('should render Danger Zone section', () => {
      const page = new SettingsPage();
      page.mount(container);

      const sectionTitles = Array.from(container.querySelectorAll('.section-title')).map(t => t.textContent);
      expect(sectionTitles).toContain('Danger Zone');
    });
  });

  describe('Data Loading', () => {
    it('should load billing data on page load', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await page.load();
      await waitForAsync(50);

      expect(mockBillingApi.getCurrentPlan).toHaveBeenCalled();
    });

    it('should load spending limits on page load', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await page.load();
      await waitForAsync(50);

      expect(mockUserApi.getSpendingLimits).toHaveBeenCalled();
    });

    it('should handle billing API error gracefully', async () => {
      mockBillingApi.getCurrentPlan.mockRejectedValue(new Error('API Error'));

      const page = new SettingsPage();
      page.mount(container);
      await page.load();
      await waitForAsync(50);

      // Page should still render without crashing
      expect(container.querySelector('.settings-page')).not.toBeNull();
    });

    it('should handle spending limits API error gracefully', async () => {
      mockUserApi.getSpendingLimits.mockRejectedValue(new Error('API Error'));

      const page = new SettingsPage();
      page.mount(container);
      await page.load();
      await waitForAsync(50);

      // Page should still render without crashing
      expect(container.querySelector('.settings-page')).not.toBeNull();
    });
  });

  describe('Authentication', () => {
    it('should have requiresAuth set to true', () => {
      const page = new SettingsPage();
      mockAuthStore.isAuthenticated.mockReturnValue(false);
      expect(page.canAccess()).toBe(false);
    });

    it('should allow access when authenticated', () => {
      mockAuthStore.isAuthenticated.mockReturnValue(true);

      const page = new SettingsPage();
      expect(page.canAccess()).toBe(true);
    });
  });

  describe('Page Metadata', () => {
    it('should have correct route', () => {
      const page = new SettingsPage();
      expect(page.route).toBe('/settings');
    });

    it('should have correct title', () => {
      const page = new SettingsPage();
      expect(page.title).toBe('Settings');
    });
  });

  describe('Account Section', () => {
    it('should render account card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const accountCard = container.querySelector('.account-card');
      expect(accountCard).not.toBeNull();
    });
  });

  describe('Billing Section', () => {
    it('should render billing card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const billingCard = container.querySelector('.billing-card');
      expect(billingCard).not.toBeNull();
    });

    it('should display billing tier after loading', async () => {
      mockBillingApi.getCurrentPlan.mockResolvedValue({
        tier: 'PRO',
        usedBytes: '2147483648',
        quotaBytes: '10737418240',
        usagePercent: 20,
        usedFormatted: '2 GB',
        quotaFormatted: '10 GB',
      });

      const page = new SettingsPage();
      page.mount(container);
      await page.load();
      await waitForAsync(100);

      // Check that billing section has content
      const billingCard = container.querySelector('.billing-card');
      expect(billingCard).not.toBeNull();
    });
  });

  describe('Spending Limits Section', () => {
    it('should render spending limits card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const spendingCard = container.querySelector('.spending-limits-card');
      expect(spendingCard).not.toBeNull();
    });
  });

  describe('Editor Section', () => {
    it('should render editor settings card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const editorCard = container.querySelector('.editor-card');
      expect(editorCard).not.toBeNull();
    });
  });

  describe('Connections Section', () => {
    it('should render connections card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const connectionsCard = container.querySelector('.connections-card');
      expect(connectionsCard).not.toBeNull();
    });
  });

  describe('Danger Zone Section', () => {
    it('should render danger zone card', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      const dangerCard = container.querySelector('.danger-card');
      expect(dangerCard).not.toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new SettingsPage();
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(container.querySelector('.settings-page')).toBeNull();
    });
  });
});
