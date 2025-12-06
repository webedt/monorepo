import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '@/hooks/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ItemGridView from '@/components/ItemViews/ItemGridView';
import ItemDetailedView from '@/components/ItemViews/ItemDetailedView';
import ItemMinimalView from '@/components/ItemViews/ItemMinimalView';

interface ShopItem {
  id: number;
  title: string;
  description: string;
  price: string;
  thumbnail: string;
  purchasedDate: string;
}

// Subset of store items that user has "purchased"
const libraryItems: ShopItem[] = [
  {
    id: 1,
    title: 'Code Editor Pro',
    description: 'Advanced code editor with syntax highlighting and auto-completion',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-15',
  },
  {
    id: 3,
    title: 'Project Planner',
    description: 'Manage your projects with powerful planning and tracking tools',
    price: '$18.99',
    thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-10',
  },
  {
    id: 5,
    title: 'Design Studio',
    description: 'Create stunning mockups and prototypes for your projects',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-05',
  },
  {
    id: 6,
    title: 'Team Chat',
    description: 'Communicate seamlessly with your team in real-time',
    price: '$24.99',
    thumbnail: 'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=400&h=300&fit=crop',
    purchasedDate: '2025-10-28',
  },
];

type SortField = 'title' | 'price' | null;
type SortDirection = 'asc' | 'desc' | null;

export default function Library() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [viewMode, setViewMode] = useViewMode('library-view');
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const navigate = useNavigate();

  // Handle sort click
  const handleSort = (field: Exclude<SortField, null>) => {
    if (sortField === field) {
      // Cycle through: asc -> desc -> none
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortField(null);
        setSortDirection(null);
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sort items
  const sortedItems = [...libraryItems].sort((a, b) => {
    if (!sortField || !sortDirection) return 0;

    let comparison = 0;
    if (sortField === 'title') {
      comparison = a.title.localeCompare(b.title);
    } else if (sortField === 'price') {
      const priceA = parseFloat(a.price.replace('$', ''));
      const priceB = parseFloat(b.price.replace('$', ''));
      comparison = priceA - priceB;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Render sort icon
  const renderSortIcon = (field: Exclude<SortField, null>) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    if (sortDirection === 'asc') {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      );
    }
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  // Header for list views
  const renderHeader = () => (
    <div className="flex items-center gap-4 px-4 py-3 bg-base-300 rounded-lg font-semibold text-sm mb-2">
      <div className="w-10 h-10"></div> {/* Thumbnail spacer */}
      <button
        onClick={() => handleSort('title')}
        className="flex-1 flex items-center gap-2 hover:text-primary transition-colors"
      >
        Title
        {renderSortIcon('title')}
      </button>
      <button
        onClick={() => handleSort('price')}
        className="flex items-center gap-2 hover:text-primary transition-colors"
      >
        Price
        {renderSortIcon('price')}
      </button>
      <div className="w-24"></div> {/* Actions spacer */}
    </div>
  );

  // Grid/Card view renderer
  const renderCard = (item: ShopItem) => (
    <div
      key={item.id}
      className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow"
    >
      {/* Thumbnail - Clickable to Open */}
      <figure
        className="relative h-48 overflow-hidden cursor-pointer group"
        onClick={() => navigate(`/library/${item.id}`)}
      >
        <img
          src={item.thumbnail}
          alt={item.title}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
        {/* Hover Overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
          <div className="text-white transform scale-90 group-hover:scale-100 transition-transform duration-300">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-16 w-16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>
        </div>
      </figure>

      <div className="card-body p-4">
        {/* Title */}
        <h2 className="card-title text-lg">{item.title}</h2>

        {/* Description */}
        <p className="text-sm text-base-content/70 line-clamp-2 mb-2">
          {item.description}
        </p>

        {/* Price with Icons */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-success font-semibold">Owned</div>
          <div className="flex gap-3">
            {/* Launch Icon */}
            <button
              className="btn btn-ghost btn-sm btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                console.log('Launch:', item.title);
              }}
              title="Launch"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>

            {/* Info Icon */}
            <button
              className="btn btn-ghost btn-sm btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/library/${item.id}`);
              }}
              title="View Details"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Detailed line view renderer
  const renderDetailedRow = (item: ShopItem) => (
    <div
      key={item.id}
      className="flex items-center gap-4 p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => navigate(`/library/${item.id}`)}
    >
      {/* Thumbnail */}
      <img
        src={item.thumbnail}
        alt={item.title}
        className="w-24 h-24 object-cover rounded"
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
        <p className="text-sm text-base-content/70 mt-1">{item.description}</p>
        <p className="text-xs text-success font-semibold mt-2">Owned</p>
      </div>

      {/* Price and Actions */}
      <div className="flex items-center gap-4">
        <div className="text-lg font-semibold text-base-content/60">{item.price}</div>
        <div className="flex gap-2">
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={(e) => {
              e.stopPropagation();
              console.log('Launch:', item.title);
            }}
            title="Launch"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/library/${item.id}`);
            }}
            title="View Details"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  // Minimal line view renderer
  const renderMinimalRow = (item: ShopItem) => (
    <div
      key={item.id}
      className="flex items-center gap-4 p-3 bg-base-100 rounded hover:bg-base-200 transition-colors cursor-pointer"
      onClick={() => navigate(`/library/${item.id}`)}
    >
      {/* Icon/Thumbnail */}
      <img
        src={item.thumbnail}
        alt={item.title}
        className="w-10 h-10 object-cover rounded"
      />

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-base-content truncate">{item.title}</h3>
      </div>

      {/* Price */}
      <div className="text-xs text-base-content/60">{item.price}</div>

      {/* Quick Actions */}
      <div className="flex gap-1">
        <button
          className="btn btn-ghost btn-xs btn-circle"
          onClick={(e) => {
            e.stopPropagation();
            console.log('Launch:', item.title);
          }}
          title="Launch"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          className="btn btn-ghost btn-xs btn-circle"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/library/${item.id}`);
          }}
          title="View Details"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-base-content mb-4">My Library</h1>
          <p className="text-base-content/70">
            Your purchased apps and tools
          </p>
        </div>

        {/* Category Filters and View Toggle */}
        <div className="mb-8 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-2">
            {['All', 'Recently Added', 'Most Used', 'Favorites'].map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={`btn btn-sm ${
                  selectedCategory === category ? 'btn-primary' : 'btn-ghost'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

        {/* Library Items - Dynamic View */}
        {viewMode === 'grid' && (
          <ItemGridView items={sortedItems} renderCard={renderCard} />
        )}
        {viewMode === 'detailed' && (
          <ItemDetailedView items={sortedItems} renderRow={renderDetailedRow} renderHeader={renderHeader} />
        )}
        {viewMode === 'minimal' && (
          <ItemMinimalView items={sortedItems} renderRow={renderMinimalRow} renderHeader={renderHeader} />
        )}
      </div>
    </div>
  );
}
