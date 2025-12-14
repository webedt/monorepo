import { useState, useRef, useEffect } from 'react';
import { useLibrary } from '@/hooks/useLibrary';
import { useLibraryPreferences } from '@/hooks/useLibraryPreferences';
import {
  LibraryViewSelector,
  LibraryFilters,
} from '@/components/library';
import { GridView, ListView, CompactListView } from '@/components/LibraryViews';
import type { LibraryItem } from '@/types/library';

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

/**
 * Library page component.
 * Implements SPEC.md Sections 4.2, 4.3, and 4.4:
 * - Three view modes: Grid, List, Compact List
 * - Filtering & sorting options
 * - Organization features (favorites, collections)
 */
export default function Library() {
  // Use the library preferences hook for view mode and favorites/collections
  const {
    viewMode,
    setViewMode,
    isFavorite,
    toggleFavorite,
    collections,
    createCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    getItemCollections,
  } = useLibraryPreferences();

  // Use the library hook for filtering, sorting, and pagination
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
          aria-label="Previous page"
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
              aria-label={`Page ${page}`}
              aria-current={currentPage === page ? 'page' : undefined}
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
          aria-label="Next page"
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

        {/* View Selector and Filters */}
        <div className="mb-8 space-y-4">
          {/* Top row - View selector */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <LibraryFilters
              filter={filter}
              onFilterChange={setFilter}
              selectedCollection={selectedCollection}
              onCollectionChange={setSelectedCollection}
              collections={collections}
              onCreateCollection={() => setShowCollectionModal(true)}
              onDeleteCollection={deleteCollection}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              totalItems={totalItems}
              displayedItems={items.length}
            />
            <LibraryViewSelector viewMode={viewMode} onViewModeChange={setViewMode} />
          </div>
        </div>

        {/* Library Items - Dynamic View based on view mode */}
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
            {/* Grid View - Thumbnail-based grid layout (SPEC.md Section 4.2) */}
            {viewMode === 'grid' && (
              <GridView
                items={items}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                collections={collections}
                getItemCollections={getItemCollections}
                onAddToCollection={addToCollection}
                onRemoveFromCollection={removeFromCollection}
                onOpenCollectionModal={() => setShowCollectionModal(true)}
                collectionMenuItemId={collectionMenuItemId}
                onSetCollectionMenuItemId={setCollectionMenuItemId}
                collectionMenuRef={collectionMenuRef}
              />
            )}

            {/* List View - Standard list with more details (SPEC.md Section 4.2) */}
            {viewMode === 'detailed' && (
              <ListView
                items={items}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                collections={collections}
                getItemCollections={getItemCollections}
                onAddToCollection={addToCollection}
                onRemoveFromCollection={removeFromCollection}
                onOpenCollectionModal={() => setShowCollectionModal(true)}
                collectionMenuItemId={collectionMenuItemId}
                onSetCollectionMenuItemId={setCollectionMenuItemId}
                collectionMenuRef={collectionMenuRef}
              />
            )}

            {/* Compact List View - Dense list for power users (SPEC.md Section 4.2) */}
            {viewMode === 'minimal' && (
              <CompactListView
                items={items}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                isFavorite={isFavorite}
                onToggleFavorite={toggleFavorite}
                collections={collections}
                getItemCollections={getItemCollections}
                onAddToCollection={addToCollection}
                onRemoveFromCollection={removeFromCollection}
                onOpenCollectionModal={() => setShowCollectionModal(true)}
                collectionMenuItemId={collectionMenuItemId}
                onSetCollectionMenuItemId={setCollectionMenuItemId}
                collectionMenuRef={collectionMenuRef}
              />
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
