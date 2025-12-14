import { type ReactNode } from 'react';
import { DraggableWidget } from '@/components/DraggableWidget';
import { useDashboardStore } from '@/stores/dashboardStore';
import {
  RecentlyPlayedWidget,
  EditorQuickAccessWidget,
  StoreHighlightsWidget,
} from './index';
import {
  LibraryFavoritesWidget,
  CommunityActivityWidget,
  SessionActivityWidget,
} from '@/components/widgets';

/**
 * Widget content renderer based on widget ID
 * Maps widget IDs to their corresponding React components
 * Implements SPEC.md Section 2.2 - Available Widgets/Sections
 */
function renderWidgetContent(widgetId: string): ReactNode {
  switch (widgetId) {
    case 'recently-played':
      return <RecentlyPlayedWidget />;
    case 'editor-quick-access':
      return <EditorQuickAccessWidget />;
    case 'store-highlights':
      return <StoreHighlightsWidget />;
    case 'library-favorites':
      return <LibraryFavoritesWidget />;
    case 'community-activity':
      return <CommunityActivityWidget />;
    case 'session-activity':
      return <SessionActivityWidget />;
    default:
      return (
        <div className="text-center py-4 text-base-content/60">
          Widget not found
        </div>
      );
  }
}

/**
 * Props for DashboardLayout component
 */
interface DashboardLayoutProps {
  /** Optional children to render before widgets */
  header?: ReactNode;
  /** Optional children to render after widgets */
  footer?: ReactNode;
  /** Optional additional class names */
  className?: string;
}

/**
 * DashboardLayout Component
 *
 * A responsive grid layout for dashboard widgets with drag-and-drop support.
 * Renders enabled widgets in a 1-3 column responsive grid.
 *
 * Implements SPEC.md Section 2.1 - Layout:
 * - Customizable Widget System
 * - Drag-and-drop widget arrangement
 * - Choose which sections appear
 * - Save layout per user
 *
 * Features:
 * - Responsive grid (1 column on mobile, 2 on tablet, 3 on desktop)
 * - Drag-and-drop reordering with visual feedback
 * - Touch support for mobile devices
 * - Widget visibility toggling
 * - Customization mode with additional controls
 */
export function DashboardLayout({ header, footer, className = '' }: DashboardLayoutProps) {
  // Get state and actions from the dashboard store
  const widgets = useDashboardStore((state) => state.widgets);
  const draggedWidget = useDashboardStore((state) => state.draggedWidget);
  const isCustomizing = useDashboardStore((state) => state.isCustomizing);

  const toggleWidget = useDashboardStore((state) => state.toggleWidget);
  const moveWidgetUp = useDashboardStore((state) => state.moveWidgetUp);
  const moveWidgetDown = useDashboardStore((state) => state.moveWidgetDown);
  const setDraggedWidget = useDashboardStore((state) => state.setDraggedWidget);
  const reorderWidgets = useDashboardStore((state) => state.reorderWidgets);

  // Get enabled widgets sorted by order
  const enabledWidgets = widgets
    .filter((w) => w.enabled)
    .sort((a, b) => a.order - b.order);

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, widgetId: string) => {
    setDraggedWidget(widgetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widgetId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetWidgetId: string) => {
    e.preventDefault();
    if (draggedWidget && draggedWidget !== targetWidgetId) {
      reorderWidgets(draggedWidget, targetWidgetId);
    }
    setDraggedWidget(null);
  };

  const handleDragEnd = () => {
    setDraggedWidget(null);
  };

  // Empty state when no widgets are enabled
  if (enabledWidgets.length === 0) {
    return (
      <div className={className}>
        {header}
        <EmptyState />
        {footer}
      </div>
    );
  }

  return (
    <div className={className}>
      {header}

      {/* Widgets Grid - Responsive layout for different screen sizes */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {enabledWidgets.map((widget, index) => (
          <DraggableWidget
            key={widget.id}
            widget={widget}
            isDragging={draggedWidget === widget.id}
            isDragEnabled={true}
            isCustomizing={isCustomizing}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onToggleVisibility={toggleWidget}
            onMoveUp={moveWidgetUp}
            onMoveDown={moveWidgetDown}
            isFirst={index === 0}
            isLast={index === enabledWidgets.length - 1}
          >
            {renderWidgetContent(widget.id)}
          </DraggableWidget>
        ))}
      </div>

      {footer}
    </div>
  );
}

/**
 * Empty state component shown when no widgets are enabled
 */
function EmptyState() {
  const setIsCustomizing = useDashboardStore((state) => state.setIsCustomizing);

  return (
    <div className="text-center py-16">
      <svg
        className="w-16 h-16 mx-auto mb-4 text-base-content/30"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
        />
      </svg>
      <h3 className="text-lg font-semibold mb-2">No widgets enabled</h3>
      <p className="text-base-content/60 mb-4">
        Enable widgets from the customization panel to see your personalized content
      </p>
      <button
        onClick={() => setIsCustomizing(true)}
        className="btn btn-primary"
      >
        Customize Dashboard
      </button>
    </div>
  );
}

/**
 * Widget customization panel component
 * Shows toggles for all available widgets
 */
export function WidgetCustomizationPanel() {
  const widgets = useDashboardStore((state) => state.widgets);
  const toggleWidget = useDashboardStore((state) => state.toggleWidget);
  const resetToDefaults = useDashboardStore((state) => state.resetToDefaults);

  return (
    <div className="p-4 bg-base-100 rounded-xl shadow-lg animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          Widget Visibility
        </h3>
        <button
          onClick={resetToDefaults}
          className="btn btn-ghost btn-xs"
          title="Reset to default layout"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Reset
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {widgets.map((widget) => (
          <label
            key={widget.id}
            className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
              widget.enabled ? 'bg-primary/10' : 'bg-base-200'
            }`}
          >
            <input
              type="checkbox"
              className="checkbox checkbox-primary checkbox-sm"
              checked={widget.enabled}
              onChange={() => toggleWidget(widget.id)}
            />
            <span className="text-sm">{widget.title}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-base-content/50 mt-3">
        Drag and drop widgets to rearrange them. Click the settings button for more options.
      </p>
    </div>
  );
}

export default DashboardLayout;
