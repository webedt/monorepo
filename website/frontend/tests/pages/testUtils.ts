/**
 * Test Utilities for Page Component Testing
 * Provides mocks, fixtures, and helper functions for testing pages.
 */

import { vi } from 'vitest';

import type { User, Session } from '../../src/types';

// ============================================================================
// Test Fixtures
// ============================================================================

export const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  isAdmin: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

export const mockAdminUser: User = {
  ...mockUser,
  id: 'admin-123',
  email: 'admin@example.com',
  displayName: 'Admin User',
  isAdmin: true,
};

export const mockSession: Session = {
  id: 'session-123',
  userId: 'user-123',
  userRequest: 'Test session request',
  status: 'completed',
  repositoryOwner: 'test-owner',
  repositoryName: 'test-repo',
  branch: 'feature-branch',
  baseBranch: 'main',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

export const mockRunningSession: Session = {
  ...mockSession,
  id: 'session-running',
  status: 'running',
};

export const mockPendingSession: Session = {
  ...mockSession,
  id: 'session-pending',
  status: 'pending',
};

// ============================================================================
// Mock API Functions
// ============================================================================

export const createMockAuthApi = () => ({
  getSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  getCsrfToken: vi.fn(),
});

export const createMockSessionsApi = () => ({
  list: vi.fn(),
  get: vi.fn(),
  getMessages: vi.fn(),
  getEvents: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createCodeSession: vi.fn(),
  getStreamUrl: vi.fn(),
  checkStreamActive: vi.fn(),
  abort: vi.fn(),
  interrupt: vi.fn(),
  sendMessage: vi.fn(),
  search: vi.fn(),
  listDeleted: vi.fn(),
  deleteBulk: vi.fn(),
  restore: vi.fn(),
  restoreBulk: vi.fn(),
  deletePermanentBulk: vi.fn(),
  createMessage: vi.fn(),
  createEvent: vi.fn(),
  initializeRepository: vi.fn(),
  sync: vi.fn(),
  syncEvents: vi.fn(),
  toggleFavorite: vi.fn(),
});

export const createMockGithubApi = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  getRepos: vi.fn(),
  getBranches: vi.fn(),
  createBranch: vi.fn(),
  getTree: vi.fn(),
  getFileContent: vi.fn(),
  getPulls: vi.fn(),
  generatePRContent: vi.fn(),
  createPull: vi.fn(),
  mergePull: vi.fn(),
  deleteFile: vi.fn(),
  renameFile: vi.fn(),
  updateFile: vi.fn(),
  commit: vi.fn(),
});

export const createMockUserApi = () => ({
  updateClaudeAuth: vi.fn(),
  removeClaudeAuth: vi.fn(),
  updateCodexAuth: vi.fn(),
  removeCodexAuth: vi.fn(),
  updateGeminiAuth: vi.fn(),
  removeGeminiAuth: vi.fn(),
  updatePreferredProvider: vi.fn(),
  updateImageResizeSetting: vi.fn(),
  updateDisplayName: vi.fn(),
  updateVoiceCommandKeywords: vi.fn(),
  updateStopListeningAfterSubmit: vi.fn(),
  updateDefaultLandingPage: vi.fn(),
  updatePreferredModel: vi.fn(),
  updateChatVerbosity: vi.fn(),
  updateImageAiKeys: vi.fn(),
  updateImageAiProvider: vi.fn(),
  updateImageAiModel: vi.fn(),
  updateOpenRouterApiKey: vi.fn(),
  removeOpenRouterApiKey: vi.fn(),
  updateAutocompleteSettings: vi.fn(),
  getSpendingLimits: vi.fn(),
  updateSpendingLimits: vi.fn(),
  resetMonthlySpending: vi.fn(),
});

export const createMockBillingApi = () => ({
  getCurrentPlan: vi.fn(),
  getTiers: vi.fn(),
  changePlan: vi.fn(),
});

export const createMockLibraryApi = () => ({
  getRecentlyPlayed: vi.fn(),
  getLibrary: vi.fn(),
  getLibraryItem: vi.fn(),
  toggleFavorite: vi.fn(),
  hideGame: vi.fn(),
  updateInstallStatus: vi.fn(),
  addPlaytime: vi.fn(),
  getHiddenGames: vi.fn(),
  getStats: vi.fn(),
});

// ============================================================================
// Page Testing Helpers
// ============================================================================

/**
 * Create a container element for mounting pages
 */
export function createPageContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'test-page-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Clean up the page container after tests
 */
export function cleanupPageContainer(): void {
  const container = document.getElementById('test-page-container');
  if (container) {
    container.remove();
  }
}

/**
 * Wait for a component to render (microtask flush)
 */
export async function waitForRender(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Wait for async operations to complete
 */
export async function waitForAsync(ms = 10): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Simulate user typing in an input
 */
export function simulateInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Simulate form submission
 */
export function simulateSubmit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/**
 * Simulate button click
 */
export function simulateClick(element: HTMLElement): void {
  element.click();
}

/**
 * Get a toast message content (for verifying notifications)
 */
export function getToastMessages(): string[] {
  const toasts = document.querySelectorAll('.toast, .toast-message, [role="alert"]');
  return Array.from(toasts).map(t => t.textContent || '');
}

// ============================================================================
// Mock SSE/EventSource
// ============================================================================

export interface MockEventSourceMessage {
  type: string;
  data: Record<string, unknown>;
}

export class MockEventSource {
  private listeners: Map<string, Array<(event: MessageEvent) => void>> = new Map();
  public onopen: ((this: EventSource, ev: Event) => void) | null = null;
  public onerror: ((this: EventSource, ev: Event) => void) | null = null;
  public onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
  public readyState: number = EventSource.OPEN;
  public url: string;
  public withCredentials: boolean;

  constructor(url: string, eventSourceInitDict?: EventSourceInit) {
    this.url = url;
    this.withCredentials = eventSourceInitDict?.withCredentials ?? false;

    // Trigger onopen after construction
    setTimeout(() => {
      if (this.onopen) {
        this.onopen.call(this as unknown as EventSource, new Event('open'));
      }
    }, 0);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const typeListeners = this.listeners.get(type);
    if (typeListeners) {
      const index = typeListeners.indexOf(listener);
      if (index > -1) {
        typeListeners.splice(index, 1);
      }
    }
  }

  close(): void {
    this.readyState = EventSource.CLOSED;
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(message: MockEventSourceMessage): void {
    const event = new MessageEvent(message.type, {
      data: JSON.stringify(message.data),
    });

    // Call type-specific listeners
    const typeListeners = this.listeners.get(message.type);
    if (typeListeners) {
      for (const listener of typeListeners) {
        listener(event);
      }
    }

    // Call generic onmessage
    if (this.onmessage) {
      this.onmessage.call(this as unknown as EventSource, event);
    }
  }

  /**
   * Simulate an error
   */
  simulateError(): void {
    if (this.onerror) {
      this.onerror.call(this as unknown as EventSource, new Event('error'));
    }
  }
}

/**
 * Install MockEventSource globally
 */
export function installMockEventSource(): typeof MockEventSource {
  const original = global.EventSource;
  (global as { EventSource: typeof MockEventSource }).EventSource = MockEventSource as unknown as typeof EventSource;
  return original as unknown as typeof MockEventSource;
}

/**
 * Restore original EventSource
 */
export function restoreEventSource(original: typeof EventSource): void {
  (global as { EventSource: typeof EventSource }).EventSource = original;
}

// ============================================================================
// Navigation Mock Helpers
// ============================================================================

/**
 * Track navigation calls
 */
export function createNavigationTracker() {
  const navigations: Array<{ path: string; options?: { replace?: boolean } }> = [];

  const originalReplace = window.location.replace;
  const originalHash = Object.getOwnPropertyDescriptor(window.location, 'hash');

  Object.defineProperty(window.location, 'hash', {
    get: () => window.location.href.split('#')[1] || '',
    set: (value: string) => {
      navigations.push({ path: value.replace('#', '') });
    },
    configurable: true,
  });

  window.location.replace = vi.fn((url: string) => {
    navigations.push({ path: url.replace('#', ''), options: { replace: true } });
  }) as typeof window.location.replace;

  return {
    navigations,
    restore: () => {
      window.location.replace = originalReplace;
      if (originalHash) {
        Object.defineProperty(window.location, 'hash', originalHash);
      }
    },
  };
}
