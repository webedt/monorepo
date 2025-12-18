import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/shared';

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
  isLocked: boolean;
  setSelectedRepo: (repo: string) => void;
  setIsLocked: (locked: boolean) => void;
  clearRepoConnection: () => void;
}

export const useRepoStore = create<RepoConnectionState>((set) => ({
  selectedRepo: '',
  isLocked: false,
  setSelectedRepo: (repo) => set({ selectedRepo: repo }),
  setIsLocked: (locked) => set({ isLocked: locked }),
  clearRepoConnection: () => set({ selectedRepo: '', isLocked: false }),
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

// Pending change type matching the one in Code.tsx
interface PendingChange {
  content: string;
  originalContent: string;
  sha?: string;
}

interface EditorSessionData {
  tabs: EditorTab[];
  activeTabPath: string | null;
  expandedFolders: string[]; // Stored as array for JSON serialization
  pendingChanges: Record<string, PendingChange>; // Map stored as object for JSON
}

interface EditorSessionStateStore {
  // Map of sessionId -> editor state
  sessions: Record<string, EditorSessionData>;

  // Save the complete editor state for a session
  saveEditorState: (
    sessionId: string,
    tabs: EditorTab[],
    activeTabPath: string | null,
    expandedFolders: Set<string>,
    pendingChanges: Map<string, PendingChange>
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
    expandedFolders: Set<string>,
    pendingChanges: Map<string, PendingChange>
  ) => {
    set((state) => {
      // Convert Map to plain object for JSON serialization
      const pendingChangesObj: Record<string, PendingChange> = {};
      pendingChanges.forEach((value, key) => {
        pendingChangesObj[key] = value;
      });

      const newSessions = {
        ...state.sessions,
        [sessionId]: {
          tabs,
          activeTabPath,
          expandedFolders: Array.from(expandedFolders),
          pendingChanges: pendingChangesObj,
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

// ============================================================================
// NEW IMAGE MODAL PREFERENCES
// ============================================================================
// This store persists user preferences for the "New Image" modal, including:
// - Last used width/height
// - Selected aspect ratio tab
// - File extension type
// ============================================================================

const NEW_IMAGE_PREFS_STORAGE_KEY = 'newImagePreferences';

export type AspectRatioTab = '1:1' | '4:3' | '16:9' | '3:2' | 'custom';
export type ImageExtension = 'png' | 'jpg' | 'gif' | 'webp' | 'svg' | 'ico' | 'bmp';

// Common resolution presets organized by aspect ratio
export const RESOLUTION_PRESETS = {
  '1:1': [
    { width: 16, height: 16 },
    { width: 32, height: 32 },
    { width: 64, height: 64 },
    { width: 128, height: 128 },
    { width: 256, height: 256 },
    { width: 512, height: 512 },
    { width: 1024, height: 1024 },
    { width: 2048, height: 2048 },
    { width: 4096, height: 4096 },
    { width: 8192, height: 8192 },
  ],
  '4:3': [
    { width: 320, height: 240 },
    { width: 640, height: 480 },
    { width: 800, height: 600 },
    { width: 1024, height: 768 },
    { width: 1280, height: 960 },
    { width: 1400, height: 1050 },
    { width: 1600, height: 1200 },
    { width: 2048, height: 1536 },
  ],
  '16:9': [
    { width: 640, height: 360 },
    { width: 854, height: 480 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 },
    { width: 7680, height: 4320 },
  ],
  '3:2': [
    { width: 240, height: 160 },
    { width: 480, height: 320 },
    { width: 720, height: 480 },
    { width: 1080, height: 720 },
    { width: 1440, height: 960 },
    { width: 2160, height: 1440 },
    { width: 3000, height: 2000 },
  ],
  'custom': [], // Custom allows any size
} as const;

interface NewImagePreferences {
  width: number;
  height: number;
  aspectRatioTab: AspectRatioTab;
  extension: ImageExtension;
}

interface NewImagePreferencesState extends NewImagePreferences {
  // Actions
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setDimensions: (width: number, height: number) => void;
  setAspectRatioTab: (tab: AspectRatioTab) => void;
  setExtension: (ext: ImageExtension) => void;
}

// Load preferences from localStorage
function loadNewImagePrefs(): NewImagePreferences {
  const defaults: NewImagePreferences = {
    width: 1024,
    height: 1024,
    aspectRatioTab: '1:1',
    extension: 'png',
  };

  try {
    const stored = localStorage.getItem(NEW_IMAGE_PREFS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaults, ...parsed };
    }
  } catch (e) {
    console.warn('[NewImagePrefs] Failed to load from localStorage:', e);
  }
  return defaults;
}

// Save preferences to localStorage
function saveNewImagePrefs(prefs: NewImagePreferences) {
  try {
    localStorage.setItem(NEW_IMAGE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[NewImagePrefs] Failed to save to localStorage:', e);
  }
}

export const useNewImagePreferencesStore = create<NewImagePreferencesState>((set, get) => {
  const initialPrefs = loadNewImagePrefs();

  return {
    ...initialPrefs,

    setWidth: (width: number) => {
      set({ width });
      saveNewImagePrefs({ ...get(), width });
    },

    setHeight: (height: number) => {
      set({ height });
      saveNewImagePrefs({ ...get(), height });
    },

    setDimensions: (width: number, height: number) => {
      set({ width, height });
      saveNewImagePrefs({ ...get(), width, height });
    },

    setAspectRatioTab: (aspectRatioTab: AspectRatioTab) => {
      set({ aspectRatioTab });
      saveNewImagePrefs({ ...get(), aspectRatioTab });
    },

    setExtension: (extension: ImageExtension) => {
      set({ extension });
      saveNewImagePrefs({ ...get(), extension });
    },
  };
});

// ============================================================================
// SPLIT VIEW PREFERENCES
// ============================================================================
// This store persists split view preferences per session, including:
// - Split ratio (how much space each pane takes)
// - Orientation (horizontal or vertical)
// - Last used split configuration
// ============================================================================

const SPLIT_VIEW_STORAGE_KEY = 'splitViewPreferences';

export type SplitOrientation = 'horizontal' | 'vertical';

interface SplitViewSessionPrefs {
  ratio: number;
  orientation: SplitOrientation;
  lastConfig?: string; // e.g., 'code+preview'
}

interface SplitViewPreferencesState {
  // Map of sessionId -> split preferences
  sessions: Record<string, SplitViewSessionPrefs>;

  // Get preferences for a session (with defaults)
  getSplitPrefs: (sessionId: string) => SplitViewSessionPrefs;

  // Set split ratio for a session
  setSplitRatio: (sessionId: string, ratio: number) => void;

  // Set orientation for a session
  setOrientation: (sessionId: string, orientation: SplitOrientation) => void;

  // Set last used split config for a session
  setLastConfig: (sessionId: string, config: string) => void;
}

// Default preferences
const DEFAULT_SPLIT_PREFS: SplitViewSessionPrefs = {
  ratio: 0.5,
  orientation: 'horizontal',
};

// Load initial state from localStorage
function loadSplitViewPrefs(): Record<string, SplitViewSessionPrefs> {
  try {
    const stored = localStorage.getItem(SPLIT_VIEW_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[SplitViewPrefs] Failed to load from localStorage:', e);
  }
  return {};
}

// Save state to localStorage
function saveSplitViewPrefs(sessions: Record<string, SplitViewSessionPrefs>) {
  try {
    // Limit to 100 sessions to prevent localStorage bloat
    const sessionIds = Object.keys(sessions);
    if (sessionIds.length > 100) {
      const sessionsToKeep = sessionIds.slice(-100);
      const trimmed: Record<string, SplitViewSessionPrefs> = {};
      sessionsToKeep.forEach(id => {
        trimmed[id] = sessions[id];
      });
      sessions = trimmed;
    }
    localStorage.setItem(SPLIT_VIEW_STORAGE_KEY, JSON.stringify(sessions));
  } catch (e) {
    console.warn('[SplitViewPrefs] Failed to save to localStorage:', e);
  }
}

export const useSplitViewStore = create<SplitViewPreferencesState>((set, get) => ({
  sessions: loadSplitViewPrefs(),

  getSplitPrefs: (sessionId: string): SplitViewSessionPrefs => {
    const state = get();
    return state.sessions[sessionId] || DEFAULT_SPLIT_PREFS;
  },

  setSplitRatio: (sessionId: string, ratio: number) => {
    set((state) => {
      const currentPrefs = state.sessions[sessionId] || DEFAULT_SPLIT_PREFS;
      const newSessions = {
        ...state.sessions,
        [sessionId]: { ...currentPrefs, ratio },
      };
      saveSplitViewPrefs(newSessions);
      return { sessions: newSessions };
    });
  },

  setOrientation: (sessionId: string, orientation: SplitOrientation) => {
    set((state) => {
      const currentPrefs = state.sessions[sessionId] || DEFAULT_SPLIT_PREFS;
      const newSessions = {
        ...state.sessions,
        [sessionId]: { ...currentPrefs, orientation },
      };
      saveSplitViewPrefs(newSessions);
      return { sessions: newSessions };
    });
  },

  setLastConfig: (sessionId: string, config: string) => {
    set((state) => {
      const currentPrefs = state.sessions[sessionId] || DEFAULT_SPLIT_PREFS;
      const newSessions = {
        ...state.sessions,
        [sessionId]: { ...currentPrefs, lastConfig: config },
      };
      saveSplitViewPrefs(newSessions);
      return { sessions: newSessions };
    });
  },
}));

// ============================================================================
// SESSIONS SIDEBAR STATE
// ============================================================================
// This store manages the state of the expandable sessions sidebar, persisting
// the collapsed/expanded state to localStorage so it survives page refreshes.
// ============================================================================

const SIDEBAR_STATE_STORAGE_KEY = 'sessionsSidebarState';

interface SessionsSidebarState {
  isExpanded: boolean;
  setIsExpanded: (expanded: boolean) => void;
  toggle: () => void;
}

// Load initial state from localStorage
function loadSidebarState(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_STATE_STORAGE_KEY);
    if (stored !== null) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('[SessionsSidebar] Failed to load from localStorage:', e);
  }
  return true; // Default to expanded
}

// Save state to localStorage
function saveSidebarState(isExpanded: boolean) {
  try {
    localStorage.setItem(SIDEBAR_STATE_STORAGE_KEY, JSON.stringify(isExpanded));
  } catch (e) {
    console.warn('[SessionsSidebar] Failed to save to localStorage:', e);
  }
}

export const useSessionsSidebarStore = create<SessionsSidebarState>((set, get) => ({
  isExpanded: loadSidebarState(),

  setIsExpanded: (isExpanded: boolean) => {
    set({ isExpanded });
    saveSidebarState(isExpanded);
  },

  toggle: () => {
    const newState = !get().isExpanded;
    set({ isExpanded: newState });
    saveSidebarState(newState);
  },
}));

// ============================================================================
// RECENT REPOSITORIES
// ============================================================================
// This store tracks the most recently used repositories (up to 5), allowing
// users to quickly switch between frequently used repos. The list is ordered
// by most recent first, and repos can be manually removed.
// ============================================================================

const RECENT_REPOS_STORAGE_KEY = 'recentRepos';
const MAX_RECENT_REPOS = 5;

// Each recent repo entry stores the cloneUrl (used as identifier)
interface RecentReposState {
  // List of recent repo cloneUrls, most recent first
  recentRepoUrls: string[];

  // Add a repo to the recent list (moves to front if already exists)
  addRecentRepo: (cloneUrl: string) => void;

  // Remove a repo from the recent list
  removeRecentRepo: (cloneUrl: string) => void;

  // Get the recent repos list
  getRecentRepos: () => string[];
}

// Load initial state from localStorage
function loadRecentRepos(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_REPOS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Ensure it's an array and limit to max
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_RECENT_REPOS);
      }
    }
  } catch (e) {
    console.warn('[RecentRepos] Failed to load from localStorage:', e);
  }
  return [];
}

// Save state to localStorage
function saveRecentRepos(repos: string[]) {
  try {
    localStorage.setItem(RECENT_REPOS_STORAGE_KEY, JSON.stringify(repos));
  } catch (e) {
    console.warn('[RecentRepos] Failed to save to localStorage:', e);
  }
}

export const useRecentReposStore = create<RecentReposState>((set, get) => ({
  recentRepoUrls: loadRecentRepos(),

  addRecentRepo: (cloneUrl: string) => {
    if (!cloneUrl) return; // Don't add empty strings

    set((state) => {
      // Remove if already exists (will be re-added at front)
      const filtered = state.recentRepoUrls.filter(url => url !== cloneUrl);
      // Add to front and limit to max
      const newList = [cloneUrl, ...filtered].slice(0, MAX_RECENT_REPOS);
      saveRecentRepos(newList);
      return { recentRepoUrls: newList };
    });
  },

  removeRecentRepo: (cloneUrl: string) => {
    set((state) => {
      const newList = state.recentRepoUrls.filter(url => url !== cloneUrl);
      saveRecentRepos(newList);
      return { recentRepoUrls: newList };
    });
  },

  getRecentRepos: () => {
    return get().recentRepoUrls;
  },
}));

// ============================================================================
// IMAGE EDITOR LAYERS STORE
// ============================================================================
// This store manages layers for the image editor, including:
// - Layer list with order, visibility, opacity, blend mode
// - Active layer selection
// - Layer operations (add, remove, reorder, merge)
// ============================================================================

export interface ImageLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0-100
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';
  locked: boolean;
  imageData?: string; // Base64 data URL of the layer content
}

interface ImageLayersState {
  // Layers array (index 0 is bottom, last is top)
  layers: ImageLayer[];
  // Currently active layer ID
  activeLayerId: string | null;

  // Actions
  addLayer: (name?: string, imageData?: string) => string;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => string | null;
  setActiveLayer: (id: string | null) => void;
  toggleLayerVisibility: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  setLayerBlendMode: (id: string, blendMode: ImageLayer['blendMode']) => void;
  setLayerLocked: (id: string, locked: boolean) => void;
  renameLayer: (id: string, name: string) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  setLayerImageData: (id: string, imageData: string) => void;
  clearLayers: () => void;
  initializeBaseLayer: (imageData?: string) => void;
}

// Generate unique layer ID
function generateLayerId(): string {
  return `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const useImageLayersStore = create<ImageLayersState>((set, get) => ({
  layers: [],
  activeLayerId: null,

  addLayer: (name?: string, imageData?: string) => {
    const id = generateLayerId();
    const layerCount = get().layers.length;
    const layer: ImageLayer = {
      id,
      name: name || `Layer ${layerCount + 1}`,
      visible: true,
      opacity: 100,
      blendMode: 'normal',
      locked: false,
      imageData,
    };

    set((state) => ({
      layers: [...state.layers, layer],
      activeLayerId: id, // Auto-select new layer
    }));

    return id;
  },

  removeLayer: (id: string) => {
    set((state) => {
      // Don't remove the last layer
      if (state.layers.length <= 1) return state;

      const newLayers = state.layers.filter((l) => l.id !== id);
      let newActiveId = state.activeLayerId;

      // If we removed the active layer, select another one
      if (state.activeLayerId === id) {
        const removedIndex = state.layers.findIndex((l) => l.id === id);
        newActiveId = newLayers[Math.min(removedIndex, newLayers.length - 1)]?.id || null;
      }

      return {
        layers: newLayers,
        activeLayerId: newActiveId,
      };
    });
  },

  duplicateLayer: (id: string) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === id);
    if (!layer) return null;

    const newId = generateLayerId();
    const newLayer: ImageLayer = {
      ...layer,
      id: newId,
      name: `${layer.name} (copy)`,
      locked: false,
    };

    const index = state.layers.findIndex((l) => l.id === id);
    set((state) => ({
      layers: [
        ...state.layers.slice(0, index + 1),
        newLayer,
        ...state.layers.slice(index + 1),
      ],
      activeLayerId: newId,
    }));

    return newId;
  },

  setActiveLayer: (id: string | null) => {
    set({ activeLayerId: id });
  },

  toggleLayerVisibility: (id: string) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l
      ),
    }));
  },

  setLayerOpacity: (id: string, opacity: number) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, opacity: Math.max(0, Math.min(100, opacity)) } : l
      ),
    }));
  },

  setLayerBlendMode: (id: string, blendMode: ImageLayer['blendMode']) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, blendMode } : l
      ),
    }));
  },

  setLayerLocked: (id: string, locked: boolean) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, locked } : l
      ),
    }));
  },

  renameLayer: (id: string, name: string) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, name } : l
      ),
    }));
  },

  moveLayerUp: (id: string) => {
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index >= state.layers.length - 1) return state;

      const newLayers = [...state.layers];
      [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];
      return { layers: newLayers };
    });
  },

  moveLayerDown: (id: string) => {
    set((state) => {
      const index = state.layers.findIndex((l) => l.id === id);
      if (index <= 0) return state;

      const newLayers = [...state.layers];
      [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];
      return { layers: newLayers };
    });
  },

  setLayerImageData: (id: string, imageData: string) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === id ? { ...l, imageData } : l
      ),
    }));
  },

  clearLayers: () => {
    set({ layers: [], activeLayerId: null });
  },

  initializeBaseLayer: (imageData?: string) => {
    const state = get();
    if (state.layers.length === 0) {
      const id = generateLayerId();
      const layer: ImageLayer = {
        id,
        name: 'Background',
        visible: true,
        opacity: 100,
        blendMode: 'normal',
        locked: false,
        imageData,
      };
      set({ layers: [layer], activeLayerId: id });
    }
  },
}));

// ============================================================================
// IMAGE AI PREFERENCES STORE
// ============================================================================
// Stores the user's local preferences for image AI, including:
// - Last used provider and model (for quick switching in editor)
// ============================================================================

const IMAGE_AI_PREFS_STORAGE_KEY = 'imageAiPreferences';

interface ImageAiPreferences {
  provider: 'openrouter' | 'cometapi' | 'google';
  model: string;
}

interface ImageAiPreferencesState extends ImageAiPreferences {
  setProvider: (provider: 'openrouter' | 'cometapi' | 'google') => void;
  setModel: (model: string) => void;
}

function loadImageAiPrefs(): ImageAiPreferences {
  const defaults: ImageAiPreferences = {
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-image',
  };

  try {
    const stored = localStorage.getItem(IMAGE_AI_PREFS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaults, ...parsed };
    }
  } catch (e) {
    console.warn('[ImageAiPrefs] Failed to load from localStorage:', e);
  }
  return defaults;
}

function saveImageAiPrefs(prefs: ImageAiPreferences) {
  try {
    localStorage.setItem(IMAGE_AI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('[ImageAiPrefs] Failed to save to localStorage:', e);
  }
}

export const useImageAiPreferencesStore = create<ImageAiPreferencesState>((set, get) => {
  const initialPrefs = loadImageAiPrefs();

  return {
    ...initialPrefs,

    setProvider: (provider) => {
      set({ provider });
      saveImageAiPrefs({ ...get(), provider });
    },

    setModel: (model) => {
      set({ model });
      saveImageAiPrefs({ ...get(), model });
    },
  };
});
