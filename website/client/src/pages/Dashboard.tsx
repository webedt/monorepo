import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/lib/store';

// Widget configuration type
interface WidgetConfig {
  id: string;
  title: string;
  enabled: boolean;
  order: number;
}

// Default widget configuration
const defaultWidgets: WidgetConfig[] = [
  { id: 'recently-played', title: 'Recently Played', enabled: true, order: 0 },
  { id: 'editor-quick-access', title: 'Editor Quick Access', enabled: true, order: 1 },
  { id: 'store-highlights', title: 'Store Highlights', enabled: true, order: 2 },
  { id: 'library-favorites', title: 'Library Favorites', enabled: true, order: 3 },
  { id: 'community-activity', title: 'Community Activity', enabled: true, order: 4 },
  { id: 'session-activity', title: 'Session Activity', enabled: true, order: 5 },
];

// Widget Card Component
interface WidgetCardProps {
  widget: WidgetConfig;
  children: React.ReactNode;
  onDragStart?: (e: React.DragEvent, widgetId: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, widgetId: string) => void;
}

function WidgetCard({ widget, children, onDragStart, onDragOver, onDrop }: WidgetCardProps) {
  return (
    <div
      className="bg-base-100 rounded-xl shadow-lg overflow-hidden"
      draggable
      onDragStart={(e) => onDragStart?.(e, widget.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, widget.id)}
    >
      {/* Widget Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-base-200 border-b border-base-300 cursor-move">
        <h3 className="font-semibold text-base-content flex items-center gap-2">
          <svg className="w-4 h-4 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
          </svg>
          {widget.title}
        </h3>
      </div>
      {/* Widget Content */}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

// Recently Played Widget Content
function RecentlyPlayedWidget() {
  const recentlyPlayed = [
    { id: 1, title: 'Space Explorer', lastPlayed: '2 hours ago', thumbnail: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop' },
    { id: 2, title: 'Pixel Quest', lastPlayed: 'Yesterday', thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&h=60&fit=crop' },
    { id: 3, title: 'Racing Legends', lastPlayed: '3 days ago', thumbnail: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=100&h=60&fit=crop' },
  ];

  if (recentlyPlayed.length === 0) {
    return (
      <div className="text-center py-6 text-base-content/60">
        <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p>No recently played games</p>
        <Link to="/store" className="btn btn-primary btn-sm mt-3">Browse Store</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recentlyPlayed.map((game) => (
        <div key={game.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors cursor-pointer">
          <img src={game.thumbnail} alt={game.title} className="w-16 h-10 object-cover rounded" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{game.title}</p>
            <p className="text-xs text-base-content/60">{game.lastPlayed}</p>
          </div>
          <button className="btn btn-ghost btn-sm btn-circle">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      ))}
      <Link to="/library" className="btn btn-ghost btn-sm w-full">View All</Link>
    </div>
  );
}

// Editor Quick Access Widget Content
function EditorQuickAccessWidget() {
  const recentSessions = [
    { id: 1, name: 'My Game Project', lastEdited: '1 hour ago' },
    { id: 2, name: 'Test Scene', lastEdited: '3 hours ago' },
    { id: 3, name: 'Character Demo', lastEdited: 'Yesterday' },
  ];

  return (
    <div className="space-y-4">
      {/* Quick Start Options */}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/quick-setup/chat" className="btn btn-outline btn-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
          New Chat
        </Link>
        <Link to="/quick-setup/code" className="btn btn-outline btn-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          New Code
        </Link>
      </div>

      {/* Recent Sessions */}
      <div>
        <p className="text-xs font-semibold text-base-content/60 uppercase mb-2">Recent Sessions</p>
        <div className="space-y-2">
          {recentSessions.map((session) => (
            <Link
              key={session.id}
              to={`/session/${session.id}`}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-base-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z"/>
                </svg>
                <span className="text-sm font-medium">{session.name}</span>
              </div>
              <span className="text-xs text-base-content/50">{session.lastEdited}</span>
            </Link>
          ))}
        </div>
      </div>
      <Link to="/sessions" className="btn btn-ghost btn-sm w-full">View All Sessions</Link>
    </div>
  );
}

// Store Highlights Widget Content
function StoreHighlightsWidget() {
  const featuredItems = [
    { id: 1, title: 'Space Explorer', price: '$29.99', thumbnail: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop', isFeatured: true },
    { id: 4, title: 'Fantasy Realms', price: '$39.99', thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=100&h=60&fit=crop', isNew: true },
  ];

  return (
    <div className="space-y-3">
      {featuredItems.map((item) => (
        <Link key={item.id} to={`/item/${item.id}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors">
          <div className="relative">
            <img src={item.thumbnail} alt={item.title} className="w-20 h-12 object-cover rounded" />
            {item.isFeatured && (
              <span className="absolute -top-1 -right-1 badge badge-primary badge-xs">Featured</span>
            )}
            {item.isNew && (
              <span className="absolute -top-1 -right-1 badge badge-secondary badge-xs">New</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{item.title}</p>
            <p className="text-sm text-primary font-semibold">{item.price}</p>
          </div>
        </Link>
      ))}
      <Link to="/store" className="btn btn-ghost btn-sm w-full">Browse Store</Link>
    </div>
  );
}

// Library Favorites Widget Content
function LibraryFavoritesWidget() {
  const favorites = [
    { id: 1, title: 'Code Editor Pro', thumbnail: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=100&h=60&fit=crop' },
    { id: 3, title: 'Project Planner', thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=100&h=60&fit=crop' },
  ];

  if (favorites.length === 0) {
    return (
      <div className="text-center py-6 text-base-content/60">
        <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
        <p>No favorites yet</p>
        <Link to="/library" className="btn btn-primary btn-sm mt-3">Go to Library</Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {favorites.map((item) => (
        <Link
          key={item.id}
          to={`/library/${item.id}`}
          className="relative group rounded-lg overflow-hidden aspect-video"
        >
          <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-2">
            <p className="text-white text-xs font-medium truncate">{item.title}</p>
          </div>
          <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      ))}
    </div>
  );
}

// Community Activity Widget Content
function CommunityActivityWidget() {
  const activities = [
    { id: 1, user: 'JohnDoe', action: 'posted in #general', time: '5 min ago' },
    { id: 2, user: 'GameDev42', action: 'shared a new project', time: '15 min ago' },
    { id: 3, user: 'PixelArtist', action: 'replied to your comment', time: '1 hour ago' },
  ];

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary">{activity.user.charAt(0)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-medium">{activity.user}</span>
              <span className="text-base-content/70"> {activity.action}</span>
            </p>
            <p className="text-xs text-base-content/50">{activity.time}</p>
          </div>
        </div>
      ))}
      <Link to="/community" className="btn btn-ghost btn-sm w-full">View Community</Link>
    </div>
  );
}

// Session Activity Widget Content
function SessionActivityWidget() {
  const activeSessions = [
    { id: 1, name: 'Game Project', status: 'active', collaborators: 2 },
    { id: 2, name: 'Art Assets', status: 'idle', collaborators: 0 },
  ];

  return (
    <div className="space-y-3">
      {activeSessions.map((session) => (
        <Link
          key={session.id}
          to={`/session/${session.id}`}
          className="flex items-center justify-between p-3 rounded-lg bg-base-200 hover:bg-base-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${session.status === 'active' ? 'bg-success animate-pulse' : 'bg-base-content/30'}`} />
            <div>
              <p className="font-medium text-sm">{session.name}</p>
              <p className="text-xs text-base-content/60">
                {session.status === 'active' ? 'Active' : 'Idle'}
                {session.collaborators > 0 && ` • ${session.collaborators} collaborator${session.collaborators > 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          <svg className="w-4 h-4 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ))}
      <Link to="/sessions" className="btn btn-ghost btn-sm w-full">View All Sessions</Link>
    </div>
  );
}

// Widget content renderer
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
      return <div className="text-center py-4 text-base-content/60">Widget not found</div>;
  }
}

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const [widgets, setWidgets] = useState<WidgetConfig[]>(defaultWidgets);
  const [draggedWidget, setDraggedWidget] = useState<string | null>(null);
  const [isCustomizing, setIsCustomizing] = useState(false);

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, widgetId: string) => {
    setDraggedWidget(widgetId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Handle drag over
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  // Handle drop
  const handleDrop = (e: React.DragEvent, targetWidgetId: string) => {
    e.preventDefault();
    if (!draggedWidget || draggedWidget === targetWidgetId) {
      setDraggedWidget(null);
      return;
    }

    setWidgets((prevWidgets) => {
      const newWidgets = [...prevWidgets];
      const draggedIndex = newWidgets.findIndex((w) => w.id === draggedWidget);
      const targetIndex = newWidgets.findIndex((w) => w.id === targetWidgetId);

      if (draggedIndex === -1 || targetIndex === -1) return prevWidgets;

      // Swap orders
      const draggedOrder = newWidgets[draggedIndex].order;
      newWidgets[draggedIndex].order = newWidgets[targetIndex].order;
      newWidgets[targetIndex].order = draggedOrder;

      return newWidgets.sort((a, b) => a.order - b.order);
    });

    setDraggedWidget(null);
  };

  // Toggle widget visibility
  const toggleWidget = (widgetId: string) => {
    setWidgets((prevWidgets) =>
      prevWidgets.map((w) =>
        w.id === widgetId ? { ...w, enabled: !w.enabled } : w
      )
    );
  };

  // Get enabled widgets sorted by order
  const enabledWidgets = widgets
    .filter((w) => w.enabled)
    .sort((a, b) => a.order - b.order);

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-base-content">
              {getGreeting()}, {user?.displayName || user?.email?.split('@')[0] || 'User'}!
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
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            {isCustomizing ? 'Done' : 'Customize'}
          </button>
        </div>

        {/* Customization Panel */}
        {isCustomizing && (
          <div className="mb-6 p-4 bg-base-100 rounded-xl shadow-lg">
            <h3 className="font-semibold mb-3">Widget Visibility</h3>
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
              Drag and drop widgets to rearrange them
            </p>
          </div>
        )}

        {/* Widgets Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {enabledWidgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              {renderWidgetContent(widget.id)}
            </WidgetCard>
          ))}
        </div>

        {/* Empty State */}
        {enabledWidgets.length === 0 && (
          <div className="text-center py-16">
            <svg className="w-16 h-16 mx-auto mb-4 text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
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
        )}
      </div>
    </div>
  );
}
