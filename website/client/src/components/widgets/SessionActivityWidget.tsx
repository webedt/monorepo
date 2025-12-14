import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const activeSessions = [
  { id: 1, name: 'Game Project', status: 'active' as const, collaborators: 2 },
  { id: 2, name: 'Art Assets', status: 'idle' as const, collaborators: 0 },
];

export function SessionActivityWidget() {
  return (
    <div className="space-y-3">
      {activeSessions.map((session) => (
        <Link
          key={session.id}
          to={`/session/${session.id}`}
          className="flex items-center justify-between p-3 rounded-lg bg-base-200 hover:bg-base-300 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full ${
                session.status === 'active'
                  ? 'bg-success animate-pulse'
                  : 'bg-base-content/30'
              }`}
            />
            <div>
              <p className="font-medium text-sm">{session.name}</p>
              <p className="text-xs text-base-content/60">
                {session.status === 'active' ? 'Active' : 'Idle'}
                {session.collaborators > 0 &&
                  ` • ${session.collaborators} collaborator${
                    session.collaborators > 1 ? 's' : ''
                  }`}
              </p>
            </div>
          </div>
          <svg
            className="w-4 h-4 text-base-content/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Link>
      ))}
      <Link to="/sessions" className="btn btn-ghost btn-sm w-full">
        View All Sessions
      </Link>
    </div>
  );
}
