/**
 * Widget Store
 * Manages widget layout and configuration
 */

import { Store } from '../lib/store';

import type { WidgetConfig, WidgetLayout, WidgetSize, WidgetType } from '../components/widget/types';

interface WidgetState {
  layout: WidgetLayout;
  isCustomizing: boolean;
  draggedWidgetId: string | null;
}

const STORAGE_KEY = 'widgetStore';

const DEFAULT_WIDGETS: WidgetConfig[] = [
  {
    id: 'stats-sessions',
    type: 'stats',
    title: 'Active Sessions',
    size: 'sm',
    order: 0,
    visible: true,
    settings: { metric: 'sessions' },
  },
  {
    id: 'stats-repos',
    type: 'stats',
    title: 'Connected Repos',
    size: 'sm',
    order: 1,
    visible: true,
    settings: { metric: 'repos' },
  },
  {
    id: 'stats-tasks',
    type: 'stats',
    title: 'Tasks Completed',
    size: 'sm',
    order: 2,
    visible: true,
    settings: { metric: 'tasks' },
  },
  {
    id: 'session-activity',
    type: 'session-activity',
    title: 'Session Activity',
    size: 'md',
    order: 3,
    visible: true,
    settings: { maxItems: 6 },
  },
  {
    id: 'activity',
    type: 'activity',
    title: 'Recent Activity',
    size: 'lg',
    order: 4,
    visible: true,
  },
  {
    id: 'quick-actions',
    type: 'quick-actions',
    title: 'Quick Actions',
    size: 'md',
    order: 5,
    visible: true,
  },
  {
    id: 'favorites',
    type: 'favorites',
    title: 'Favorites',
    size: 'md',
    order: 6,
    visible: true,
    settings: { maxItems: 6 },
  },
  {
    id: 'chart-usage',
    type: 'chart',
    title: 'Usage Overview',
    size: 'lg',
    order: 7,
    visible: true,
    settings: { chartType: 'bar' },
  },
];

class WidgetStore extends Store<WidgetState> {
  constructor() {
    super({
      layout: {
        widgets: [...DEFAULT_WIDGETS],
        columns: 4,
      },
      isCustomizing: false,
      draggedWidgetId: null,
    });

    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.layout?.widgets) {
          this.setState({
            layout: {
              widgets: parsed.layout.widgets,
              columns: parsed.layout.columns || 4,
            },
          });
        }
      }
    } catch {
      // Ignore parse errors
    }

    this.subscribe((state) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          layout: state.layout,
        }));
      } catch {
        // Ignore storage errors
      }
    });
  }

  /**
   * Get visible widgets sorted by order
   */
  getVisibleWidgets(): WidgetConfig[] {
    const { widgets } = this.getState().layout;
    return widgets
      .filter(w => w.visible)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Get all widgets including hidden
   */
  getAllWidgets(): WidgetConfig[] {
    return [...this.getState().layout.widgets];
  }

  /**
   * Add a new widget
   */
  addWidget(config: Omit<WidgetConfig, 'order'>): void {
    const { widgets } = this.getState().layout;
    const maxOrder = Math.max(...widgets.map(w => w.order), -1);

    this.setState(state => ({
      layout: {
        ...state.layout,
        widgets: [
          ...state.layout.widgets,
          { ...config, order: maxOrder + 1 },
        ],
      },
    }));
  }

  /**
   * Remove a widget
   */
  removeWidget(id: string): void {
    this.setState(state => ({
      layout: {
        ...state.layout,
        widgets: state.layout.widgets.filter(w => w.id !== id),
      },
    }));
  }

  /**
   * Update widget configuration
   */
  updateWidget(id: string, updates: Partial<WidgetConfig>): void {
    this.setState(state => ({
      layout: {
        ...state.layout,
        widgets: state.layout.widgets.map(w =>
          w.id === id ? { ...w, ...updates } : w
        ),
      },
    }));
  }

  /**
   * Toggle widget visibility
   */
  toggleWidgetVisibility(id: string): void {
    const widget = this.getState().layout.widgets.find(w => w.id === id);
    if (widget) {
      this.updateWidget(id, { visible: !widget.visible });
    }
  }

  /**
   * Resize a widget
   */
  resizeWidget(id: string, size: WidgetSize): void {
    this.updateWidget(id, { size });
  }

  /**
   * Reorder widgets
   */
  reorderWidgets(fromIndex: number, toIndex: number): void {
    const widgets = [...this.getState().layout.widgets];
    const [moved] = widgets.splice(fromIndex, 1);
    widgets.splice(toIndex, 0, moved);

    // Update order property
    const reordered = widgets.map((w, i) => ({ ...w, order: i }));

    this.setState(state => ({
      layout: {
        ...state.layout,
        widgets: reordered,
      },
    }));
  }

  /**
   * Move widget by ID
   */
  moveWidget(widgetId: string, targetId: string): void {
    const widgets = this.getVisibleWidgets();
    const fromIndex = widgets.findIndex(w => w.id === widgetId);
    const toIndex = widgets.findIndex(w => w.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      this.reorderWidgets(fromIndex, toIndex);
    }
  }

  /**
   * Set column count
   */
  setColumns(columns: number): void {
    this.setState(state => ({
      layout: {
        ...state.layout,
        columns: Math.max(1, Math.min(6, columns)),
      },
    }));
  }

  /**
   * Enter customization mode
   */
  startCustomizing(): void {
    this.setState({ isCustomizing: true });
  }

  /**
   * Exit customization mode
   */
  stopCustomizing(): void {
    this.setState({ isCustomizing: false, draggedWidgetId: null });
  }

  /**
   * Set dragged widget
   */
  setDraggedWidget(id: string | null): void {
    this.setState({ draggedWidgetId: id });
  }

  /**
   * Reset to default layout
   */
  resetToDefault(): void {
    this.setState({
      layout: {
        widgets: [...DEFAULT_WIDGETS],
        columns: 4,
      },
    });
  }

  /**
   * Get available widget types for adding
   */
  getAvailableWidgetTypes(): { type: WidgetType; label: string; description: string }[] {
    return [
      { type: 'stats', label: 'Statistics', description: 'Display a key metric with optional trend' },
      { type: 'session-activity', label: 'Session Activity', description: 'View active and recent editor sessions' },
      { type: 'activity', label: 'Activity Feed', description: 'Show recent activity and events' },
      { type: 'quick-actions', label: 'Quick Actions', description: 'Shortcuts to common actions' },
      { type: 'favorites', label: 'Favorites', description: 'Quick access to your favorite games' },
      { type: 'chart', label: 'Chart', description: 'Visualize data with charts' },
      { type: 'custom', label: 'Custom', description: 'Create a custom widget' },
    ];
  }
}

export const widgetStore = new WidgetStore();
