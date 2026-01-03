/**
 * Tests for PresenceStore
 * Covers collaborative presence tracking, SSE connections,
 * cursor updates, and user color assignments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock workspacePresenceApi
const mockPresenceApi = {
  updatePresence: vi.fn().mockResolvedValue(undefined),
  removePresence: vi.fn().mockResolvedValue(undefined),
  getStreamUrl: vi.fn().mockReturnValue('http://test/presence/stream'),
};

vi.mock('../../src/lib/api', () => ({
  workspacePresenceApi: mockPresenceApi,
}));

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, ((event: MessageEvent) => void)[]> = {};

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }
    this.listeners[type].push(listener);
  }

  dispatchEvent(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners[type] || []) {
      listener(event);
    }
  }

  close = vi.fn();

  static reset(): void {
    MockEventSource.instances = [];
  }
}

vi.stubGlobal('EventSource', MockEventSource);

// Mock Store base class
vi.mock('../../src/lib/store', () => ({
  Store: vi.fn().mockImplementation(function(this: {
    state: unknown;
    subscribers: Set<(state: unknown, prev: unknown) => void>;
    getState: () => unknown;
    setState: (partial: unknown) => void;
    subscribe: (fn: (state: unknown, prev: unknown) => void) => () => void;
  }, initialState: unknown) {
    this.state = initialState;
    this.subscribers = new Set();
    this.getState = () => this.state;
    this.setState = (partial: unknown) => {
      const prev = this.state;
      this.state = { ...(this.state as object), ...(partial as object) };
      for (const sub of this.subscribers) {
        sub(this.state, prev);
      }
    };
    this.subscribe = (fn: (state: unknown, prev: unknown) => void) => {
      this.subscribers.add(fn);
      return () => this.subscribers.delete(fn);
    };
    return this;
  }),
}));

// Import after mocks
import { presenceStore } from '../../src/stores/presenceStore';

import type { PresenceUser } from '../../src/lib/api';

describe('PresenceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    MockEventSource.reset();
    presenceStore.disconnect();
  });

  afterEach(() => {
    vi.useRealTimers();
    presenceStore.disconnect();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = presenceStore.getState();

      expect(state.isConnected).toBe(false);
      expect(state.isConnecting).toBe(false);
      expect(state.owner).toBeNull();
      expect(state.repo).toBeNull();
      expect(state.branch).toBeNull();
      expect(state.otherUsers).toEqual([]);
      expect(state.currentFilePath).toBeNull();
      expect(state.error).toBeNull();
    });

    it('should report not enabled initially', () => {
      expect(presenceStore.isEnabled()).toBe(false);
    });
  });

  describe('User Colors', () => {
    it('should generate consistent colors for same user ID', () => {
      const color1 = presenceStore.getUserColor('user-123');
      const color2 = presenceStore.getUserColor('user-123');

      expect(color1).toBe(color2);
    });

    it('should generate different colors for different users', () => {
      const colors = new Set<string>();

      for (let i = 0; i < 20; i++) {
        colors.add(presenceStore.getUserColor(`user-${i}`));
      }

      // Should have multiple distinct colors
      expect(colors.size).toBeGreaterThan(1);
    });

    it('should return valid hex colors', () => {
      const color = presenceStore.getUserColor('test-user');

      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe('Connection', () => {
    it('should connect to a workspace', async () => {
      const connectPromise = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connectPromise;

      const state = presenceStore.getState();
      expect(state.isConnected).toBe(true);
      expect(state.owner).toBe('owner');
      expect(state.repo).toBe('repo');
      expect(state.branch).toBe('main');
    });

    it('should send initial presence update on connect', async () => {
      const connectPromise = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(mockPresenceApi.updatePresence).toHaveBeenCalled();
    });

    it('should start SSE connection', async () => {
      const connectPromise = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connectPromise;

      expect(MockEventSource.instances.length).toBe(1);
      expect(MockEventSource.instances[0].withCredentials).toBe(true);
    });

    it('should handle connection errors', async () => {
      mockPresenceApi.updatePresence.mockRejectedValueOnce(new Error('Network error'));

      const connectPromise = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connectPromise;

      const state = presenceStore.getState();
      expect(state.isConnected).toBe(false);
      expect(state.error).toBe('Network error');
    });

    it('should disconnect from previous workspace when reconnecting', async () => {
      const connect1 = presenceStore.connect('owner1', 'repo1', 'main');
      await vi.runAllTimersAsync();
      await connect1;

      const firstEventSource = MockEventSource.instances[0];

      const connect2 = presenceStore.connect('owner2', 'repo2', 'main');
      await vi.runAllTimersAsync();
      await connect2;

      expect(firstEventSource.close).toHaveBeenCalled();
    });
  });

  describe('Disconnect', () => {
    beforeEach(async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;
    });

    it('should disconnect from workspace', () => {
      presenceStore.disconnect();

      const state = presenceStore.getState();
      expect(state.isConnected).toBe(false);
      expect(state.owner).toBeNull();
      expect(state.repo).toBeNull();
    });

    it('should close SSE connection', () => {
      const eventSource = MockEventSource.instances[0];

      presenceStore.disconnect();

      expect(eventSource.close).toHaveBeenCalled();
    });

    it('should notify server of departure', () => {
      presenceStore.disconnect();

      expect(mockPresenceApi.removePresence).toHaveBeenCalledWith('owner', 'repo', 'main');
    });

    it('should clear other users', () => {
      presenceStore.disconnect();

      expect(presenceStore.getState().otherUsers).toEqual([]);
    });
  });

  describe('Cursor Updates', () => {
    beforeEach(async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;
      vi.clearAllMocks();
    });

    it('should update cursor position', () => {
      presenceStore.updateCursor('src/file.ts', 10, 5);

      const state = presenceStore.getState();
      expect(state.currentFilePath).toBe('src/file.ts');
      expect(state.currentCursorLine).toBe(10);
      expect(state.currentCursorCol).toBe(5);
    });

    it('should debounce presence updates', async () => {
      presenceStore.updateCursor('file.ts', 1, 1);
      presenceStore.updateCursor('file.ts', 2, 1);
      presenceStore.updateCursor('file.ts', 3, 1);

      expect(mockPresenceApi.updatePresence).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);

      expect(mockPresenceApi.updatePresence).toHaveBeenCalledTimes(1);
    });
  });

  describe('Selection Updates', () => {
    beforeEach(async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;
    });

    it('should update selection', () => {
      presenceStore.updateSelection('src/file.ts', 10, 15, 5, 20);

      const state = presenceStore.getState();
      expect(state.currentFilePath).toBe('src/file.ts');
      expect(state.selectionStartLine).toBe(10);
      expect(state.selectionEndLine).toBe(15);
      expect(state.selectionStartCol).toBe(5);
      expect(state.selectionEndCol).toBe(20);
    });
  });

  describe('Other Users', () => {
    beforeEach(async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;
    });

    it('should get other users with colors', () => {
      const mockUsers: PresenceUser[] = [
        {
          userId: 'user-1',
          displayName: 'User 1',
          page: 'code',
          lastSeen: new Date().toISOString(),
        },
        {
          userId: 'user-2',
          displayName: 'User 2',
          page: 'code',
          lastSeen: new Date().toISOString(),
        },
      ];

      // Simulate presence update from SSE
      const eventSource = MockEventSource.instances[0];
      eventSource.dispatchEvent('presence_update', { users: mockUsers });

      const usersWithColors = presenceStore.getOtherUsersWithColors();

      expect(usersWithColors.length).toBe(2);
      expect(usersWithColors[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(usersWithColors[1].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should filter out current user from other users', () => {
      const mockUsers: PresenceUser[] = [
        {
          userId: 'user-1',
          displayName: 'User 1',
          page: 'code',
          lastSeen: new Date().toISOString(),
          isCurrentUser: true,
        },
        {
          userId: 'user-2',
          displayName: 'User 2',
          page: 'code',
          lastSeen: new Date().toISOString(),
          isCurrentUser: false,
        },
      ];

      const eventSource = MockEventSource.instances[0];
      eventSource.dispatchEvent('presence_update', { users: mockUsers });

      expect(presenceStore.getState().otherUsers.length).toBe(1);
      expect(presenceStore.getState().otherUsers[0].userId).toBe('user-2');
    });

    it('should get users in specific file', () => {
      const mockUsers: PresenceUser[] = [
        {
          userId: 'user-1',
          displayName: 'User 1',
          page: 'code',
          lastSeen: new Date().toISOString(),
          selection: { filePath: 'src/app.ts', startLine: 10 },
        },
        {
          userId: 'user-2',
          displayName: 'User 2',
          page: 'code',
          lastSeen: new Date().toISOString(),
          selection: { filePath: 'src/utils.ts', startLine: 5 },
        },
      ];

      const eventSource = MockEventSource.instances[0];
      eventSource.dispatchEvent('presence_update', { users: mockUsers });

      const usersInFile = presenceStore.getUsersInFile('src/app.ts');

      expect(usersInFile.length).toBe(1);
      expect(usersInFile[0].userId).toBe('user-1');
    });
  });

  describe('Heartbeat', () => {
    it('should send heartbeat every 5 seconds', async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;

      vi.clearAllMocks();

      // Advance by 5 seconds
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockPresenceApi.updatePresence).toHaveBeenCalled();
    });

    it('should stop heartbeat on disconnect', async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;

      presenceStore.disconnect();
      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(10000);

      expect(mockPresenceApi.updatePresence).not.toHaveBeenCalled();
    });
  });

  describe('Reconnection', () => {
    beforeEach(async () => {
      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;
    });

    it('should attempt reconnection on SSE error', async () => {
      const eventSource = MockEventSource.instances[0];
      const initialCount = MockEventSource.instances.length;

      // Trigger error
      eventSource.onerror?.();
      await vi.advanceTimersByTimeAsync(1000);

      expect(MockEventSource.instances.length).toBe(initialCount + 1);
    });

    it('should use exponential backoff for reconnection', async () => {
      const eventSource = MockEventSource.instances[0];

      // First attempt - 1 second
      eventSource.onerror?.();
      await vi.advanceTimersByTimeAsync(500);
      expect(MockEventSource.instances.length).toBe(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(MockEventSource.instances.length).toBe(2);

      // Second attempt - 2 seconds
      MockEventSource.instances[1].onerror?.();
      await vi.advanceTimersByTimeAsync(1500);
      expect(MockEventSource.instances.length).toBe(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(MockEventSource.instances.length).toBe(3);
    });

    it('should stop reconnecting after max attempts', async () => {
      for (let i = 0; i < 10; i++) {
        const lastEventSource = MockEventSource.instances[MockEventSource.instances.length - 1];
        lastEventSource.onerror?.();
        await vi.advanceTimersByTimeAsync(60000); // Max delay is 30s
      }

      const state = presenceStore.getState();
      expect(state.error).toBe('Lost connection to presence server');
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', async () => {
      const subscriber = vi.fn();
      presenceStore.subscribe(subscriber);

      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', async () => {
      const subscriber = vi.fn();
      const unsubscribe = presenceStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      const connect = presenceStore.connect('owner', 'repo', 'main');
      await vi.runAllTimersAsync();
      await connect;

      expect(subscriber).not.toHaveBeenCalled();
    });
  });
});
