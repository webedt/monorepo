import { create } from 'zustand';
import type { User } from '@webedt/shared';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  clearUser: () => void;
  setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
  clearUser: () => set({ user: null, isAuthenticated: false, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
}));

interface RepoConnectionState {
  selectedRepo: string;
  baseBranch: string;
  isLocked: boolean;
  setSelectedRepo: (repo: string) => void;
  setBaseBranch: (branch: string) => void;
  setIsLocked: (locked: boolean) => void;
  clearRepoConnection: () => void;
}

export const useRepoStore = create<RepoConnectionState>((set) => ({
  selectedRepo: '',
  baseBranch: '',
  isLocked: false,
  setSelectedRepo: (repo) => set({ selectedRepo: repo }),
  setBaseBranch: (branch) => set({ baseBranch: branch }),
  setIsLocked: (locked) => set({ isLocked: locked }),
  clearRepoConnection: () => set({ selectedRepo: '', baseBranch: '', isLocked: false }),
}));
