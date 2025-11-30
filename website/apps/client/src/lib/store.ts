import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@webedt/shared';

// ============================================================================
// WORKER STATE MANAGEMENT
// ============================================================================
// This store provides a single source of truth for worker execution status.
// It persists to sessionStorage to survive page refreshes and navigation.
// The key insight is that we track:
// 1. The session ID of the currently executing worker
// 2. When execution started (to detect stale states)
// 3. Whether we have an active SSE connection
// ============================================================================

interface WorkerState {
  // Core state
  executingSessionId: string | null;  // The session ID that is currently executing
  executionStartedAt: number | null;  // Timestamp when execution started
  hasActiveStream: boolean;           // Whether SSE stream is currently connected
  lastHeartbeat: number | null;       // Last time we received data from the stream

  // Actions
  startExecution: (sessionId: string) => void;
  stopExecution: () => void;
  setActiveStream: (active: boolean) => void;
  recordHeartbeat: () => void;

  // Computed helpers (as functions since Zustand doesn't support getters well)
  isExecuting: (sessionId?: string) => boolean;
  isStale: () => boolean;
}

// How long before we consider an execution stale (no heartbeat)
const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

export const useWorkerStore = create<WorkerState>()(
  persist(
    (set, get) => ({
      // Initial state
      executingSessionId: null,
      executionStartedAt: null,
      hasActiveStream: false,
      lastHeartbeat: null,

      // Start execution for a session
      startExecution: (sessionId: string) => {
        console.log('[WorkerStore] Starting execution for session:', sessionId);
        set({
          executingSessionId: sessionId,
          executionStartedAt: Date.now(),
          hasActiveStream: false,
          lastHeartbeat: Date.now(),
        });
      },

      // Stop execution (clear all state)
      stopExecution: () => {
        const { executingSessionId } = get();
        console.log('[WorkerStore] Stopping execution for session:', executingSessionId);
        set({
          executingSessionId: null,
          executionStartedAt: null,
          hasActiveStream: false,
          lastHeartbeat: null,
        });
      },

      // Mark SSE stream as active/inactive
      setActiveStream: (active: boolean) => {
        console.log('[WorkerStore] Setting active stream:', active);
        set({
          hasActiveStream: active,
          lastHeartbeat: active ? Date.now() : get().lastHeartbeat,
        });
      },

      // Record a heartbeat (called when we receive data)
      recordHeartbeat: () => {
        set({ lastHeartbeat: Date.now() });
      },

      // Check if a session is executing
      // If no sessionId provided, returns true if ANY session is executing
      isExecuting: (sessionId?: string) => {
        const state = get();
        if (!state.executingSessionId) return false;
        if (sessionId) return state.executingSessionId === sessionId;
        return true;
      },

      // Check if the current execution is stale (no recent heartbeat)
      isStale: () => {
        const state = get();
        if (!state.executingSessionId || !state.lastHeartbeat) return false;
        return Date.now() - state.lastHeartbeat > STALE_THRESHOLD_MS;
      },
    }),
    {
      name: 'worker-execution-state',
      storage: {
        getItem: (name) => {
          const value = sessionStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          sessionStorage.removeItem(name);
        },
      },
      // Only persist these fields (cast needed because we intentionally omit actions and hasActiveStream)
      partialize: (state) => ({
        executingSessionId: state.executingSessionId,
        executionStartedAt: state.executionStartedAt,
        lastHeartbeat: state.lastHeartbeat,
        // Don't persist hasActiveStream - it should be false on page load
      }) as WorkerState,
    }
  )
);

// ============================================================================
// Helper hook for components that need simple isExecuting boolean
// ============================================================================
export function useIsWorkerExecuting(sessionId?: string): boolean {
  return useWorkerStore((state) => {
    if (!state.executingSessionId) return false;
    if (sessionId) return state.executingSessionId === sessionId;
    return true;
  });
}

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

// ============================================================================
// SESSION LAST VISITED PAGE TRACKING
// ============================================================================
// This store tracks the last visited page for each session, allowing users
// to return to the same page (chat, code, images, etc.) when they click on
// a session from the sessions list.
// ============================================================================

const SESSION_PAGES_STORAGE_KEY = 'sessionLastPages';

// Valid page names that can be tracked
export type SessionPageName = 'chat' | 'code' | 'images' | 'sound' | 'scene-editor' | 'preview';

interface SessionLastPageState {
  // Map of sessionId -> last visited page
  lastPages: Record<string, SessionPageName>;

  // Set the last visited page for a session
  setLastPage: (sessionId: string, page: SessionPageName) => void;

  // Get the last visited page for a session (defaults to 'chat')
  getLastPage: (sessionId: string) => SessionPageName;
}

// Load initial state from localStorage
function loadLastPages(): Record<string, SessionPageName> {
  try {
    const stored = localStorage.getItem(SESSION_PAGES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[SessionLastPage] Failed to load from localStorage:', e);
  }
  return {};
}

// Save state to localStorage
function saveLastPages(pages: Record<string, SessionPageName>) {
  try {
    localStorage.setItem(SESSION_PAGES_STORAGE_KEY, JSON.stringify(pages));
  } catch (e) {
    console.warn('[SessionLastPage] Failed to save to localStorage:', e);
  }
}

export const useSessionLastPageStore = create<SessionLastPageState>((set, get) => ({
  lastPages: loadLastPages(),

  setLastPage: (sessionId: string, page: SessionPageName) => {
    set((state) => {
      const newPages = { ...state.lastPages, [sessionId]: page };
      saveLastPages(newPages);
      return { lastPages: newPages };
    });
  },

  getLastPage: (sessionId: string): SessionPageName => {
    const state = get();
    return state.lastPages[sessionId] || 'chat';
  },
}));

// ============================================================================
// EDITOR SESSION STATE PERSISTENCE
// ============================================================================
// This store tracks the editor state (open tabs, active tab, expanded folders)
// for each session, allowing users to return to the same editor state when
// they navigate back to the code editor.
// ============================================================================

const EDITOR_STATE_STORAGE_KEY = 'editorSessionState';

// Tab type matching the one in Code.tsx
interface EditorTab {
  path: string;
  name: string;
  isPreview: boolean;
}

interface EditorSessionData {
  tabs: EditorTab[];
  activeTabPath: string | null;
  expandedFolders: string[]; // Stored as array for JSON serialization
}

interface EditorSessionStateStore {
  // Map of sessionId -> editor state
  sessions: Record<string, EditorSessionData>;

  // Save the complete editor state for a session
  saveEditorState: (
    sessionId: string,
    tabs: EditorTab[],
    activeTabPath: string | null,
    expandedFolders: Set<string>
  ) => void;

  // Get the editor state for a session
  getEditorState: (sessionId: string) => EditorSessionData | null;

  // Clear editor state for a session (e.g., when session is deleted)
  clearEditorState: (sessionId: string) => void;
}

// Load initial state from localStorage
function loadEditorState(): Record<string, EditorSessionData> {
  try {
    const stored = localStorage.getItem(EDITOR_STATE_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[EditorSessionState] Failed to load from localStorage:', e);
  }
  return {};
}

// Save state to localStorage
function saveEditorState(sessions: Record<string, EditorSessionData>) {
  try {
    // Limit storage to prevent localStorage from growing too large
    // Keep only the most recent 50 sessions
    const sessionIds = Object.keys(sessions);
    if (sessionIds.length > 50) {
      const sessionsToKeep = sessionIds.slice(-50);
      const trimmedSessions: Record<string, EditorSessionData> = {};
      sessionsToKeep.forEach(id => {
        trimmedSessions[id] = sessions[id];
      });
      sessions = trimmedSessions;
    }
    localStorage.setItem(EDITOR_STATE_STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[EditorSessionState] Failed to save to localStorage:', e);
  }
}

export const useEditorSessionStore = create<EditorSessionStateStore>((set, get) => ({
  sessions: loadEditorState(),

  saveEditorState: (
    sessionId: string,
    tabs: EditorTab[],
    activeTabPath: string | null,
    expandedFolders: Set<string>
  ) => {
    set((state) => {
      const newSessions = {
        ...state.sessions,
        [sessionId]: {
          tabs,
          activeTabPath,
          expandedFolders: Array.from(expandedFolders),
        },
      };
      saveEditorState(newSessions);
      return { sessions: newSessions };
    });
  },

  getEditorState: (sessionId: string): EditorSessionData | null => {
    const state = get();
    return state.sessions[sessionId] || null;
  },

  clearEditorState: (sessionId: string) => {
    set((state) => {
      const newSessions = { ...state.sessions };
      delete newSessions[sessionId];
      saveEditorState(newSessions);
      return { sessions: newSessions };
    });
  },
}));
