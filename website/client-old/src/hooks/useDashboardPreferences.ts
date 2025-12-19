import { useState, useCallback, useEffect } from 'react';
import type { DashboardWidget } from './useDashboardLayout';
import { defaultWidgets } from './useDashboardLayout';

/**
 * User focus type for dashboard personalization
 * Implements SPEC.md Section 2.3 - Personalization
 * - player: Focus on games, recently played, library favorites
 * - editor: Focus on editor sessions, quick access, session activity
 */
export type UserFocusType = 'player' | 'editor' | 'balanced';

/**
 * Dashboard preferences interface
 * Stores all user customization options for the dashboard
 */
export interface DashboardPreferences {
  /** Current user focus (player vs editor) */
  userFocus: UserFocusType;
  /** Widget configuration (visibility and order) */
  widgets: DashboardWidget[];
  /** Whether the dashboard should be the default landing page */
  dashboardAsLandingPage: boolean;
  /** Last customization timestamp */
  lastUpdated: number;
}

/**
 * Default widget configurations based on user focus
 * Player-focused: Emphasizes games and library
 * Editor-focused: Emphasizes sessions and quick access
 */
const focusWidgetDefaults: Record<UserFocusType, string[]> = {
  player: ['recently-played', 'library-favorites', 'store-highlights', 'community-activity'],
  editor: ['editor-quick-access', 'session-activity', 'store-highlights', 'community-activity'],
  balanced: ['recently-played', 'editor-quick-access', 'store-highlights', 'library-favorites', 'community-activity', 'session-activity'],
};

const STORAGE_KEY = 'dashboard-preferences';

/**
 * Load dashboard preferences from localStorage
 */
function loadPreferences(): DashboardPreferences {
  const defaults: DashboardPreferences = {
    userFocus: 'balanced',
    widgets: defaultWidgets,
    dashboardAsLandingPage: false,
    lastUpdated: Date.now(),
  };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DashboardPreferences;

      // Merge with defaults to handle new widgets added in updates
      const storedWidgetIds = new Set(parsed.widgets.map(w => w.id));
      const mergedWidgets = [...parsed.widgets];

      // Add any missing widgets from defaults
      defaultWidgets.forEach(defaultWidget => {
        if (!storedWidgetIds.has(defaultWidget.id)) {
          mergedWidgets.push({
            ...defaultWidget,
            order: mergedWidgets.length,
          });
        }
      });

      // Remove any widgets that no longer exist in defaults
      const validIds = new Set(defaultWidgets.map(w => w.id));
      const validWidgets = mergedWidgets
        .filter(w => validIds.has(w.id))
        .sort((a, b) => a.order - b.order);

      return {
        ...defaults,
        ...parsed,
        widgets: validWidgets,
      };
    }
  } catch (e) {
    console.warn('[useDashboardPreferences] Failed to load from localStorage:', e);
  }

  return defaults;
}

/**
 * Save dashboard preferences to localStorage
 */
function savePreferences(prefs: DashboardPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...prefs,
      lastUpdated: Date.now(),
    }));
  } catch (e) {
    console.warn('[useDashboardPreferences] Failed to save to localStorage:', e);
  }
}

/**
 * Return type for useDashboardPreferences hook
 */
export interface UseDashboardPreferencesReturn {
  // Preferences state
  preferences: DashboardPreferences;

  // User focus
  userFocus: UserFocusType;
  setUserFocus: (focus: UserFocusType) => void;

  // Widget management
  widgets: DashboardWidget[];
  enabledWidgets: DashboardWidget[];
  toggleWidget: (widgetId: string) => void;
  showWidget: (widgetId: string) => void;
  hideWidget: (widgetId: string) => void;
  reorderWidgets: (draggedId: string, targetId: string) => void;
  moveWidgetUp: (widgetId: string) => void;
  moveWidgetDown: (widgetId: string) => void;

  // Bulk operations
  applyFocusPreset: (focus: UserFocusType) => void;
  resetToDefaults: () => void;

  // Landing page preference
  dashboardAsLandingPage: boolean;
  setDashboardAsLandingPage: (value: boolean) => void;

  // Drag-and-drop state
  draggedWidget: string | null;
  setDraggedWidget: (widgetId: string | null) => void;
  handleDragStart: (e: React.DragEvent, widgetId: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, targetWidgetId: string) => void;
  handleDragEnd: () => void;

  // Customization mode
  isCustomizing: boolean;
  setIsCustomizing: (isCustomizing: boolean) => void;
}

/**
 * Custom hook for managing Dashboard preferences
 * Implements SPEC.md Section 2.3 - Personalization:
 * - Adapts based on user preferences (player vs. editor focus)
 * - Default landing page configurable in settings
 *
 * Also implements SPEC.md Section 2.1:
 * - Drag-and-drop widget arrangement
 * - Choose which sections appear
 * - Save layout per user (via localStorage)
 */
export function useDashboardPreferences(): UseDashboardPreferencesReturn {
  const [preferences, setPreferences] = useState<DashboardPreferences>(loadPreferences);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Persist preferences whenever they change
  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // Update preferences helper
  const updatePreferences = useCallback((updater: (prev: DashboardPreferences) => DashboardPreferences) => {
    setPreferences(prev => {
      const next = updater(prev);
      return next;
    });
  }, []);

  // Set user focus
  const setUserFocus = useCallback((focus: UserFocusType) => {
    updatePreferences(prev => ({
      ...prev,
      userFocus: focus,
    }));
  }, [updatePreferences]);

  // Apply focus preset - enables/disables widgets based on focus type
  const applyFocusPreset = useCallback((focus: UserFocusType) => {
    const enabledIds = new Set(focusWidgetDefaults[focus]);

    updatePreferences(prev => ({
      ...prev,
      userFocus: focus,
      widgets: prev.widgets.map(w => ({
        ...w,
        enabled: enabledIds.has(w.id),
      })),
    }));
  }, [updatePreferences]);

  // Toggle widget visibility
  const toggleWidget = useCallback((widgetId: string) => {
    updatePreferences(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w
      ),
    }));
  }, [updatePreferences]);

  // Show a specific widget
  const showWidget = useCallback((widgetId: string) => {
    updatePreferences(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId ? { ...w, enabled: true } : w
      ),
    }));
  }, [updatePreferences]);

  // Hide a specific widget
  const hideWidget = useCallback((widgetId: string) => {
    updatePreferences(prev => ({
      ...prev,
      widgets: prev.widgets.map(w =>
        w.id === widgetId ? { ...w, enabled: false } : w
      ),
    }));
  }, [updatePreferences]);

  // Reorder widgets by swapping positions
  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    updatePreferences(prev => {
      const widgets = [...prev.widgets];
      const draggedIndex = widgets.findIndex(w => w.id === draggedId);
      const targetIndex = widgets.findIndex(w => w.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1) return prev;

      // Swap orders
      const draggedOrder = widgets[draggedIndex].order;
      widgets[draggedIndex].order = widgets[targetIndex].order;
      widgets[targetIndex].order = draggedOrder;

      return {
        ...prev,
        widgets: widgets.sort((a, b) => a.order - b.order),
      };
    });
  }, [updatePreferences]);

  // Move widget up in order
  const moveWidgetUp = useCallback((widgetId: string) => {
    updatePreferences(prev => {
      const sorted = [...prev.widgets].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(w => w.id === widgetId);
      if (index <= 0) return prev;

      const prevOrder = sorted[index - 1].order;
      sorted[index - 1].order = sorted[index].order;
      sorted[index].order = prevOrder;

      return {
        ...prev,
        widgets: sorted.sort((a, b) => a.order - b.order),
      };
    });
  }, [updatePreferences]);

  // Move widget down in order
  const moveWidgetDown = useCallback((widgetId: string) => {
    updatePreferences(prev => {
      const sorted = [...prev.widgets].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(w => w.id === widgetId);
      if (index === -1 || index >= sorted.length - 1) return prev;

      const nextOrder = sorted[index + 1].order;
      sorted[index + 1].order = sorted[index].order;
      sorted[index].order = nextOrder;

      return {
        ...prev,
        widgets: sorted.sort((a, b) => a.order - b.order),
      };
    });
  }, [updatePreferences]);

  // Reset to default configuration
  const resetToDefaults = useCallback(() => {
    setPreferences({
      userFocus: 'balanced',
      widgets: [...defaultWidgets],
      dashboardAsLandingPage: false,
      lastUpdated: Date.now(),
    });
  }, []);

  // Set dashboard as landing page preference
  const setDashboardAsLandingPage = useCallback((value: boolean) => {
    updatePreferences(prev => ({
      ...prev,
      dashboardAsLandingPage: value,
    }));
  }, [updatePreferences]);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, widgetId: string) => {
    setDraggedWidget(widgetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widgetId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetWidgetId: string) => {
    e.preventDefault();
    if (draggedWidget && draggedWidget !== targetWidgetId) {
      reorderWidgets(draggedWidget, targetWidgetId);
    }
    setDraggedWidget(null);
  }, [draggedWidget, reorderWidgets]);

  const handleDragEnd = useCallback(() => {
    setDraggedWidget(null);
  }, []);

  // Get enabled widgets sorted by order
  const enabledWidgets = preferences.widgets
    .filter(w => w.enabled)
    .sort((a, b) => a.order - b.order);

  return {
    preferences,
    userFocus: preferences.userFocus,
    setUserFocus,
    widgets: preferences.widgets,
    enabledWidgets,
    toggleWidget,
    showWidget,
    hideWidget,
    reorderWidgets,
    moveWidgetUp,
    moveWidgetDown,
    applyFocusPreset,
    resetToDefaults,
    dashboardAsLandingPage: preferences.dashboardAsLandingPage,
    setDashboardAsLandingPage,
    draggedWidget,
    setDraggedWidget,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    isCustomizing,
    setIsCustomizing,
  };
}
