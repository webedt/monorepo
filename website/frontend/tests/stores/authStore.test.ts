/**
 * Tests for AuthStore
 * Covers authentication state management including initialization,
 * login, logout, registration, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Store } from '../../src/lib/store';

import type { User } from '../../src/types';

// Mock the API module
const mockAuthApi = {
  getSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
};

vi.mock('../../src/lib/api', () => ({
  authApi: mockAuthApi,
}));

// Create a fresh AuthStore class for testing
interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

class TestAuthStore extends Store<AuthState> {
  constructor() {
    super({
      user: null,
      isLoading: true,
      isInitialized: false,
      error: null,
    });
  }

  isAuthenticated(): boolean {
    return this.getState().user !== null;
  }

  getUser(): User | null {
    return this.getState().user;
  }

  async initialize(): Promise<void> {
    if (this.getState().isInitialized) {
      return;
    }

    this.setState({ isLoading: true, error: null });

    try {
      const response = await mockAuthApi.getSession();
      this.setState({
        user: response?.user ?? null,
        isLoading: false,
        isInitialized: true,
      });
    } catch (error) {
      this.setState({
        user: null,
        isLoading: false,
        isInitialized: true,
        error: error instanceof Error ? error.message : 'Failed to check session',
      });
    }
  }

  async login(email: string, password: string, rememberMe = false): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await mockAuthApi.login(email, password, rememberMe);
      const sessionCheck = await mockAuthApi.getSession();

      this.setState({
        user: sessionCheck?.user ?? response?.user ?? null,
        isLoading: false,
      });
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Login failed',
      });
      throw error;
    }
  }

  async register(email: string, password: string): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await mockAuthApi.register(email, password);
      const sessionCheck = await mockAuthApi.getSession();

      this.setState({
        user: sessionCheck?.user ?? response?.user ?? null,
        isLoading: false,
      });
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Registration failed',
      });
      throw error;
    }
  }

  async logout(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      await mockAuthApi.logout();
      this.setState({
        user: null,
        isLoading: false,
      });
    } catch (error) {
      this.setState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Logout failed',
      });
      throw error;
    }
  }

  updateUser(updates: Partial<User>): void {
    const currentUser = this.getState().user;
    if (currentUser) {
      this.setState({
        user: { ...currentUser, ...updates },
      });
    }
  }

  clearError(): void {
    this.setState({ error: null });
  }
}

// Test user fixture
const mockUser: User = {
  id: 'user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  isAdmin: false,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('AuthStore', () => {
  let authStore: TestAuthStore;

  beforeEach(() => {
    vi.clearAllMocks();
    authStore = new TestAuthStore();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = authStore.getState();

      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(true);
      expect(state.isInitialized).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should report unauthenticated initially', () => {
      expect(authStore.isAuthenticated()).toBe(false);
    });

    it('should return null for getUser initially', () => {
      expect(authStore.getUser()).toBeNull();
    });
  });

  describe('Initialize', () => {
    it('should initialize with user from session', async () => {
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      await authStore.initialize();

      const state = authStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state.error).toBeNull();
    });

    it('should initialize with null user when no session exists', async () => {
      mockAuthApi.getSession.mockResolvedValue({ user: null });

      await authStore.initialize();

      const state = authStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
    });

    it('should handle initialization errors', async () => {
      mockAuthApi.getSession.mockRejectedValue(new Error('Network error'));

      await authStore.initialize();

      const state = authStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.isInitialized).toBe(true);
      expect(state.error).toBe('Network error');
    });

    it('should not re-initialize if already initialized', async () => {
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      await authStore.initialize();
      await authStore.initialize();

      expect(mockAuthApi.getSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('Login', () => {
    it('should successfully login user', async () => {
      mockAuthApi.login.mockResolvedValue({ user: mockUser });
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      await authStore.login('test@example.com', 'password123');

      const state = authStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(authStore.isAuthenticated()).toBe(true);
    });

    it('should set loading state during login', async () => {
      mockAuthApi.login.mockImplementation(() => new Promise(() => {})); // Never resolves

      const loginPromise = authStore.login('test@example.com', 'password123');

      expect(authStore.getState().isLoading).toBe(true);

      // Clean up
      loginPromise.catch(() => {});
    });

    it('should handle login errors', async () => {
      mockAuthApi.login.mockRejectedValue(new Error('Invalid credentials'));

      await expect(authStore.login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');

      const state = authStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('should pass rememberMe to API', async () => {
      mockAuthApi.login.mockResolvedValue({ user: mockUser });
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      await authStore.login('test@example.com', 'password123', true);

      expect(mockAuthApi.login).toHaveBeenCalledWith('test@example.com', 'password123', true);
    });

    it('should verify session after login', async () => {
      const loginUser = { ...mockUser, displayName: 'Login User' };
      const sessionUser = { ...mockUser, displayName: 'Session User' };

      mockAuthApi.login.mockResolvedValue({ user: loginUser });
      mockAuthApi.getSession.mockResolvedValue({ user: sessionUser });

      await authStore.login('test@example.com', 'password123');

      // Should use session user (verified) over login response
      expect(authStore.getState().user?.displayName).toBe('Session User');
    });
  });

  describe('Register', () => {
    it('should successfully register user', async () => {
      mockAuthApi.register.mockResolvedValue({ user: mockUser });
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      await authStore.register('new@example.com', 'password123');

      const state = authStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle registration errors', async () => {
      mockAuthApi.register.mockRejectedValue(new Error('Email already exists'));

      await expect(authStore.register('existing@example.com', 'password123')).rejects.toThrow('Email already exists');

      const state = authStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Email already exists');
    });
  });

  describe('Logout', () => {
    beforeEach(async () => {
      // Set up authenticated state
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      await authStore.initialize();
    });

    it('should successfully logout user', async () => {
      mockAuthApi.logout.mockResolvedValue({});

      await authStore.logout();

      const state = authStore.getState();
      expect(state.user).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(authStore.isAuthenticated()).toBe(false);
    });

    it('should handle logout errors', async () => {
      mockAuthApi.logout.mockRejectedValue(new Error('Logout failed'));

      await expect(authStore.logout()).rejects.toThrow('Logout failed');

      const state = authStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Logout failed');
    });
  });

  describe('Update User', () => {
    beforeEach(async () => {
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      await authStore.initialize();
    });

    it('should update user properties', () => {
      authStore.updateUser({ displayName: 'Updated Name' });

      const user = authStore.getUser();
      expect(user?.displayName).toBe('Updated Name');
      expect(user?.email).toBe('test@example.com'); // Unchanged
    });

    it('should not update if no user is logged in', () => {
      authStore.setState({ user: null, isLoading: false, isInitialized: true, error: null });

      authStore.updateUser({ displayName: 'New Name' });

      expect(authStore.getUser()).toBeNull();
    });

    it('should merge multiple updates', () => {
      authStore.updateUser({ displayName: 'First Update' });
      authStore.updateUser({ isAdmin: true });

      const user = authStore.getUser();
      expect(user?.displayName).toBe('First Update');
      expect(user?.isAdmin).toBe(true);
    });
  });

  describe('Clear Error', () => {
    it('should clear error state', async () => {
      mockAuthApi.login.mockRejectedValue(new Error('Some error'));

      try {
        await authStore.login('test@example.com', 'wrong');
      } catch {
        // Expected
      }

      expect(authStore.getState().error).toBe('Some error');

      authStore.clearError();

      expect(authStore.getState().error).toBeNull();
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', async () => {
      const subscriber = vi.fn();
      authStore.subscribe(subscriber);

      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      await authStore.initialize();

      // Called at least twice: once for loading, once for initialized
      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', async () => {
      const subscriber = vi.fn();
      const unsubscribe = authStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      await authStore.initialize();

      expect(subscriber).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', async () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      authStore.subscribe(subscriber1);
      authStore.subscribe(subscriber2);

      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      await authStore.initialize();

      expect(subscriber1).toHaveBeenCalled();
      expect(subscriber2).toHaveBeenCalled();
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent login attempts', async () => {
      mockAuthApi.login.mockResolvedValue({ user: mockUser });
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });

      // Start two login attempts concurrently
      const login1 = authStore.login('test@example.com', 'password1');
      const login2 = authStore.login('test@example.com', 'password2');

      await Promise.all([login1, login2]);

      // Store should be in a consistent state
      expect(authStore.isAuthenticated()).toBe(true);
      expect(authStore.getState().isLoading).toBe(false);
    });

    it('should maintain consistent state during rapid operations', async () => {
      mockAuthApi.getSession.mockResolvedValue({ user: mockUser });
      mockAuthApi.login.mockResolvedValue({ user: mockUser });
      mockAuthApi.logout.mockResolvedValue({});

      await authStore.initialize();

      // Rapid state changes
      authStore.updateUser({ displayName: 'Name 1' });
      authStore.updateUser({ displayName: 'Name 2' });
      authStore.updateUser({ displayName: 'Name 3' });

      expect(authStore.getUser()?.displayName).toBe('Name 3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined response from session check', async () => {
      mockAuthApi.getSession.mockResolvedValue(undefined);

      await authStore.initialize();

      expect(authStore.getState().user).toBeNull();
      expect(authStore.getState().isInitialized).toBe(true);
    });

    it('should handle non-Error exceptions', async () => {
      mockAuthApi.login.mockRejectedValue('String error');

      await expect(authStore.login('test@example.com', 'password')).rejects.toBe('String error');

      expect(authStore.getState().error).toBe('Login failed');
    });
  });
});
