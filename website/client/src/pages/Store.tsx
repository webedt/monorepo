import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '@/hooks/useViewMode';
import { useWishlist } from '@/hooks/useWishlist';
import ViewToggle from '@/components/ViewToggle';
import ItemGridView from '@/components/ItemViews/ItemGridView';
import ItemDetailedView from '@/components/ItemViews/ItemDetailedView';
import ItemMinimalView from '@/components/ItemViews/ItemMinimalView';
import { StoreItemCard } from '@/components/store';
import type {
  StoreItem,
  StoreCategory,
  StoreGenre,
  PriceRange,
  StoreSortField,
  SortDirection,
} from '@/types/store';
import { categoryLabels, genreLabels, priceRangeLabels } from '@/types/store';

// Mock data for the store catalog with extended fields
const mockStoreItems: StoreItem[] = [
  {
    id: 1,
    title: 'Space Explorer',
    description: 'Explore the vast universe in this epic space adventure game with stunning graphics and immersive storyline',
    price: 29.99,
    thumbnail: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/1',
    category: 'games',
    genre: 'adventure',
    tags: ['space', 'exploration', 'sci-fi'],
    creator: 'Stellar Studios',
    releaseDate: '2025-01-15',
    rating: 4.5,
    reviewCount: 1234,
    isNew: true,
  },
  {
    id: 2,
    title: 'Pixel Quest',
    description: 'A retro-style platformer with challenging levels and nostalgic pixel art gameplay',
    price: null,
    thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/2',
    category: 'games',
    genre: 'platformer',
    tags: ['retro', 'pixel-art', 'indie'],
    creator: 'Retro Games Inc',
    releaseDate: '2024-11-20',
    rating: 4.2,
    reviewCount: 567,
  },
  {
    id: 3,
    title: 'Racing Legends',
    description: 'High-speed racing action with customizable cars and multiplayer support',
    price: 19.99,
    originalPrice: 29.99,
    thumbnail: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/3',
    category: 'games',
    genre: 'racing',
    tags: ['racing', 'multiplayer', 'cars'],
    creator: 'Speed Demon Studios',
    releaseDate: '2024-09-10',
    rating: 4.0,
    reviewCount: 890,
    isOnSale: true,
    salePercentage: 33,
  },
  {
    id: 4,
    title: 'Fantasy Realms',
    description: 'Immerse yourself in a magical world filled with quests, mythical creatures, and epic battles',
    price: 39.99,
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/4',
    category: 'games',
    genre: 'rpg',
    tags: ['fantasy', 'rpg', 'magic'],
    creator: 'Epic Worlds',
    releaseDate: '2024-12-01',
    rating: 4.8,
    reviewCount: 2456,
    isFeatured: true,
  },
  {
    id: 5,
    title: 'Puzzle Master',
    description: 'Brain-teasing puzzles that will challenge your logic and problem-solving skills',
    price: null,
    thumbnail: 'https://images.unsplash.com/photo-1606503153255-59d8b8b82176?w=400&h=300&fit=crop',
    category: 'games',
    genre: 'puzzle',
    tags: ['puzzle', 'brain', 'casual'],
    creator: 'Mind Games Co',
    releaseDate: '2024-08-15',
    rating: 4.1,
    reviewCount: 345,
  },
  {
    id: 6,
    title: 'Battle Arena',
    description: 'Competitive multiplayer battles with diverse characters and strategic gameplay',
    price: 24.99,
    thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/6',
    category: 'games',
    genre: 'action',
    tags: ['battle', 'multiplayer', 'competitive'],
    creator: 'Arena Masters',
    releaseDate: '2024-10-25',
    rating: 4.3,
    reviewCount: 1567,
  },
  {
    id: 7,
    title: 'City Builder Pro',
    description: 'Build and manage your own metropolis with advanced simulation mechanics',
    price: 34.99,
    thumbnail: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/7',
    category: 'games',
    genre: 'simulation',
    tags: ['city', 'building', 'management'],
    creator: 'SimCity Studios',
    releaseDate: '2024-07-20',
    rating: 4.6,
    reviewCount: 789,
  },
  {
    id: 8,
    title: 'Survival Island',
    description: 'Survive on a deserted island by gathering resources, building shelter, and exploring',
    price: 14.99,
    thumbnail: 'https://images.unsplash.com/photo-1559128010-7c1ad6e1b6a5?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/8',
    category: 'games',
    genre: 'adventure',
    tags: ['survival', 'crafting', 'exploration'],
    creator: 'Wilderness Games',
    releaseDate: '2024-06-10',
    rating: 3.9,
    reviewCount: 456,
  },
  {
    id: 9,
    title: 'Asset Pack: Fantasy Characters',
    description: 'Collection of 50+ high-quality fantasy character sprites for your games',
    price: 9.99,
    thumbnail: 'https://images.unsplash.com/photo-1560419015-7c427e8ae5ba?w=400&h=300&fit=crop',
    category: 'assets',
    genre: 'other',
    tags: ['assets', 'sprites', 'fantasy'],
    creator: 'Art Assets Hub',
    releaseDate: '2024-05-15',
    rating: 4.7,
    reviewCount: 234,
  },
  {
    id: 10,
    title: 'Game Audio Toolkit',
    description: 'Professional sound effects and music tracks for game development',
    price: 19.99,
    thumbnail: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=300&fit=crop',
    category: 'audio',
    genre: 'other',
    tags: ['audio', 'sound', 'music'],
    creator: 'Sound Forge',
    releaseDate: '2024-04-20',
    rating: 4.4,
    reviewCount: 567,
  },
  {
    id: 11,
    title: 'Strategy Commander',
    description: 'Lead your armies to victory in this turn-based strategy masterpiece',
    price: 44.99,
    thumbnail: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?w=400&h=300&fit=crop',
    trailerUrl: 'https://example.com/trailer/11',
    category: 'games',
    genre: 'strategy',
    tags: ['strategy', 'war', 'turn-based'],
    creator: 'War Games Inc',
    releaseDate: '2025-02-01',
    rating: 4.9,
    reviewCount: 678,
    isNew: true,
    isFeatured: true,
  },
  {
    id: 12,
    title: 'Kids Learning Adventure',
    description: 'Educational games for kids featuring math, reading, and science activities',
    price: null,
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=300&fit=crop',
    category: 'games',
    genre: 'educational',
    tags: ['kids', 'education', 'learning'],
    creator: 'EduGames',
    releaseDate: '2024-03-10',
    rating: 4.5,
    reviewCount: 890,
  },
];

export default function Store() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useViewMode('store-view');
  const { isWishlisted, toggleWishlist } = useWishlist();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory | 'all'>('all');
  const [selectedGenre, setSelectedGenre] = useState<StoreGenre | 'all'>('all');
  const [selectedPriceRange, setSelectedPriceRange] = useState<PriceRange>('all');
  const [showOnSaleOnly, setShowOnSaleOnly] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<StoreSortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Filter items based on search and filters
  const filteredItems = useMemo(() => {
    return mockStoreItems.filter((item) => {
      // Search filter - searches across multiple fields
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchableText = [
          item.title,
          item.description,
          item.creator,
          item.category,
          item.genre,
          ...item.tags,
        ]
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(query)) {
          return false;
        }
      }

      // Category filter
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }

      // Genre filter
      if (selectedGenre !== 'all' && item.genre !== selectedGenre) {
        return false;
      }

      // Price range filter
      if (selectedPriceRange !== 'all') {
        const price = item.price ?? 0;
        switch (selectedPriceRange) {
          case 'free':
            if (price !== 0) return false;
            break;
          case 'under5':
            if (price === 0 || price >= 5) return false;
            break;
          case 'under10':
            if (price === 0 || price >= 10) return false;
            break;
          case 'under25':
            if (price === 0 || price >= 25) return false;
            break;
          case 'under50':
            if (price === 0 || price >= 50) return false;
            break;
          case 'over50':
            if (price <= 50) return false;
            break;
        }
      }

      // On sale filter
      if (showOnSaleOnly && !item.isOnSale) {
        return false;
      }

      return true;
    });
  }, [searchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly]);

  // Sort items
  const sortedItems = useMemo(() => {
    if (!sortField || !sortDirection) {
      return filteredItems;
    }

    return [...filteredItems].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'price':
          const priceA = a.price ?? 0;
          const priceB = b.price ?? 0;
          comparison = priceA - priceB;
          break;
        case 'releaseDate':
          comparison = new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime();
          break;
        case 'rating':
          comparison = (a.rating ?? 0) - (b.rating ?? 0);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortField, sortDirection]);

  // Handle sort click
  const handleSort = (field: Exclude<StoreSortField, null>) => {
    if (sortField === field) {
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

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedGenre('all');
    setSelectedPriceRange('all');
    setShowOnSaleOnly(false);
    setSortField(null);
    setSortDirection(null);
  };

  // Handle wishlist toggle
  const handleToggleWishlist = (item: StoreItem) => {
    toggleWishlist(item.id);
  };

  // Handle play now
  const handlePlayNow = (item: StoreItem) => {
    console.log('Play Now:', item.title);
    navigate(`/item/${item.id}`);
  };

  // Handle view trailer
  const handleViewTrailer = (item: StoreItem) => {
    console.log('View Trailer:', item.title, item.trailerUrl);
  };

  // Format price for display
  const formatPrice = (price: number | null): string => {
    if (price === null || price === 0) {
      return 'Free';
    }
    return `$${price.toFixed(2)}`;
  };

  // Render sort icon
  const renderSortIcon = (field: Exclude<StoreSortField, null>) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
          />
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
      <div className="w-10 h-10"></div>
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
      <button
        onClick={() => handleSort('rating')}
        className="flex items-center gap-2 hover:text-primary transition-colors"
      >
        Rating
        {renderSortIcon('rating')}
      </button>
      <div className="w-32"></div>
    </div>
  );

  // Grid/Card view renderer using StoreItemCard component
  const renderCard = (item: StoreItem) => (
    <StoreItemCard
      key={item.id}
      item={item}
      isWishlisted={isWishlisted(item.id)}
      onPlayNow={handlePlayNow}
      onViewTrailer={handleViewTrailer}
      onToggleWishlist={handleToggleWishlist}
    />
  );

  // Detailed line view renderer
  const renderDetailedRow = (item: StoreItem) => {
    const isFree = item.price === null || item.price === 0;
    const wishlisted = isWishlisted(item.id);

    return (
      <div
        key={item.id}
        className="flex items-center gap-4 p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
        onClick={() => navigate(`/item/${item.id}`)}
      >
        {/* Thumbnail */}
        <img src={item.thumbnail} alt={item.title} className="w-24 h-24 object-cover rounded" />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
            {item.isNew && <span className="badge badge-secondary badge-sm">NEW</span>}
            {item.isOnSale && (
              <span className="badge badge-error badge-sm">-{item.salePercentage}%</span>
            )}
          </div>
          <p className="text-sm text-base-content/70 mt-1 line-clamp-1">{item.description}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-base-content/60">
            <span>{item.creator}</span>
            <span>|</span>
            <span className="capitalize">{item.category}</span>
            <span>|</span>
            <span className="capitalize">{item.genre}</span>
          </div>
        </div>

        {/* Price */}
        <div className="flex items-center gap-4">
          {isFree ? (
            <span className="badge badge-success font-bold">Free</span>
          ) : (
            <div className="text-xl font-bold text-primary">{formatPrice(item.price)}</div>
          )}
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-warning fill-warning"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          <span className="text-sm">{item.rating?.toFixed(1)}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            className={`btn btn-ghost btn-sm btn-circle ${wishlisted ? 'text-error' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleWishlist(item);
            }}
            title={wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill={wishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

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
              </svg>
            </button>
          )}

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
  const renderMinimalRow = (item: StoreItem) => {
    const isFree = item.price === null || item.price === 0;
    const wishlisted = isWishlisted(item.id);

    return (
      <div
        key={item.id}
        className="flex items-center gap-4 p-3 bg-base-100 rounded hover:bg-base-200 transition-colors cursor-pointer"
        onClick={() => navigate(`/item/${item.id}`)}
      >
        <img src={item.thumbnail} alt={item.title} className="w-10 h-10 object-cover rounded" />

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-base-content truncate">{item.title}</h3>
        </div>

        {/* Rating */}
        <div className="flex items-center gap-1 text-xs">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3 text-warning fill-warning"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
          {item.rating?.toFixed(1)}
        </div>

        {isFree ? (
          <span className="badge badge-success badge-sm font-bold">Free</span>
        ) : (
          <div className="text-sm font-semibold text-primary">{formatPrice(item.price)}</div>
        )}

        <div className="flex gap-1">
          <button
            className={`btn btn-ghost btn-xs btn-circle ${wishlisted ? 'text-error' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleWishlist(item);
            }}
            title={wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill={wishlisted ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

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
              </svg>
            </button>
          )}

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

  const hasActiveFilters =
    searchQuery ||
    selectedCategory !== 'all' ||
    selectedGenre !== 'all' ||
    selectedPriceRange !== 'all' ||
    showOnSaleOnly;

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-base-content mb-4">Store</h1>
          <p className="text-base-content/70">Browse and discover games in our marketplace</p>
        </div>

        {/* Search Box */}
        <div className="mb-6">
          <div className="relative">
            <input
              type="text"
              placeholder="Search games, creators, tags..."
              className="input input-bordered w-full pl-10 pr-4"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-base-content/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {searchQuery && (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
                onClick={() => setSearchQuery('')}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Filter Dropdowns and View Toggle */}
        <div className="mb-6 flex flex-wrap gap-4 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Category Dropdown */}
            <select
              className="select select-bordered select-sm"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as StoreCategory | 'all')}
            >
              {(Object.keys(categoryLabels) as (StoreCategory | 'all')[]).map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabels[cat]}
                </option>
              ))}
            </select>

            {/* Genre Dropdown */}
            <select
              className="select select-bordered select-sm"
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value as StoreGenre | 'all')}
            >
              {(Object.keys(genreLabels) as (StoreGenre | 'all')[]).map((genre) => (
                <option key={genre} value={genre}>
                  {genreLabels[genre]}
                </option>
              ))}
            </select>

            {/* Price Range Dropdown */}
            <select
              className="select select-bordered select-sm"
              value={selectedPriceRange}
              onChange={(e) => setSelectedPriceRange(e.target.value as PriceRange)}
            >
              {(Object.keys(priceRangeLabels) as PriceRange[]).map((range) => (
                <option key={range} value={range}>
                  {priceRangeLabels[range]}
                </option>
              ))}
            </select>

            {/* On Sale Toggle */}
            <label className="cursor-pointer label gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={showOnSaleOnly}
                onChange={(e) => setShowOnSaleOnly(e.target.checked)}
              />
              <span className="label-text">On Sale</span>
            </label>

            {/* Clear Filters Button */}
            {hasActiveFilters && (
              <button className="btn btn-ghost btn-sm text-error" onClick={clearFilters}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 mr-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
                Clear Filters
              </button>
            )}
          </div>

          <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
        </div>

        {/* Results Count */}
        <div className="mb-4 text-sm text-base-content/60">
          Showing {sortedItems.length} of {mockStoreItems.length} items
          {hasActiveFilters && ' (filtered)'}
        </div>

        {/* Store Items - Dynamic View */}
        {sortedItems.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">
              <svg
                className="w-24 h-24 mx-auto text-base-content/30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-base-content/70 mb-2">No items found</h3>
            <p className="text-base-content/50 mb-4">
              Try adjusting your search or filter criteria
            </p>
            <button className="btn btn-primary" onClick={clearFilters}>
              Clear All Filters
            </button>
          </div>
        ) : (
          <>
            {viewMode === 'grid' && <ItemGridView items={sortedItems} renderCard={renderCard} />}
            {viewMode === 'detailed' && (
              <ItemDetailedView
                items={sortedItems}
                renderRow={renderDetailedRow}
                renderHeader={renderHeader}
              />
            )}
            {viewMode === 'minimal' && (
              <ItemMinimalView
                items={sortedItems}
                renderRow={renderMinimalRow}
                renderHeader={renderHeader}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
