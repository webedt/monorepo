/**
 * Auth Store
 * Manages user authentication state
 */

import { Store } from '../lib/store';
import { authApi } from '../lib/api';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

export class AuthStore extends Store<AuthState> {
  constructor() {
    super({
      user: null,
      isLoading: true,
      isInitialized: false,
      error: null,
    });
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.getState().user !== null;
  }

  /**
   * Get current user
   */
  getUser(): User | null {
    return this.getState().user;
  }

  /**
   * Initialize auth state by checking session
   */
  async initialize(): Promise<void> {
    if (this.getState().isInitialized) {
      return;
    }

    this.setState({ isLoading: true, error: null });

    try {
      const response = await authApi.getSession();
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

  /**
   * Login with email and password
   */
  async login(email: string, password: string, rememberMe = false): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await authApi.login(email, password, rememberMe);

      // Verify session was established by checking it
      // This ensures the cookie was properly set before proceeding
      const sessionCheck = await authApi.getSession();
      console.log('[AuthStore] Session verified after login:', sessionCheck?.user?.email);

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

  /**
   * Register new user
   */
  async register(email: string, password: string): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      const response = await authApi.register(email, password);

      // Verify session was established by checking it
      // This ensures the cookie was properly set before proceeding
      const sessionCheck = await authApi.getSession();
      console.log('[AuthStore] Session verified after register:', sessionCheck?.user?.email);

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

  /**
   * Logout current user
   */
  async logout(): Promise<void> {
    this.setState({ isLoading: true, error: null });

    try {
      await authApi.logout();
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

  /**
   * Update user in state (after settings changes)
   */
  updateUser(updates: Partial<User>): void {
    const currentUser = this.getState().user;
    if (currentUser) {
      this.setState({
        user: { ...currentUser, ...updates },
      });
    }
  }

  /**
   * Clear any errors
   */
  clearError(): void {
    this.setState({ error: null });
  }
}

// Singleton instance with HMR support
export const authStore = new AuthStore().enableHmr('auth');

// HMR setup
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    authStore.saveForHmr();
  });
}
