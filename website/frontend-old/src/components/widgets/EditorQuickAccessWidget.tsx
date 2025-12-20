import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const recentSessions = [
  { id: 1, name: 'My Game Project', lastEdited: '1 hour ago' },
  { id: 2, name: 'Test Scene', lastEdited: '3 hours ago' },
  { id: 3, name: 'Character Demo', lastEdited: 'Yesterday' },
];

export function EditorQuickAccessWidget() {
  return (
    <div className="space-y-4">
      {/* Quick Start Options */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          to="/quick-setup/chat"
          className="btn btn-outline btn-sm flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
          </svg>
          New Chat
        </Link>
        <Link
          to="/quick-setup/code"
          className="btn btn-outline btn-sm flex items-center gap-2"
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
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          New Code
        </Link>
      </div>

      {/* Recent Sessions */}
      <div>
        <p className="text-xs font-semibold text-base-content/60 uppercase mb-2">
          Recent Sessions
        </p>
        <div className="space-y-2">
          {recentSessions.map((session) => (
            <Link
              key={session.id}
              to={`/session/${session.id}`}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-base-200 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-primary"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z" />
                </svg>
                <span className="text-sm font-medium">{session.name}</span>
              </div>
              <span className="text-xs text-base-content/50">
                {session.lastEdited}
              </span>
            </Link>
          ))}
        </div>
      </div>
      <Link to="/sessions" className="btn btn-ghost btn-sm w-full">
        View All Sessions
      </Link>
    </div>
  );
}
