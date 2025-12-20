import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const recentlyPlayed = [
  {
    id: 1,
    title: 'Space Explorer',
    lastPlayed: '2 hours ago',
    thumbnail:
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop',
  },
  {
    id: 2,
    title: 'Pixel Quest',
    lastPlayed: 'Yesterday',
    thumbnail:
      'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=100&h=60&fit=crop',
  },
  {
    id: 3,
    title: 'Racing Legends',
    lastPlayed: '3 days ago',
    thumbnail:
      'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=100&h=60&fit=crop',
  },
];

export function RecentlyPlayedWidget() {
  if (recentlyPlayed.length === 0) {
    return (
      <div className="text-center py-6 text-base-content/60">
        <svg
          className="w-12 h-12 mx-auto mb-2 opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
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
        <p>No recently played games</p>
        <Link to="/store" className="btn btn-primary btn-sm mt-3">
          Browse Store
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recentlyPlayed.map((game) => (
        <div
          key={game.id}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors cursor-pointer"
        >
          <img
            src={game.thumbnail}
            alt={game.title}
            className="w-16 h-10 object-cover rounded"
          />
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
      <Link to="/library" className="btn btn-ghost btn-sm w-full">
        View All
      </Link>
    </div>
  );
}
