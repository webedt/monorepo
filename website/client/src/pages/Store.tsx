import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '@/hooks/useViewMode';
import ViewToggle from '@/components/ViewToggle';
import ItemGridView from '@/components/ItemViews/ItemGridView';
import ItemDetailedView from '@/components/ItemViews/ItemDetailedView';
import ItemMinimalView from '@/components/ItemViews/ItemMinimalView';
import GameCard, { GameItem } from '@/components/GameCard';

// Mock data for the store catalog
const storeItems: GameItem[] = [
  {
    id: 1,
    title: 'Space Explorer',
    description: 'Explore the vast universe in this epic space adventure game with stunning graphics',
    price: 29.99,
    thumbnail: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/1',
    isWishlisted: false,
  },
  {
    id: 2,
    title: 'Pixel Quest',
    description: 'A retro-style platformer with challenging levels and nostalgic gameplay',
    price: null, // Free
    thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/2',
    isWishlisted: true,
  },
  {
    id: 3,
    title: 'Racing Legends',
    description: 'High-speed racing action with customizable cars and multiplayer support',
    price: 19.99,
    thumbnail: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/3',
    isWishlisted: false,
  },
  {
    id: 4,
    title: 'Fantasy Realms',
    description: 'Immerse yourself in a magical world filled with quests and mythical creatures',
    price: 39.99,
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/4',
    isWishlisted: false,
  },
  {
    id: 5,
    title: 'Puzzle Master',
    description: 'Brain-teasing puzzles that will challenge your logic and problem-solving skills',
    price: null, // Free
    thumbnail: 'https://images.unsplash.com/photo-1606503153255-59d8b8b82176?w=400&h=300&fit=crop',
    isWishlisted: false,
  },
  {
    id: 6,
    title: 'Battle Arena',
    description: 'Competitive multiplayer battles with diverse characters and strategic gameplay',
    price: 24.99,
    thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/6',
    isWishlisted: true,
  },
  {
    id: 7,
    title: 'City Builder Pro',
    description: 'Build and manage your own metropolis with advanced simulation mechanics',
    price: 34.99,
    thumbnail: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/7',
    isWishlisted: false,
  },
  {
    id: 8,
    title: 'Survival Island',
    description: 'Survive on a deserted island by gathering resources and building shelter',
    price: 14.99,
    thumbnail: 'https://images.unsplash.com/photo-1559128010-7c1ad6e1b6a5?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/8',
    isWishlisted: false,
  },
];

type SortField = 'title' | 'price' | null;
type SortDirection = 'asc' | 'desc' | null;

export default function Store() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [viewMode, setViewMode] = useViewMode('store-view');
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [items, setItems] = useState<GameItem[]>(storeItems);
  const navigate = useNavigate();

  // Handle wishlist toggle
  const handleToggleWishlist = (game: GameItem) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === game.id ? { ...item, isWishlisted: !item.isWishlisted } : item
      )
    );
  };

  // Handle play now
  const handlePlayNow = (game: GameItem) => {
    console.log('Play Now:', game.title);
    // Navigate to game or launch game
  };

  // Handle view trailer
  const handleViewTrailer = (game: GameItem) => {
    console.log('View Trailer:', game.title, game.trailerUrl);
    // Open trailer modal or redirect
  };

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
  const sortedItems = [...items].sort((a, b) => {
    if (!sortField || !sortDirection) return 0;

    let comparison = 0;
    if (sortField === 'title') {
      comparison = a.title.localeCompare(b.title);
    } else if (sortField === 'price') {
      const priceA = a.price ?? 0;
      const priceB = b.price ?? 0;
      comparison = priceA - priceB;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Format price for display
  const formatPrice = (price: number | null): string => {
    if (price === null || price === 0) {
      return 'Free';
    }
    return `$${price.toFixed(2)}`;
  };

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
      <div className="w-32"></div> {/* Actions spacer */}
    </div>
  );

  // Grid/Card view renderer using GameCard component
  const renderCard = (item: GameItem) => (
    <GameCard
      key={item.id}
      game={item}
      onPlayNow={handlePlayNow}
      onViewTrailer={handleViewTrailer}
      onToggleWishlist={handleToggleWishlist}
    />
  );

  // Detailed line view renderer
  const renderDetailedRow = (item: GameItem) => {
    const isFree = item.price === null || item.price === 0;

    return (
      <div
        key={item.id}
        className="flex items-center gap-4 p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
        onClick={() => navigate(`/item/${item.id}`)}
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
        </div>

        {/* Price */}
        <div className="flex items-center gap-4">
          {isFree ? (
            <span className="badge badge-success font-bold">Free</span>
          ) : (
            <div className="text-xl font-bold text-primary">{formatPrice(item.price)}</div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {/* Wishlist */}
          <button
            className={`btn btn-ghost btn-sm btn-circle ${item.isWishlisted ? 'text-error' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleWishlist(item);
            }}
            title={item.isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill={item.isWishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

          {/* Trailer */}
          {item.trailerUrl && (
            <button
              className="btn btn-ghost btn-sm btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                handleViewTrailer(item);
              }}
              title="View Trailer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <line x1="2" y1="7" x2="7" y2="7" />
                <line x1="2" y1="17" x2="7" y2="17" />
                <line x1="17" y1="17" x2="22" y2="17" />
                <line x1="17" y1="7" x2="22" y2="7" />
              </svg>
            </button>
          )}

          {/* Play */}
          <button
            className="btn btn-primary btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayNow(item);
            }}
            title="Play Now"
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
        </div>
      </div>
    );
  };

  // Minimal line view renderer
  const renderMinimalRow = (item: GameItem) => {
    const isFree = item.price === null || item.price === 0;

    return (
      <div
        key={item.id}
        className="flex items-center gap-4 p-3 bg-base-100 rounded hover:bg-base-200 transition-colors cursor-pointer"
        onClick={() => navigate(`/item/${item.id}`)}
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
        {isFree ? (
          <span className="badge badge-success badge-sm font-bold">Free</span>
        ) : (
          <div className="text-sm font-semibold text-primary">{formatPrice(item.price)}</div>
        )}

        {/* Quick Actions */}
        <div className="flex gap-1">
          {/* Wishlist */}
          <button
            className={`btn btn-ghost btn-xs btn-circle ${item.isWishlisted ? 'text-error' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleWishlist(item);
            }}
            title={item.isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill={item.isWishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

          {/* Trailer */}
          {item.trailerUrl && (
            <button
              className="btn btn-ghost btn-xs btn-circle"
              onClick={(e) => {
                e.stopPropagation();
                handleViewTrailer(item);
              }}
              title="View Trailer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
            </button>
          )}

          {/* Play */}
          <button
            className="btn btn-ghost btn-xs btn-circle"
            onClick={(e) => {
              e.stopPropagation();
              handlePlayNow(item);
            }}
            title="Play Now"
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
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-base-content mb-4">Store</h1>
          <p className="text-base-content/70">
            Browse and discover games in our marketplace
          </p>
        </div>

        {/* Category Filters and View Toggle */}
        <div className="mb-8 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            {['All', 'Action', 'Adventure', 'Puzzle', 'Racing', 'Strategy', 'Free'].map((category) => (
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

        {/* Store Items - Dynamic View */}
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
