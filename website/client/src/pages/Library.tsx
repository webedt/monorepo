import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '@/hooks/useViewMode';
import { useLibrary } from '@/hooks/useLibrary';
import ViewToggle from '@/components/ViewToggle';
import ItemGridView from '@/components/ItemViews/ItemGridView';
import ItemDetailedView from '@/components/ItemViews/ItemDetailedView';
import ItemMinimalView from '@/components/ItemViews/ItemMinimalView';
import type { LibraryItem, LibraryFilter, SortField } from '@/types/library';

// Mock library items - in production these would come from an API
const mockLibraryItems: LibraryItem[] = [
  {
    id: 1,
    title: 'Code Editor Pro',
    description: 'Advanced code editor with syntax highlighting and auto-completion',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-15',
    lastPlayedDate: '2025-12-10',
    playCount: 45,
  },
  {
    id: 3,
    title: 'Project Planner',
    description: 'Manage your projects with powerful planning and tracking tools',
    price: '$18.99',
    thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-10',
    lastPlayedDate: '2025-12-08',
    playCount: 32,
  },
  {
    id: 5,
    title: 'Design Studio',
    description: 'Create stunning mockups and prototypes for your projects',
    price: '$19.99',
    thumbnail: 'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=400&h=300&fit=crop',
    purchasedDate: '2025-11-05',
    lastPlayedDate: '2025-12-12',
    playCount: 67,
  },
  {
    id: 6,
    title: 'Team Chat',
    description: 'Communicate seamlessly with your team in real-time',
    price: '$24.99',
    thumbnail: 'https://images.unsplash.com/photo-1611606063065-ee7946f0787a?w=400&h=300&fit=crop',
    purchasedDate: '2025-10-28',
    lastPlayedDate: '2025-12-11',
    playCount: 89,
  },
  {
    id: 7,
    title: 'Analytics Dashboard',
    description: 'Track and visualize your data with powerful analytics tools',
    price: '$29.99',
    thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=300&fit=crop',
    purchasedDate: '2025-10-15',
    lastPlayedDate: '2025-12-05',
    playCount: 23,
  },
  {
    id: 8,
    title: 'Cloud Storage',
    description: 'Secure cloud storage with automatic sync across all devices',
    price: '$14.99',
    thumbnail: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400&h=300&fit=crop',
    purchasedDate: '2025-09-20',
    lastPlayedDate: '2025-12-01',
    playCount: 15,
  },
  {
    id: 9,
    title: 'Video Editor',
    description: 'Professional video editing with advanced timeline features',
    price: '$39.99',
    thumbnail: 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=300&fit=crop',
    purchasedDate: '2025-09-01',
    playCount: 8,
  },
  {
    id: 10,
    title: 'Music Composer',
    description: 'Create original music with intuitive composition tools',
    price: '$34.99',
    thumbnail: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=400&h=300&fit=crop',
    purchasedDate: '2025-08-15',
    lastPlayedDate: '2025-11-20',
    playCount: 12,
  },
];

// Filter label mapping
const filterLabels: Record<LibraryFilter, string> = {
  'all': 'All',
  'recently-added': 'Recently Added',
  'recently-played': 'Recently Played',
  'most-used': 'Most Used',
  'favorites': 'Favorites',
  'wishlisted': 'Wishlisted',
};

export default function Library() {
  const [viewMode, setViewMode] = useViewMode('library-view');
  const navigate = useNavigate();

  // Use the library hook for all state management
  const {
    items,
    totalItems,
    filter,
    setFilter,
    selectedCollection,
    setSelectedCollection,
    sortField,
    sortDirection,
    handleSort,
    currentPage,
    setCurrentPage,
    totalPages,
    toggleFavorite,
    isFavorite,
    collections,
    createCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    getItemCollections,
  } = useLibrary(mockLibraryItems);

  // State for collection management modal
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [collectionMenuItemId, setCollectionMenuItemId] = useState<number | null>(null);
  const collectionMenuRef = useRef<HTMLDivElement>(null);

  // Close collection menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (collectionMenuRef.current && !collectionMenuRef.current.contains(event.target as Node)) {
        setCollectionMenuItemId(null);
      }
    };

    if (collectionMenuItemId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [collectionMenuItemId]);

  // Handle creating a new collection
  const handleCreateCollection = () => {
    if (newCollectionName.trim()) {
      createCollection(newCollectionName.trim());
      setNewCollectionName('');
      setShowCollectionModal(false);
    }
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

  // Render favorite star button
  const renderFavoriteButton = (itemId: number, size: 'sm' | 'md' = 'md') => {
    const favorited = isFavorite(itemId);
    const sizeClasses = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const btnClasses = size === 'sm' ? 'btn-xs' : 'btn-sm';

    return (
      <button
        className={`btn btn-ghost ${btnClasses} btn-circle`}
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(itemId);
        }}
        title={favorited ? 'Remove from Favorites' : 'Add to Favorites'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`${sizeClasses} ${favorited ? 'text-warning fill-warning' : ''}`}
          viewBox="0 0 24 24"
          fill={favorited ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>
    );
  };

  // Render collection menu button
  const renderCollectionMenu = (itemId: number, size: 'sm' | 'md' = 'md') => {
    const btnClasses = size === 'sm' ? 'btn-xs' : 'btn-sm';
    const sizeClasses = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    const itemCollections = getItemCollections(itemId);

    return (
      <div className="relative">
        <button
          className={`btn btn-ghost ${btnClasses} btn-circle`}
          onClick={(e) => {
            e.stopPropagation();
            setCollectionMenuItemId(collectionMenuItemId === itemId ? null : itemId);
          }}
          title="Add to Collection"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={sizeClasses}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>

        {collectionMenuItemId === itemId && (
          <div
            ref={collectionMenuRef}
            className="absolute right-0 top-full mt-1 w-48 bg-base-100 rounded-lg shadow-xl border border-base-300 py-2 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-xs font-semibold text-base-content/60 uppercase">
              Collections
            </div>
            {collections.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/50">
                No collections yet
              </div>
            ) : (
              collections.map((collection) => {
                const isInCollection = itemCollections.some(c => c.id === collection.id);
                return (
                  <button
                    key={collection.id}
                    onClick={() => {
                      if (isInCollection) {
                        removeFromCollection(itemId, collection.id);
                      } else {
                        addToCollection(itemId, collection.id);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-base-200 flex items-center gap-2"
                  >
                    <span className={`w-4 h-4 flex items-center justify-center ${isInCollection ? 'text-success' : 'text-base-content/30'}`}>
                      {isInCollection ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                    </span>
                    {collection.name}
                  </button>
                );
              })
            )}
            <div className="border-t border-base-300 mt-2 pt-2">
              <button
                onClick={() => {
                  setCollectionMenuItemId(null);
                  setShowCollectionModal(true);
                }}
                className="w-full px-3 py-2 text-sm text-left hover:bg-base-200 flex items-center gap-2 text-primary"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Collection
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Header for list views
  const renderHeader = () => (
    <div className="flex items-center gap-4 px-4 py-3 bg-base-300 rounded-lg font-semibold text-sm mb-2">
      <div className="w-10 h-10"></div> {/* Thumbnail spacer */}
      <div className="w-12"></div> {/* Favorite spacer */}
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
  const renderCard = (item: LibraryItem) => (
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

        {/* Favorite Star - Top Right Corner */}
        <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
          {renderFavoriteButton(item.id)}
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
          <div className="flex gap-2">
            {/* Collection Menu */}
            {renderCollectionMenu(item.id)}

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
  const renderDetailedRow = (item: LibraryItem) => (
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

      {/* Favorite */}
      <div onClick={(e) => e.stopPropagation()}>
        {renderFavoriteButton(item.id)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
        <p className="text-sm text-base-content/70 mt-1">{item.description}</p>
        <p className="text-xs text-success font-semibold mt-2">Owned</p>
      </div>

      {/* Price and Actions */}
      <div className="flex items-center gap-4">
        <div className="text-lg font-semibold text-base-content/60">{item.price}</div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {renderCollectionMenu(item.id)}
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
  const renderMinimalRow = (item: LibraryItem) => (
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

      {/* Favorite */}
      <div onClick={(e) => e.stopPropagation()}>
        {renderFavoriteButton(item.id, 'sm')}
      </div>

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-medium text-base-content truncate">{item.title}</h3>
      </div>

      {/* Price */}
      <div className="text-xs text-base-content/60">{item.price}</div>

      {/* Quick Actions */}
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {renderCollectionMenu(item.id, 'sm')}
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

  // Render pagination controls
  const renderPagination = () => {
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      const maxVisible = 5;

      if (totalPages <= maxVisible) {
        for (let i = 1; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Always show first page
        pages.push(1);

        if (currentPage > 3) {
          pages.push('...');
        }

        // Show pages around current
        for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
          if (!pages.includes(i)) {
            pages.push(i);
          }
        }

        if (currentPage < totalPages - 2) {
          pages.push('...');
        }

        // Always show last page
        if (!pages.includes(totalPages)) {
          pages.push(totalPages);
        }
      }

      return pages;
    };

    return (
      <div className="flex items-center justify-center gap-2 mt-8">
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {getPageNumbers().map((page, index) => (
          typeof page === 'number' ? (
            <button
              key={index}
              className={`btn btn-sm ${currentPage === page ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCurrentPage(page)}
            >
              {page}
            </button>
          ) : (
            <span key={index} className="px-2 text-base-content/50">...</span>
          )
        ))}

        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    );
  };

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

        {/* Filter Tabs, Collections, and View Toggle */}
        <div className="mb-8 space-y-4">
          {/* Main filter row */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            {/* Category Filters */}
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(filterLabels) as LibraryFilter[]).map((filterKey) => (
                <button
                  key={filterKey}
                  onClick={() => setFilter(filterKey)}
                  className={`btn btn-sm ${
                    filter === filterKey ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {filterLabels[filterKey]}
                </button>
              ))}
            </div>

            <ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>

          {/* Collections row */}
          <div className="flex gap-2 items-center flex-wrap">
            <span className="text-sm text-base-content/60">Collections:</span>
            <button
              onClick={() => setSelectedCollection(null)}
              className={`btn btn-xs ${selectedCollection === null ? 'btn-secondary' : 'btn-ghost'}`}
            >
              All
            </button>
            {collections.map((collection) => (
              <div key={collection.id} className="relative group">
                <button
                  onClick={() => setSelectedCollection(collection.id)}
                  className={`btn btn-xs ${selectedCollection === collection.id ? 'btn-secondary' : 'btn-ghost'}`}
                >
                  {collection.name}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete collection "${collection.name}"?`)) {
                      deleteCollection(collection.id);
                      if (selectedCollection === collection.id) {
                        setSelectedCollection(null);
                      }
                    }
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-error text-error-content rounded-full text-xs hidden group-hover:flex items-center justify-center"
                  title="Delete collection"
                >
                  x
                </button>
              </div>
            ))}
            <button
              onClick={() => setShowCollectionModal(true)}
              className="btn btn-xs btn-ghost text-primary"
            >
              + New
            </button>
          </div>

          {/* Results count */}
          <div className="text-sm text-base-content/60">
            Showing {items.length} of {totalItems} items
          </div>
        </div>

        {/* Library Items - Dynamic View */}
        {items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">
              <svg className="w-24 h-24 mx-auto text-base-content/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-base-content/70 mb-2">No items found</h3>
            <p className="text-base-content/50">
              {filter === 'favorites'
                ? 'You have not added any favorites yet. Click the star icon on an item to add it.'
                : selectedCollection !== null
                ? 'No items in this collection yet. Add items using the folder icon.'
                : 'Your library is empty. Visit the Store to purchase items.'}
            </p>
          </div>
        ) : (
          <>
            {viewMode === 'grid' && (
              <ItemGridView items={items} renderCard={renderCard} />
            )}
            {viewMode === 'detailed' && (
              <ItemDetailedView items={items} renderRow={renderDetailedRow} renderHeader={renderHeader} />
            )}
            {viewMode === 'minimal' && (
              <ItemMinimalView items={items} renderRow={renderMinimalRow} renderHeader={renderHeader} />
            )}
          </>
        )}

        {/* Pagination */}
        {renderPagination()}
      </div>

      {/* Create Collection Modal */}
      {showCollectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-4">Create New Collection</h3>
            <input
              type="text"
              placeholder="Collection name"
              className="input input-bordered w-full mb-4"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateCollection();
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setShowCollectionModal(false);
                  setNewCollectionName('');
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateCollection}
                disabled={!newCollectionName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
