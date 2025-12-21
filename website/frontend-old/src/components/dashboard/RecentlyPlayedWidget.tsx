import { Link } from 'react-router-dom';

/**
 * Mock data for recently played games
 * In production, this would come from an API call to /api/library?filter=recently-played
 */
const mockRecentlyPlayed = [
  {
    id: 1,
    title: 'Space Explorer',
    lastPlayed: '2 hours ago',
    thumbnail:
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop',
    playTime: '12h 34m',
  },
  {
    id: 2,
    title: 'Pixel Quest',
    lastPlayed: 'Yesterday',
    thumbnail:
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&h=60&fit=crop',
    playTime: '5h 12m',
  },
  {
    id: 3,
    title: 'Racing Legends',
    lastPlayed: '3 days ago',
    thumbnail:
      'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=100&h=60&fit=crop',
    playTime: '8h 45m',
  },
];

/**
 * Recently Played Widget for Dashboard
 * Displays user's recently played games with quick play access
 * Implements SPEC.md Section 2.2 - Recently Played Widget
 */
export function RecentlyPlayedWidget() {
  // In production, this would use React Query to fetch data
  const recentlyPlayed = mockRecentlyPlayed;

  // Empty state when no games have been played
  if (recentlyPlayed.length === 0) {
    return (
      <div className="text-center py-6 text-base-content/60">
        <svg
          className="w-12 h-12 mx-auto mb-2 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="font-medium mb-1">No recently played games</p>
        <p className="text-sm">Start playing to see your history here</p>
        <Link to="/store" className="btn btn-primary btn-sm mt-3">
          Browse Store
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recentlyPlayed.map((game) => (
        <Link
          key={game.id}
          to={`/library/${game.id}`}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors group"
        >
          {/* Game thumbnail */}
          <img
            src={game.thumbnail}
            alt={game.title}
            className="w-16 h-10 object-cover rounded"
          />
          {/* Game info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{game.title}</p>
            <p className="text-xs text-base-content/60">{game.lastPlayed}</p>
          </div>
          {/* Play button */}
          <button
            className="btn btn-ghost btn-sm btn-circle opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Play ${game.title}`}
            onClick={(e) => {
              e.preventDefault();
              // In production, this would launch the game
              console.log('Play game:', game.id);
            }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </Link>
      ))}
      <Link to="/library?filter=recently-played" className="btn btn-ghost btn-sm w-full">
        View All
      </Link>
    </div>
  );
}

export default RecentlyPlayedWidget;
