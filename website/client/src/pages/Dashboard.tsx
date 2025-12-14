import { useAuthStore } from '@/lib/store';
import { useDashboardLayout } from '@/hooks/useDashboardLayout';
import { WidgetContainer } from '@/components/WidgetContainer';
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

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const {
    widgets,
    enabledWidgets,
    toggleWidget,
    resetToDefaults,
    draggedWidget,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    isCustomizing,
    setIsCustomizing,
  } = useDashboardLayout();

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

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
            <p className="text-base-content/70 mt-1">
              Welcome to your personalized dashboard
            </p>
          </div>

          {/* Customize Button */}
          <button
            onClick={() => setIsCustomizing(!isCustomizing)}
            className={`btn btn-sm ${isCustomizing ? 'btn-primary' : 'btn-ghost'}`}
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
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
            {isCustomizing ? 'Done' : 'Customize'}
          </button>
        </div>

        {/* Customization Panel */}
        {isCustomizing && (
          <div className="mb-6 p-4 bg-base-100 rounded-xl shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Widget Visibility</h3>
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
              Drag and drop widgets to rearrange them. Your preferences are
              saved automatically.
            </p>
          </div>
        )}

        {/* Widgets Grid - Responsive layout for different screen sizes */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {enabledWidgets.map((widget) => (
            <WidgetContainer
              key={widget.id}
              widget={widget}
              isDragging={draggedWidget === widget.id}
              isDragEnabled={true}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            >
              {renderWidgetContent(widget.id)}
            </WidgetContainer>
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
            <button
              onClick={() => setIsCustomizing(true)}
              className="btn btn-primary"
            >
              Customize Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
