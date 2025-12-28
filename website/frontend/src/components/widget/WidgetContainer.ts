/**
 * Widget Container
 * Manages widget grid layout and drag-and-drop reordering
 */

import { Component } from '../base';
import { Widget } from './Widget';
import { StatsWidget } from './StatsWidget';
import { ActivityWidget } from './ActivityWidget';
import { QuickActionsWidget } from './QuickActionsWidget';
import { ChartWidget } from './ChartWidget';
import { FavoritesWidget } from './FavoritesWidget';
import { SessionActivityWidget } from './SessionActivityWidget';
import { widgetStore } from '../../stores/widgetStore';

import type { ComponentOptions } from '../base';
import type { WidgetConfig, WidgetSize } from './types';

export interface WidgetContainerOptions extends ComponentOptions {
  onWidgetRemove?: (id: string) => void;
  onWidgetResize?: (id: string, size: WidgetSize) => void;
  onWidgetSettings?: (id: string) => void;
}

export class WidgetContainer extends Component<HTMLDivElement> {
  private widgets: Map<string, Widget> = new Map();
  private options: WidgetContainerOptions;
  private unsubscribe: (() => void) | null = null;
  private draggedElement: HTMLElement | null = null;
  private dragPlaceholder: HTMLElement | null = null;

  constructor(options: WidgetContainerOptions = {}) {
    super('div', {
      className: 'widget-container',
      ...options,
    });

    this.options = options;
    this.updateGridColumns();
  }

  protected onMount(): void {
    this.renderWidgets();
    this.setupDragAndDrop();

    // Subscribe to store changes
    this.unsubscribe = widgetStore.subscribe(() => {
      this.updateGridColumns();
      this.renderWidgets();
    });
  }

  protected onUnmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;

    for (const widget of this.widgets.values()) {
      widget.unmount();
    }
    this.widgets.clear();
  }

  private updateGridColumns(): void {
    const { columns } = widgetStore.getState().layout;
    this.element.style.setProperty('--widget-columns', String(columns));
  }

  private renderWidgets(): void {
    const visibleWidgets = widgetStore.getVisibleWidgets();
    const currentIds = new Set(visibleWidgets.map(w => w.id));

    // Remove widgets that are no longer visible
    for (const [id, widget] of this.widgets) {
      if (!currentIds.has(id)) {
        widget.unmount();
        this.widgets.delete(id);
      }
    }

    // Add or update widgets
    for (const config of visibleWidgets) {
      if (!this.widgets.has(config.id)) {
        const widget = this.createWidget(config);
        if (widget) {
          this.widgets.set(config.id, widget);
          widget.mount(this.element);
        }
      }
    }

    // Reorder DOM elements to match store order
    for (const config of visibleWidgets) {
      const widget = this.widgets.get(config.id);
      if (widget) {
        this.element.appendChild(widget.getElement());
      }
    }
  }

  private createWidget(config: WidgetConfig): Widget | null {
    const baseOptions = {
      config,
      draggable: widgetStore.getState().isCustomizing,
      onRemove: (id: string) => {
        widgetStore.removeWidget(id);
        this.options.onWidgetRemove?.(id);
      },
      onResize: (id: string, size: WidgetSize) => {
        widgetStore.resizeWidget(id, size);
        this.options.onWidgetResize?.(id, size);
      },
      onSettings: (id: string) => {
        this.options.onWidgetSettings?.(id);
      },
    };

    switch (config.type) {
      case 'stats':
        return new StatsWidget({
          ...baseOptions,
          data: this.getStatsData(config),
        });

      case 'activity':
        return new ActivityWidget({
          ...baseOptions,
          items: this.getActivityData(),
        });

      case 'quick-actions':
        return new QuickActionsWidget({
          ...baseOptions,
          actions: this.getQuickActions(),
        });

      case 'chart':
        return new ChartWidget({
          ...baseOptions,
          chartType: (config.settings?.chartType as 'bar' | 'line' | 'donut') || 'bar',
          data: this.getChartData(),
        });

      case 'favorites':
        return new FavoritesWidget({
          ...baseOptions,
          maxItems: (config.settings?.maxItems as number) || 6,
        });

      case 'session-activity':
        return new SessionActivityWidget({
          ...baseOptions,
          maxItems: (config.settings?.maxItems as number) || 8,
        });

      default:
        return null;
    }
  }

  private getStatsData(config: WidgetConfig) {
    const metric = config.settings?.metric as string;

    const statsMap: Record<string, { value: string | number; change?: { value: number; type: 'increase' | 'decrease' | 'neutral' } }> = {
      sessions: { value: 12, change: { value: 15, type: 'increase' } },
      repos: { value: 5, change: { value: 0, type: 'neutral' } },
      tasks: { value: 47, change: { value: 23, type: 'increase' } },
    };

    const data = statsMap[metric] || { value: '--' };

    return {
      label: config.title,
      ...data,
    };
  }

  private getActivityData() {
    return [
      {
        id: '1',
        title: 'Session completed',
        description: 'AI finished implementing the feature',
        timestamp: new Date(Date.now() - 1000 * 60 * 5),
        type: 'success' as const,
      },
      {
        id: '2',
        title: 'New commit pushed',
        description: 'Branch: feature/widget-system',
        timestamp: new Date(Date.now() - 1000 * 60 * 30),
        type: 'info' as const,
      },
      {
        id: '3',
        title: 'Build warning',
        description: 'TypeScript found unused variables',
        timestamp: new Date(Date.now() - 1000 * 60 * 60),
        type: 'warning' as const,
      },
    ];
  }

  private getQuickActions() {
    return [
      {
        id: 'new-session',
        label: 'New Session',
        icon: 'plus',
        onClick: () => window.location.hash = '/agents',
        variant: 'primary' as const,
      },
      {
        id: 'view-repos',
        label: 'Repositories',
        icon: 'folder',
        onClick: () => window.location.hash = '/settings',
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: 'settings',
        onClick: () => window.location.hash = '/settings',
      },
    ];
  }

  private getChartData() {
    return [
      { label: 'Mon', value: 12 },
      { label: 'Tue', value: 19 },
      { label: 'Wed', value: 8 },
      { label: 'Thu', value: 15 },
      { label: 'Fri', value: 22 },
      { label: 'Sat', value: 5 },
      { label: 'Sun', value: 11 },
    ];
  }

  private setupDragAndDrop(): void {
    this.on('dragstart', (e) => {
      const target = (e.target as HTMLElement).closest('.widget') as HTMLElement;
      if (!target || !widgetStore.getState().isCustomizing) return;

      this.draggedElement = target;
      target.classList.add('widget--dragging');

      widgetStore.setDraggedWidget(target.dataset.widgetId || null);

      // Create placeholder
      this.dragPlaceholder = document.createElement('div');
      this.dragPlaceholder.className = 'widget-placeholder';
      this.dragPlaceholder.style.height = `${target.offsetHeight}px`;

      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', target.dataset.widgetId || '');
      }
    });

    this.on('dragend', () => {
      if (this.draggedElement) {
        this.draggedElement.classList.remove('widget--dragging');
        this.draggedElement = null;
      }

      if (this.dragPlaceholder) {
        this.dragPlaceholder.remove();
        this.dragPlaceholder = null;
      }

      widgetStore.setDraggedWidget(null);
    });

    this.on('dragover', (e) => {
      e.preventDefault();
      if (!this.draggedElement || !widgetStore.getState().isCustomizing) return;

      const target = (e.target as HTMLElement).closest('.widget') as HTMLElement;
      if (!target || target === this.draggedElement) return;

      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if ((e as DragEvent).clientY < midY) {
        target.before(this.dragPlaceholder!);
      } else {
        target.after(this.dragPlaceholder!);
      }
    });

    this.on('drop', (e) => {
      e.preventDefault();
      if (!this.draggedElement || !this.dragPlaceholder) return;

      const sourceId = this.draggedElement.dataset.widgetId;
      const targetElement = this.dragPlaceholder.nextElementSibling as HTMLElement;
      const targetId = targetElement?.dataset?.widgetId;

      if (sourceId && targetId && sourceId !== targetId) {
        widgetStore.moveWidget(sourceId, targetId);
      } else if (sourceId && !targetElement) {
        // Dropped at the end
        const widgets = widgetStore.getVisibleWidgets();
        const lastWidget = widgets[widgets.length - 1];
        if (lastWidget && lastWidget.id !== sourceId) {
          widgetStore.moveWidget(sourceId, lastWidget.id);
        }
      }
    });
  }

  /**
   * Get a widget by ID
   */
  getWidget(id: string): Widget | undefined {
    return this.widgets.get(id);
  }

  /**
   * Get all widgets
   */
  getAllWidgets(): Widget[] {
    return Array.from(this.widgets.values());
  }

  /**
   * Refresh widget data
   */
  refresh(): void {
    for (const widget of this.widgets.values()) {
      widget.renderContent();
    }
  }

  /**
   * Enter customization mode
   */
  enterCustomizationMode(): void {
    this.addClass('widget-container--customizing');
    for (const widget of this.widgets.values()) {
      widget.setAttribute('draggable', 'true');
      widget.addClass('widget--draggable');
    }
  }

  /**
   * Exit customization mode
   */
  exitCustomizationMode(): void {
    this.removeClass('widget-container--customizing');
    for (const widget of this.widgets.values()) {
      widget.setAttribute('draggable', 'false');
      widget.removeClass('widget--draggable');
    }
  }
}
