import { Link } from 'react-router-dom';

/**
 * Mock data for store highlights
 * In production, this would come from an API call to /api/store/featured
 */
const mockFeaturedItems = [
  {
    id: 1,
    title: 'Space Explorer',
    price: '$29.99',
    thumbnail:
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop',
    isFeatured: true,
    isNew: false,
  },
  {
    id: 4,
    title: 'Fantasy Realms',
    price: '$39.99',
    thumbnail:
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=100&h=60&fit=crop',
    isFeatured: false,
    isNew: true,
  },
  {
    id: 5,
    title: 'Puzzle Master',
    price: 'Free',
    thumbnail:
      'https://images.unsplash.com/photo-1611996575749-79a3a250f948?w=100&h=60&fit=crop',
    isFeatured: false,
    isNew: true,
  },
];

/**
 * Store Highlights Widget for Dashboard
 * Displays featured and new items from the store
 * Implements SPEC.md Section 2.2 - Store Highlights Widget
 */
export function StoreHighlightsWidget() {
  // In production, this would use React Query to fetch data
  const featuredItems = mockFeaturedItems;

  // Empty state when no items are available
  if (featuredItems.length === 0) {
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
            d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
          />
        </svg>
        <p className="font-medium mb-1">No featured items</p>
        <p className="text-sm">Check back later for new releases</p>
        <Link to="/store" className="btn btn-primary btn-sm mt-3">
          Browse Store
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {featuredItems.map((item) => (
        <Link
          key={item.id}
          to={`/item/${item.id}`}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors group"
        >
          {/* Item thumbnail with badge */}
          <div className="relative flex-shrink-0">
            <img
              src={item.thumbnail}
              alt={item.title}
              className="w-20 h-12 object-cover rounded"
            />
            {item.isFeatured && (
              <span className="absolute -top-1 -right-1 badge badge-primary badge-xs">
                Featured
              </span>
            )}
            {item.isNew && (
              <span className="absolute -top-1 -right-1 badge badge-secondary badge-xs">
                New
              </span>
            )}
          </div>
          {/* Item info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{item.title}</p>
            <p
              className={`text-sm font-semibold ${
                item.price === 'Free' ? 'text-success' : 'text-primary'
              }`}
            >
              {item.price}
            </p>
          </div>
          {/* Hover arrow indicator */}
          <svg
            className="w-4 h-4 text-base-content/30 opacity-0 group-hover:opacity-100 transition-opacity"
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
      <Link to="/store" className="btn btn-ghost btn-sm w-full">
        Browse Store
      </Link>
    </div>
  );
}

export default StoreHighlightsWidget;
