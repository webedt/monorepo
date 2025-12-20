import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const favorites = [
  {
    id: 1,
    title: 'Code Editor Pro',
    thumbnail:
      'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=100&h=60&fit=crop',
  },
  {
    id: 3,
    title: 'Project Planner',
    thumbnail:
      'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=100&h=60&fit=crop',
  },
];

export function LibraryFavoritesWidget() {
  if (favorites.length === 0) {
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
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
        <p>No favorites yet</p>
        <Link to="/library" className="btn btn-primary btn-sm mt-3">
          Go to Library
        </Link>
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
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-2">
            <p className="text-white text-xs font-medium truncate">
              {item.title}
            </p>
          </div>
          <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      ))}
    </div>
  );
}
