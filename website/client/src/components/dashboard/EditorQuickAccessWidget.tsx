import { Link } from 'react-router-dom';

/**
 * Mock data for recent editor sessions
 * In production, this would come from an API call to /api/sessions
 */
const mockRecentSessions = [
  { id: 1, name: 'My Game Project', lastEdited: '1 hour ago', branch: 'main' },
  { id: 2, name: 'Test Scene', lastEdited: '3 hours ago', branch: 'feature/ui' },
  { id: 3, name: 'Character Demo', lastEdited: 'Yesterday', branch: 'dev' },
];

/**
 * Quick start options for creating new content
 */
const quickStartOptions = [
  {
    id: 'chat',
    label: 'New Chat',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
      </svg>
    ),
    href: '/quick-setup/chat',
  },
  {
    id: 'code',
    label: 'New Code',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
        />
      </svg>
    ),
    href: '/quick-setup/code',
  },
  {
    id: 'image',
    label: 'New Image',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
    href: '/quick-setup/images',
  },
  {
    id: 'scene',
    label: 'New Scene',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
        />
      </svg>
    ),
    href: '/quick-setup/scenes',
  },
];

/**
 * Editor Quick Access Widget for Dashboard
 * Provides quick-start options and recent session access
 * Implements SPEC.md Section 2.2 - Editor Quick Access Widget
 */
export function EditorQuickAccessWidget() {
  // In production, this would use React Query to fetch data
  const recentSessions = mockRecentSessions;

  return (
    <div className="space-y-4">
      {/* Quick Start Options */}
      <div>
        <p className="text-xs font-semibold text-base-content/60 uppercase mb-2">
          Quick Start
        </p>
        <div className="grid grid-cols-2 gap-2">
          {quickStartOptions.map((option) => (
            <Link
              key={option.id}
              to={option.href}
              className="btn btn-outline btn-sm flex items-center gap-2 justify-start"
            >
              {option.icon}
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Sessions */}
      <div>
        <p className="text-xs font-semibold text-base-content/60 uppercase mb-2">
          Recent Sessions
        </p>
        {recentSessions.length === 0 ? (
          <p className="text-sm text-base-content/50 text-center py-2">
            No recent sessions
          </p>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((session) => (
              <Link
                key={session.id}
                to={`/session/${session.id}/chat`}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-base-200 transition-colors group"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Session icon */}
                  <svg
                    className="w-4 h-4 text-primary flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z" />
                  </svg>
                  <div className="min-w-0">
                    <span className="text-sm font-medium block truncate">
                      {session.name}
                    </span>
                    <span className="text-xs text-base-content/50 block">
                      {session.branch}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-base-content/50 flex-shrink-0 ml-2">
                  {session.lastEdited}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link to="/sessions" className="btn btn-ghost btn-sm w-full">
        View All Sessions
      </Link>
    </div>
  );
}

export default EditorQuickAccessWidget;
