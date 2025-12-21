import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { useDashboardStore } from '@/stores/dashboardStore';
import { DraggableWidget } from '@/components/DraggableWidget';
import { DashboardSettings } from '@/components/DashboardSettings';
import {
  RecentlyPlayedWidget,
  EditorQuickAccessWidget,
  StoreHighlightsWidget,
} from '@/components/dashboard';
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
function renderWidgetContent(widgetId: string) {
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
 * Dashboard page component
 * Implements SPEC.md Section 2 - Dashboard (Homepage):
 * - Customizable Widget System (Section 2.1)
 * - Available Widgets/Sections (Section 2.2)
 * - Personalization (Section 2.3)
 */
export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Use the centralized dashboard store for state management
  // Implements SPEC.md Section 2.1 - Save layout per user
  const widgets = useDashboardStore((state) => state.widgets);
  const userFocus = useDashboardStore((state) => state.userFocus);
  const dashboardAsLandingPage = useDashboardStore((state) => state.dashboardAsLandingPage);
  const isCustomizing = useDashboardStore((state) => state.isCustomizing);
  const draggedWidget = useDashboardStore((state) => state.draggedWidget);

  // Actions from the store
  const toggleWidget = useDashboardStore((state) => state.toggleWidget);
  const applyFocusPreset = useDashboardStore((state) => state.applyFocusPreset);
  const resetToDefaults = useDashboardStore((state) => state.resetToDefaults);
  const moveWidgetUp = useDashboardStore((state) => state.moveWidgetUp);
  const moveWidgetDown = useDashboardStore((state) => state.moveWidgetDown);
  const setDashboardAsLandingPage = useDashboardStore((state) => state.setDashboardAsLandingPage);
  const setIsCustomizing = useDashboardStore((state) => state.setIsCustomizing);
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

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Get focus mode indicator
  const getFocusModeLabel = () => {
    switch (userFocus) {
      case 'player':
        return { label: 'Player Mode', icon: '🎮' };
      case 'editor':
        return { label: 'Editor Mode', icon: '💻' };
      default:
        return { label: 'Balanced', icon: '⚖️' };
    }
  };

  const focusMode = getFocusModeLabel();

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-base-content">
              {getGreeting()},{' '}
              {user?.displayName || user?.email?.split('@')[0] || 'User'}!
            </h1>
            <p className="text-base-content/70 mt-1 flex items-center gap-2">
              Welcome to your personalized dashboard
              <span
                className="badge badge-sm badge-ghost gap-1"
                title={`Current mode: ${focusMode.label}`}
              >
                <span>{focusMode.icon}</span>
                <span className="hidden sm:inline">{focusMode.label}</span>
              </span>
            </p>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-2">
            {/* Customize Toggle Button */}
            <button
              onClick={() => setIsCustomizing(!isCustomizing)}
              className={`btn btn-sm ${isCustomizing ? 'btn-primary' : 'btn-ghost'}`}
              title={isCustomizing ? 'Exit customization mode' : 'Customize widget layout'}
            >
              <svg
                className="w-4 h-4 mr-2"
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
              {isCustomizing ? 'Done' : 'Customize'}
            </button>

            {/* Settings Button */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="btn btn-sm btn-ghost"
              title="Dashboard settings"
            >
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
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Customization Panel - Widget Visibility Toggles */}
        {isCustomizing && (
          <div className="mb-6 p-4 bg-base-100 rounded-xl shadow-lg animate-in slide-in-from-top-2 duration-200">
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
        )}

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

        {/* Empty State */}
        {enabledWidgets.length === 0 && (
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
              Enable widgets from the customization panel to see your
              personalized content
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={() => setIsCustomizing(true)}
                className="btn btn-primary"
              >
                Customize Dashboard
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="btn btn-ghost"
              >
                Open Settings
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Dashboard Settings Modal */}
      <DashboardSettings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        widgets={widgets}
        userFocus={userFocus}
        dashboardAsLandingPage={dashboardAsLandingPage}
        onToggleWidget={toggleWidget}
        onApplyFocusPreset={applyFocusPreset}
        onSetDashboardAsLandingPage={setDashboardAsLandingPage}
        onResetToDefaults={resetToDefaults}
        onMoveWidgetUp={moveWidgetUp}
        onMoveWidgetDown={moveWidgetDown}
      />
    </div>
  );
}
