import { create } from 'zustand';
import type { User } from '@webedt/shared';

// Global voice recording state - persists across navigation
interface VoiceRecordingState {
  isRecording: boolean;
  recognition: any | null; // SpeechRecognition instance
  keepRecording: boolean;
  transcript: string; // Accumulated transcript
  setIsRecording: (isRecording: boolean) => void;
  setRecognition: (recognition: any | null) => void;
  setKeepRecording: (keepRecording: boolean) => void;
  setTranscript: (transcript: string) => void;
  appendTranscript: (text: string) => void;
  clearTranscript: () => void;
  stopRecording: () => void;
}

export const useVoiceRecordingStore = create<VoiceRecordingState>((set, get) => ({
  isRecording: false,
  recognition: null,
  keepRecording: false,
  transcript: '',
  setIsRecording: (isRecording) => set({ isRecording }),
  setRecognition: (recognition) => set({ recognition }),
  setKeepRecording: (keepRecording) => set({ keepRecording }),
  setTranscript: (transcript) => set({ transcript }),
  appendTranscript: (text) => set((state) => ({
    transcript: state.transcript ? state.transcript + '\n' + text : text
  })),
  clearTranscript: () => set({ transcript: '' }),
  stopRecording: () => {
    const { recognition } = get();
    if (recognition && recognition.stop) {
      try {
        recognition.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
    }
    set({
      isRecording: false,
      recognition: null,
      keepRecording: false,
    });
  },
}));

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
