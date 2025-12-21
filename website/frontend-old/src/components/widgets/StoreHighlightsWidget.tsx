import { Link } from 'react-router-dom';

// Mock data - in production these would come from an API
const featuredItems = [
  {
    id: 1,
    title: 'Space Explorer',
    price: '$29.99',
    thumbnail:
      'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=100&h=60&fit=crop',
    isFeatured: true,
  },
  {
    id: 4,
    title: 'Fantasy Realms',
    price: '$39.99',
    thumbnail:
      'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=100&h=60&fit=crop',
    isNew: true,
  },
];

export function StoreHighlightsWidget() {
  return (
    <div className="space-y-3">
      {featuredItems.map((item) => (
        <Link
          key={item.id}
          to={`/item/${item.id}`}
          className="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors"
        >
          <div className="relative">
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
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{item.title}</p>
            <p className="text-sm text-primary font-semibold">{item.price}</p>
          </div>
        </Link>
      ))}
      <Link to="/store" className="btn btn-ghost btn-sm w-full">
        Browse Store
      </Link>
    </div>
  );
}
