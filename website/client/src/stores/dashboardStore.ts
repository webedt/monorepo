import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Widget configuration interface for Dashboard layout
 * Based on SPEC.md Section 2.2 - Available Widgets/Sections
 */
export interface DashboardWidget {
  id: string;
  title: string;
  enabled: boolean;
  order: number;
}

/**
 * User focus type for dashboard personalization
 * Implements SPEC.md Section 2.3 - Personalization
 * - player: Focus on games, recently played, library favorites
 * - editor: Focus on editor sessions, quick access, session activity
 * - balanced: Shows all widgets for users who use both features
 */
export type UserFocusType = 'player' | 'editor' | 'balanced';

/**
 * Dashboard store state interface
 */
export interface DashboardState {
  // Widget configuration
  widgets: DashboardWidget[];

  // User preferences
  userFocus: UserFocusType;
  dashboardAsLandingPage: boolean;

  // UI state
  isCustomizing: boolean;
  draggedWidget: string | null;

  // Last update timestamp
  lastUpdated: number;
}

/**
 * Dashboard store actions interface
 */
export interface DashboardActions {
  // Widget visibility actions
  toggleWidget: (widgetId: string) => void;
  showWidget: (widgetId: string) => void;
  hideWidget: (widgetId: string) => void;

  // Widget ordering actions
  reorderWidgets: (draggedId: string, targetId: string) => void;
  moveWidgetUp: (widgetId: string) => void;
  moveWidgetDown: (widgetId: string) => void;

  // Focus and preset actions
  setUserFocus: (focus: UserFocusType) => void;
  applyFocusPreset: (focus: UserFocusType) => void;

  // Landing page preference
  setDashboardAsLandingPage: (value: boolean) => void;

  // UI state actions
  setIsCustomizing: (isCustomizing: boolean) => void;
  setDraggedWidget: (widgetId: string | null) => void;

  // Reset
  resetToDefaults: () => void;

  // Computed getters
  getEnabledWidgets: () => DashboardWidget[];
  getWidgetById: (widgetId: string) => DashboardWidget | undefined;
}

/**
 * Default widget configuration from SPEC.md Section 2.2
 * - Recently Played: User's recently played games
 * - Editor Quick Access: Recent sessions, quick-start options
 * - Store Highlights: Featured and new items
 * - Library Favorites: Quick access to favorited items
 * - Community Activity: Recent channel messages
 * - Session Activity: Active/recent editor sessions
 */
export const defaultWidgets: DashboardWidget[] = [
  { id: 'recently-played', title: 'Recently Played', enabled: true, order: 0 },
  { id: 'editor-quick-access', title: 'Editor Quick Access', enabled: true, order: 1 },
  { id: 'store-highlights', title: 'Store Highlights', enabled: true, order: 2 },
  { id: 'library-favorites', title: 'Library Favorites', enabled: true, order: 3 },
  { id: 'community-activity', title: 'Community Activity', enabled: true, order: 4 },
  { id: 'session-activity', title: 'Session Activity', enabled: true, order: 5 },
];

/**
 * Widget IDs enabled by default for each focus mode
 * - Player: Emphasizes games and library
 * - Editor: Emphasizes sessions and development tools
 * - Balanced: Shows all widgets
 */
const focusWidgetDefaults: Record<UserFocusType, string[]> = {
  player: ['recently-played', 'library-favorites', 'store-highlights', 'community-activity'],
  editor: ['editor-quick-access', 'session-activity', 'store-highlights', 'community-activity'],
  balanced: ['recently-played', 'editor-quick-access', 'store-highlights', 'library-favorites', 'community-activity', 'session-activity'],
};

/**
 * Initial state for the dashboard store
 */
const initialState: DashboardState = {
  widgets: defaultWidgets,
  userFocus: 'balanced',
  dashboardAsLandingPage: false,
  isCustomizing: false,
  draggedWidget: null,
  lastUpdated: Date.now(),
};

/**
 * Dashboard Store
 * Centralized state management for the dashboard widget system
 *
 * Implements SPEC.md Section 2 - Dashboard (Homepage):
 * - Section 2.1: Customizable Widget System
 *   - Drag-and-drop widget arrangement
 *   - Choose which sections appear
 *   - Save layout per user
 * - Section 2.2: Available Widgets/Sections
 * - Section 2.3: Personalization
 *   - Adapts based on user preferences (player vs. editor focus)
 *   - Default landing page configurable in settings
 *
 * Uses Zustand with persist middleware for localStorage persistence
 */
export const useDashboardStore = create<DashboardState & DashboardActions>()(
  persist(
    (set, get) => ({
      // Initial state
      ...initialState,

      // Toggle widget visibility
      toggleWidget: (widgetId: string) => {
        set((state) => ({
          widgets: state.widgets.map((w) =>
            w.id === widgetId ? { ...w, enabled: !w.enabled } : w
          ),
          lastUpdated: Date.now(),
        }));
      },

      // Show a specific widget
      showWidget: (widgetId: string) => {
        set((state) => ({
          widgets: state.widgets.map((w) =>
            w.id === widgetId ? { ...w, enabled: true } : w
          ),
          lastUpdated: Date.now(),
        }));
      },

      // Hide a specific widget
      hideWidget: (widgetId: string) => {
        set((state) => ({
          widgets: state.widgets.map((w) =>
            w.id === widgetId ? { ...w, enabled: false } : w
          ),
          lastUpdated: Date.now(),
        }));
      },

      // Reorder widgets by swapping positions
      reorderWidgets: (draggedId: string, targetId: string) => {
        if (draggedId === targetId) return;

        set((state) => {
          const widgets = [...state.widgets];
          const draggedIndex = widgets.findIndex((w) => w.id === draggedId);
          const targetIndex = widgets.findIndex((w) => w.id === targetId);

          if (draggedIndex === -1 || targetIndex === -1) return state;

          // Swap orders
          const draggedOrder = widgets[draggedIndex].order;
          widgets[draggedIndex] = { ...widgets[draggedIndex], order: widgets[targetIndex].order };
          widgets[targetIndex] = { ...widgets[targetIndex], order: draggedOrder };

          return {
            widgets: widgets.sort((a, b) => a.order - b.order),
            lastUpdated: Date.now(),
          };
        });
      },

      // Move widget up in order
      moveWidgetUp: (widgetId: string) => {
        set((state) => {
          const sorted = [...state.widgets].sort((a, b) => a.order - b.order);
          const index = sorted.findIndex((w) => w.id === widgetId);
          if (index <= 0) return state;

          // Swap with previous widget
          const prevOrder = sorted[index - 1].order;
          sorted[index - 1] = { ...sorted[index - 1], order: sorted[index].order };
          sorted[index] = { ...sorted[index], order: prevOrder };

          return {
            widgets: sorted.sort((a, b) => a.order - b.order),
            lastUpdated: Date.now(),
          };
        });
      },

      // Move widget down in order
      moveWidgetDown: (widgetId: string) => {
        set((state) => {
          const sorted = [...state.widgets].sort((a, b) => a.order - b.order);
          const index = sorted.findIndex((w) => w.id === widgetId);
          if (index === -1 || index >= sorted.length - 1) return state;

          // Swap with next widget
          const nextOrder = sorted[index + 1].order;
          sorted[index + 1] = { ...sorted[index + 1], order: sorted[index].order };
          sorted[index] = { ...sorted[index], order: nextOrder };

          return {
            widgets: sorted.sort((a, b) => a.order - b.order),
            lastUpdated: Date.now(),
          };
        });
      },

      // Set user focus mode
      setUserFocus: (focus: UserFocusType) => {
        set({
          userFocus: focus,
          lastUpdated: Date.now(),
        });
      },

      // Apply focus preset - enables/disables widgets based on focus type
      applyFocusPreset: (focus: UserFocusType) => {
        const enabledIds = new Set(focusWidgetDefaults[focus]);

        set((state) => ({
          userFocus: focus,
          widgets: state.widgets.map((w) => ({
            ...w,
            enabled: enabledIds.has(w.id),
          })),
          lastUpdated: Date.now(),
        }));
      },

      // Set dashboard as landing page preference
      setDashboardAsLandingPage: (value: boolean) => {
        set({
          dashboardAsLandingPage: value,
          lastUpdated: Date.now(),
        });
      },

      // Set customizing mode
      setIsCustomizing: (isCustomizing: boolean) => {
        set({ isCustomizing });
      },

      // Set dragged widget
      setDraggedWidget: (widgetId: string | null) => {
        set({ draggedWidget: widgetId });
      },

      // Reset to default configuration
      resetToDefaults: () => {
        set({
          ...initialState,
          lastUpdated: Date.now(),
        });
      },

      // Get enabled widgets sorted by order
      getEnabledWidgets: () => {
        const state = get();
        return state.widgets
          .filter((w) => w.enabled)
          .sort((a, b) => a.order - b.order);
      },

      // Get a widget by ID
      getWidgetById: (widgetId: string) => {
        const state = get();
        return state.widgets.find((w) => w.id === widgetId);
      },
    }),
    {
      name: 'dashboard-store',
      // Merge stored state with defaults to handle new widgets added in updates
      merge: (persistedState, currentState) => {
        const persisted = persistedState as DashboardState;
        if (!persisted || !persisted.widgets) {
          return currentState;
        }

        // Merge widgets: keep stored preferences but add any new widgets from defaults
        const storedWidgetIds = new Set(persisted.widgets.map((w) => w.id));
        const mergedWidgets = [...persisted.widgets];

        // Add any missing widgets from defaults
        defaultWidgets.forEach((defaultWidget) => {
          if (!storedWidgetIds.has(defaultWidget.id)) {
            mergedWidgets.push({
              ...defaultWidget,
              order: mergedWidgets.length,
            });
          }
        });

        // Remove any widgets that no longer exist in defaults
        const validIds = new Set(defaultWidgets.map((w) => w.id));
        const validWidgets = mergedWidgets
          .filter((w) => validIds.has(w.id))
          .sort((a, b) => a.order - b.order);

        return {
          ...currentState,
          ...persisted,
          widgets: validWidgets,
        };
      },
    }
  )
);

/**
 * Selector hooks for common use cases
 */
export const useEnabledWidgets = () => useDashboardStore((state) => state.getEnabledWidgets());
export const useUserFocus = () => useDashboardStore((state) => state.userFocus);
export const useIsCustomizing = () => useDashboardStore((state) => state.isCustomizing);
export const useDraggedWidget = () => useDashboardStore((state) => state.draggedWidget);
