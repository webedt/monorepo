/**
 * Tests for SoundPage
 * Covers sound editor page metadata and authentication requirements.
 *
 * Note: Full integration tests for SoundPage are complex due to AudioContext
 * and component mocking requirements. The rendering tests are covered by
 * visual testing and the core Page base class tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  createPageContainer,
  cleanupPageContainer,
} from './testUtils';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthStore = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../../src/stores/authStore', () => ({
  authStore: mockAuthStore,
}));

// Import after mocking
import { SoundPage } from '../../src/pages/sound/SoundPage';

describe('SoundPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();

    // Default mock implementations
    mockAuthStore.isAuthenticated.mockReturnValue(true);
    mockAuthStore.getUser.mockReturnValue(mockUser);
    mockAuthStore.getState.mockReturnValue({
      user: mockUser,
      isLoading: false,
      isInitialized: true,
      error: null,
    });
  });

  afterEach(() => {
    cleanupPageContainer();
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    it('should have requiresAuth set to true', () => {
      const page = new SoundPage({ params: { sessionId: 'session-123' } });
      mockAuthStore.isAuthenticated.mockReturnValue(false);
      expect(page.canAccess()).toBe(false);
    });

    it('should allow access when authenticated', () => {
      mockAuthStore.isAuthenticated.mockReturnValue(true);

      const page = new SoundPage({ params: { sessionId: 'session-123' } });
      expect(page.canAccess()).toBe(true);
    });
  });

  describe('Page Metadata', () => {
    it('should have correct route pattern', () => {
      const page = new SoundPage({ params: { sessionId: 'session-123' } });
      expect(page.route).toBe('/session/:sessionId/sound');
    });

    it('should have correct title', () => {
      const page = new SoundPage({ params: { sessionId: 'session-123' } });
      expect(page.title).toBe('Sound Editor');
    });
  });
});
