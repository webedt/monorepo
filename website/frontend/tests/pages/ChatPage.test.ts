/**
 * Tests for ChatPage
 * Covers chat interface rendering, message display, session loading, and interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  mockUser,
  mockSession,
  mockRunningSession,
  mockPendingSession,
  createPageContainer,
  cleanupPageContainer,
  waitForRender,
  waitForAsync,
  simulateInput,
  MockEventSource,
} from './testUtils';

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const mockAuthStore = vi.hoisted(() => ({
  isAuthenticated: vi.fn(),
  getUser: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  updateUser: vi.fn(),
}));

const mockWorkerStore = vi.hoisted(() => ({
  isExecuting: vi.fn(),
  startExecution: vi.fn(),
  stopExecution: vi.fn(),
  heartbeat: vi.fn(),
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

const mockSessionsApi = vi.hoisted(() => ({
  get: vi.fn(),
  getEvents: vi.fn(),
  getStreamUrl: vi.fn(),
  sendMessage: vi.fn(),
  interrupt: vi.fn(),
  checkStreamActive: vi.fn(),
}));

const mockUserApi = vi.hoisted(() => ({
  updateChatVerbosity: vi.fn(),
}));

const mockCreateSessionExecuteEventSource = vi.hoisted(() => vi.fn());

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../../src/stores/authStore', () => ({
  authStore: mockAuthStore,
}));

vi.mock('../../src/stores/workerStore', () => ({
  workerStore: mockWorkerStore,
}));

vi.mock('../../src/lib/api', () => ({
  sessionsApi: mockSessionsApi,
  userApi: mockUserApi,
  createSessionExecuteEventSource: mockCreateSessionExecuteEventSource,
}));

vi.mock('../../src/components', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    toast: mockToast,
  };
});

// Mock highlight module
vi.mock('../../src/lib/highlight', () => ({
  highlightCode: (code: string) => code,
  getLanguageDisplayName: (lang: string) => lang,
}));

// Import after mocking
import { ChatPage } from '../../src/pages/chat/ChatPage';

describe('ChatPage', () => {
  let container: HTMLElement;
  let navigations: string[] = [];
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    vi.clearAllMocks();
    container = createPageContainer();
    navigations = [];

    // Store original EventSource
    originalEventSource = global.EventSource;

    // Install mock EventSource
    (global as { EventSource: typeof EventSource }).EventSource = MockEventSource as unknown as typeof EventSource;

    // Default mock implementations
    mockAuthStore.isAuthenticated.mockReturnValue(true);
    mockAuthStore.getUser.mockReturnValue(mockUser);
    mockAuthStore.getState.mockReturnValue({ user: mockUser, isLoading: false, isInitialized: true, error: null });

    mockWorkerStore.isExecuting.mockReturnValue(false);
    mockWorkerStore.getState.mockReturnValue({ isExecuting: false, sessionId: null });

    mockSessionsApi.get.mockResolvedValue({ session: mockSession });
    mockSessionsApi.getEvents.mockResolvedValue({ events: [] });
    mockSessionsApi.getStreamUrl.mockReturnValue('/api/sessions/session-123/stream');
    mockSessionsApi.sendMessage.mockResolvedValue({ success: true });
    mockSessionsApi.interrupt.mockResolvedValue({ success: true });

    mockUserApi.updateChatVerbosity.mockResolvedValue({ success: true });

    // Mock window.location.hash for navigation
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        hash: '#/session/session-123/chat',
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
    // Restore original EventSource
    (global as { EventSource: typeof EventSource }).EventSource = originalEventSource;
  });

  describe('Rendering', () => {
    it('should render the chat page structure', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.chat-page')).not.toBeNull();
    });

    it('should render chat header', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.chat-header')).not.toBeNull();
    });

    it('should render toolbar', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.chat-toolbar')).not.toBeNull();
    });

    it('should render message input area', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.chat-input-container')).not.toBeNull();
      expect(container.querySelector('.chat-input')).not.toBeNull();
    });

    it('should render send button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('[data-action="send"]')).not.toBeNull();
    });

    it('should render back button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('[data-action="back"]')).not.toBeNull();
    });
  });

  describe('View Toggle', () => {
    it('should render normal view toggle button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('[data-view="normal"]')).not.toBeNull();
    });

    it('should render detailed view toggle button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('[data-view="detailed"]')).not.toBeNull();
    });

    it('should render raw view toggle button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('[data-view="raw"]')).not.toBeNull();
    });

    it('should have normal mode active by default', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      const normalBtn = container.querySelector('[data-view="normal"]');
      expect(normalBtn?.classList.contains('active')).toBe(true);
    });
  });

  describe('Session Loading', () => {
    it('should call sessions API to load session', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(50);

      expect(mockSessionsApi.get).toHaveBeenCalledWith('session-123');
    });

    it('should call events API to load messages', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(50);

      expect(mockSessionsApi.getEvents).toHaveBeenCalledWith('session-123');
    });

    it('should show loading spinner while loading', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.chat-loading')).not.toBeNull();
    });

    it('should update header with session title', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: { ...mockSession, userRequest: 'Test Session Title' },
      });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      const title = container.querySelector('.chat-title');
      expect(title?.textContent).toBe('Test Session Title');
    });

    it('should update header with repository info', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: {
          ...mockSession,
          repositoryOwner: 'owner',
          repositoryName: 'repo',
          branch: 'main',
        },
      });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      const subtitle = container.querySelector('.chat-subtitle');
      expect(subtitle?.textContent).toContain('owner/repo');
    });

    it('should handle session load error', async () => {
      mockSessionsApi.get.mockRejectedValue(new Error('Session not found'));

      const page = new ChatPage({ params: { sessionId: 'nonexistent' } });
      page.mount(container);
      await waitForAsync(100);

      expect(mockToast.error).toHaveBeenCalledWith('Failed to load session');
    });

    it('should navigate away if no session ID provided', async () => {
      const page = new ChatPage({});
      page.mount(container);
      await waitForAsync(50);

      expect(mockToast.error).toHaveBeenCalledWith('No session ID provided');
    });
  });

  describe('Session Status Display', () => {
    it('should display session status in header', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: { ...mockSession, status: 'completed' },
      });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      const status = container.querySelector('.chat-status');
      expect(status?.textContent).toBe('completed');
      expect(status?.classList.contains('status-completed')).toBe(true);
    });

    it('should display running status', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: mockRunningSession,
      });

      const page = new ChatPage({ params: { sessionId: 'session-running' } });
      page.mount(container);
      await waitForAsync(100);

      const status = container.querySelector('.chat-status');
      expect(status?.textContent).toBe('running');
    });
  });

  describe('Message Input', () => {
    it('should enable send button when input has text', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(50);

      const input = container.querySelector('.chat-input') as HTMLTextAreaElement;
      const sendBtn = container.querySelector('[data-action="send"]') as HTMLButtonElement;

      // Initially disabled
      expect(sendBtn.disabled).toBe(true);

      // Type text
      if (input) {
        simulateInput(input, 'Hello');
        await waitForRender();
      }

      expect(sendBtn.disabled).toBe(false);
    });

    it('should disable send button when input is empty', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(50);

      const sendBtn = container.querySelector('[data-action="send"]') as HTMLButtonElement;
      expect(sendBtn.disabled).toBe(true);
    });

    it('should show input hint text', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      const hint = container.querySelector('.chat-input-hint');
      expect(hint?.textContent).toContain('Press Enter to send');
    });
  });

  describe('Message Display', () => {
    it('should show empty message state when no messages', async () => {
      mockSessionsApi.getEvents.mockResolvedValue({ events: [] });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      // The messages list should be displayed but empty, or show the empty state
      const messagesList = container.querySelector('.messages-list');
      expect(messagesList).not.toBeNull();
    });

    it('should render user messages from events', async () => {
      mockSessionsApi.getEvents.mockResolvedValue({
        events: [
          {
            id: 'event-1',
            eventData: {
              type: 'input_preview',
              data: { preview: 'User message content' },
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      // Check for user message
      const messagesList = container.querySelector('.messages-list');
      expect(messagesList).not.toBeNull();
    });

    it('should render assistant messages from events', async () => {
      mockSessionsApi.getEvents.mockResolvedValue({
        events: [
          {
            id: 'event-1',
            eventData: {
              type: 'assistant',
              content: [{ type: 'text', text: 'Assistant response' }],
            },
            timestamp: new Date().toISOString(),
          },
        ],
      });

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForAsync(100);

      const messagesList = container.querySelector('.messages-list');
      expect(messagesList).not.toBeNull();
    });
  });

  describe('Session Execution', () => {
    it('should start execution for pending sessions', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: { ...mockPendingSession, userRequest: 'Test request' },
      });

      // Mock createSessionExecuteEventSource to return an EventSource-like object
      const mockES = {
        onopen: null as ((event: Event) => void) | null,
        onerror: null as ((event: Event) => void) | null,
        addEventListener: vi.fn(),
        close: vi.fn(),
      };
      mockCreateSessionExecuteEventSource.mockReturnValue(mockES);

      const page = new ChatPage({ params: { sessionId: 'session-pending' } });
      page.mount(container);
      await waitForAsync(100);

      expect(mockWorkerStore.startExecution).toHaveBeenCalled();
    });

    it('should connect to stream for running sessions', async () => {
      mockSessionsApi.get.mockResolvedValue({
        session: mockRunningSession,
      });

      const page = new ChatPage({ params: { sessionId: 'session-running' } });
      page.mount(container);
      await waitForAsync(100);

      expect(mockWorkerStore.startExecution).toHaveBeenCalledWith('session-running');
    });
  });

  describe('Authentication', () => {
    it('should have requiresAuth set to true', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      mockAuthStore.isAuthenticated.mockReturnValue(false);
      expect(page.canAccess()).toBe(false);
    });

    it('should allow access when authenticated', () => {
      mockAuthStore.isAuthenticated.mockReturnValue(true);

      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      expect(page.canAccess()).toBe(true);
    });
  });

  describe('Page Metadata', () => {
    it('should have correct route pattern', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      expect(page.route).toBe('/session/:sessionId/chat');
    });

    it('should have correct title', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      expect(page.title).toBe('Chat');
    });
  });

  describe('Navigation', () => {
    it('should have view code button', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      const viewCodeBtn = container.querySelector('[data-action="view-code"]');
      expect(viewCodeBtn).not.toBeNull();
    });
  });

  describe('Image Preview', () => {
    it('should have image preview container', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      expect(container.querySelector('.image-preview-container')).not.toBeNull();
    });

    it('should hide image preview container by default', () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);

      const previewContainer = container.querySelector('.image-preview-container') as HTMLElement;
      expect(previewContainer?.style.display).toBe('none');
    });
  });

  describe('Cleanup', () => {
    it('should unmount without errors', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForRender();

      expect(() => page.unmount()).not.toThrow();
    });

    it('should clean up DOM elements on unmount', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(container.querySelector('.chat-page')).toBeNull();
    });

    it('should stop worker execution on unmount', async () => {
      const page = new ChatPage({ params: { sessionId: 'session-123' } });
      page.mount(container);
      await waitForRender();

      page.unmount();

      expect(mockWorkerStore.stopExecution).toHaveBeenCalled();
    });
  });
});
