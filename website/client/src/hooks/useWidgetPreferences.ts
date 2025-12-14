import { useState, useCallback, useEffect } from 'react';

// Widget configuration type
export interface WidgetConfig {
  id: string;
  title: string;
  enabled: boolean;
  order: number;
}

// Default widget configuration based on SPEC.md Section 2.2
export const defaultWidgets: WidgetConfig[] = [
  { id: 'recently-played', title: 'Recently Played', enabled: true, order: 0 },
  { id: 'editor-quick-access', title: 'Editor Quick Access', enabled: true, order: 1 },
  { id: 'store-highlights', title: 'Store Highlights', enabled: true, order: 2 },
  { id: 'library-favorites', title: 'Library Favorites', enabled: true, order: 3 },
  { id: 'community-activity', title: 'Community Activity', enabled: true, order: 4 },
  { id: 'session-activity', title: 'Session Activity', enabled: true, order: 5 },
];

const STORAGE_KEY = 'dashboard-widget-preferences';

// Load widget preferences from localStorage
function loadPreferences(): WidgetConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as WidgetConfig[];
      // Validate that all required widgets exist and merge with defaults
      // This ensures new widgets added in updates are included
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
    console.warn('[useWidgetPreferences] Failed to load from localStorage:', e);
  }
  return defaultWidgets;
}

// Save widget preferences to localStorage
function savePreferences(widgets: WidgetConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  } catch (e) {
    console.warn('[useWidgetPreferences] Failed to save to localStorage:', e);
  }
}

export interface UseWidgetPreferencesReturn {
  // Widget state
  widgets: WidgetConfig[];
  enabledWidgets: WidgetConfig[];

  // Widget actions
  toggleWidget: (widgetId: string) => void;
  reorderWidgets: (draggedId: string, targetId: string) => void;
  resetToDefaults: () => void;

  // Drag state
  draggedWidget: string | null;
  setDraggedWidget: (widgetId: string | null) => void;
  handleDragStart: (e: React.DragEvent, widgetId: string) => void;
  handleDragOver: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, targetWidgetId: string) => void;

  // Customization state
  isCustomizing: boolean;
  setIsCustomizing: (isCustomizing: boolean) => void;
}

export function useWidgetPreferences(): UseWidgetPreferencesReturn {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadPreferences);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Save to localStorage whenever widgets change
  useEffect(() => {
    savePreferences(widgets);
  }, [widgets]);

  // Toggle widget visibility
  const toggleWidget = useCallback((widgetId: string) => {
    setWidgets(prevWidgets =>
      prevWidgets.map(w =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w
      )
    );
  }, []);

  // Reorder widgets by swapping orders
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

  // Reset to default configuration
  const resetToDefaults = useCallback(() => {
    setWidgets(defaultWidgets);
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.DragEvent, widgetId: string) => {
    setDraggedWidget(widgetId);
    e.dataTransfer.effectAllowed = 'move';
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

  // Get enabled widgets sorted by order
  const enabledWidgets = widgets
    .filter(w => w.enabled)
    .sort((a, b) => a.order - b.order);

  return {
    widgets,
    enabledWidgets,
    toggleWidget,
    reorderWidgets,
    resetToDefaults,
    draggedWidget,
    setDraggedWidget,
    handleDragStart,
    handleDragOver,
    handleDrop,
    isCustomizing,
    setIsCustomizing,
  };
}
