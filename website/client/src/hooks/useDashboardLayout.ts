import { useState, useCallback, useEffect } from 'react';

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

const STORAGE_KEY = 'dashboard-layout-preferences';

/**
 * Load widget layout preferences from localStorage
 * Includes migration logic for adding new widgets in future updates
 */
function loadLayoutPreferences(): DashboardWidget[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DashboardWidget[];
      // Merge with defaults to handle new widgets added in updates
      const storedIds = new Set(parsed.map(w => w.id));
      const mergedWidgets = [...parsed];

      // Add any missing widgets from defaults
      defaultWidgets.forEach(defaultWidget => {
        if (!storedIds.has(defaultWidget.id)) {
          mergedWidgets.push({
            ...defaultWidget,
            order: mergedWidgets.length,
          });
        }
      });

      // Remove any widgets that no longer exist in defaults
      const validIds = new Set(defaultWidgets.map(w => w.id));
      return mergedWidgets
        .filter(w => validIds.has(w.id))
        .sort((a, b) => a.order - b.order);
    }
  } catch (e) {
    console.warn('[useDashboardLayout] Failed to load from localStorage:', e);
  }
  return defaultWidgets;
}

/**
 * Save widget layout preferences to localStorage
 */
function saveLayoutPreferences(widgets: DashboardWidget[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch (e) {
    console.warn('[useDashboardLayout] Failed to save to localStorage:', e);
  }
}

/**
 * Return type for useDashboardLayout hook
 */
export interface UseDashboardLayoutReturn {
  // Widget state
  widgets: DashboardWidget[];
  enabledWidgets: DashboardWidget[];

  // Widget visibility actions
  toggleWidget: (widgetId: string) => void;
  showWidget: (widgetId: string) => void;
  hideWidget: (widgetId: string) => void;

  // Widget ordering actions
  reorderWidgets: (draggedId: string, targetId: string) => void;
  moveWidgetUp: (widgetId: string) => void;
  moveWidgetDown: (widgetId: string) => void;

  // Reset
  resetToDefaults: () => void;

  // Drag-and-drop state and handlers
  draggedWidget: string | null;
  setDraggedWidget: (widgetId: string | null) => void;
  handleDragStart: (e: React.DragEvent, widgetId: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, targetWidgetId: string) => void;
  handleDragEnd: () => void;

  // Customization mode state
  isCustomizing: boolean;
  setIsCustomizing: (isCustomizing: boolean) => void;
}

/**
 * Custom hook for managing Dashboard widget layout
 * Implements SPEC.md Section 2.1:
 * - Drag-and-drop widget arrangement
 * - Choose which sections appear
 * - Save layout per user (via localStorage)
 */
export function useDashboardLayout(): UseDashboardLayoutReturn {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadLayoutPreferences);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Persist to localStorage whenever widgets change
  useEffect(() => {
    saveLayoutPreferences(widgets);
  }, [widgets]);

  // Toggle widget visibility
  const toggleWidget = useCallback((widgetId: string) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w
      )
    );
  }, []);

  // Show a specific widget
  const showWidget = useCallback((widgetId: string) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w =>
        w.id === widgetId ? { ...w, enabled: true } : w
      )
    );
  }, []);

  // Hide a specific widget
  const hideWidget = useCallback((widgetId: string) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w =>
        w.id === widgetId ? { ...w, enabled: false } : w
      )
    );
  }, []);

  // Reorder widgets by swapping positions
  const reorderWidgets = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    setWidgets(prevWidgets => {
      const newWidgets = [...prevWidgets];
      const draggedIndex = newWidgets.findIndex(w => w.id === draggedId);
      const targetIndex = newWidgets.findIndex(w => w.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1) return prevWidgets;

      // Swap orders
      const draggedOrder = newWidgets[draggedIndex].order;
      newWidgets[draggedIndex].order = newWidgets[targetIndex].order;
      newWidgets[targetIndex].order = draggedOrder;

      return newWidgets.sort((a, b) => a.order - b.order);
    });
  }, []);

  // Move widget up in order
  const moveWidgetUp = useCallback((widgetId: string) => {
    setWidgets(prevWidgets => {
      const sorted = [...prevWidgets].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(w => w.id === widgetId);
      if (index <= 0) return prevWidgets;

      // Swap with previous widget
      const prevOrder = sorted[index - 1].order;
      sorted[index - 1].order = sorted[index].order;
      sorted[index].order = prevOrder;

      return sorted.sort((a, b) => a.order - b.order);
    });
  }, []);

  // Move widget down in order
  const moveWidgetDown = useCallback((widgetId: string) => {
    setWidgets(prevWidgets => {
      const sorted = [...prevWidgets].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex(w => w.id === widgetId);
      if (index === -1 || index >= sorted.length - 1) return prevWidgets;

      // Swap with next widget
      const nextOrder = sorted[index + 1].order;
      sorted[index + 1].order = sorted[index].order;
      sorted[index].order = nextOrder;

      return sorted.sort((a, b) => a.order - b.order);
    });
  }, []);

  // Reset to default configuration
  const resetToDefaults = useCallback(() => {
    setWidgets([...defaultWidgets]);
  }, []);

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
  const enabledWidgets = widgets
    .filter(w => w.enabled)
    .sort((a, b) => a.order - b.order);

  return {
    widgets,
    enabledWidgets,
    toggleWidget,
    showWidget,
    hideWidget,
    reorderWidgets,
    moveWidgetUp,
    moveWidgetDown,
    resetToDefaults,
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
