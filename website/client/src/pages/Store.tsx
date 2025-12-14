import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewMode } from '@/hooks/useViewMode';
import { useWishlist } from '@/hooks/useWishlist';
import { useStoreFilters } from '@/hooks/useStoreFilters';
import ViewToggle from '@/components/ViewToggle';
import ItemDetailedView from '@/components/ItemViews/ItemDetailedView';
import ItemMinimalView from '@/components/ItemViews/ItemMinimalView';
import { StoreItemCard, StoreGrid, StoreItemModal, StoreFilters } from '@/components/store';
import { mockStoreItems } from '@/data/mockStoreData';
import type { StoreItem, StoreSortField } from '@/types/store';

export default function Store() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useViewMode('store-view');
  const { isWishlisted, toggleWishlist } = useWishlist();

  // Use the store filters hook for search and filtering
  const {
    items: sortedItems,
    filteredCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    selectedGenre,
    setSelectedGenre,
    selectedPriceRange,
    setSelectedPriceRange,
    showOnSaleOnly,
    setShowOnSaleOnly,
    sortField,
    sortDirection,
    handleSort,
    hasActiveFilters,
    clearFilters,
  } = useStoreFilters(mockStoreItems);

  // Modal state
  const [selectedItem, setSelectedItem] = useState<StoreItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Handle wishlist toggle
  const handleToggleWishlist = (item: StoreItem) => {
    toggleWishlist(item.id);
  };

  // Handle play now
  const handlePlayNow = (item: StoreItem) => {
    console.log('Play Now:', item.title);
    navigate(`/item/${item.id}`);
  };

  // Handle view trailer - opens modal with the item
  const handleViewTrailer = (item: StoreItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  // Handle opening item modal
  const handleOpenModal = useCallback((item: StoreItem) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  }, []);

  // Handle closing modal
  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setSelectedItem(null);
  }, []);

  // Handle navigating between items in modal
  const handleNavigateItem = useCallback((item: StoreItem) => {
    setSelectedItem(item);
  }, []);

  // Handle purchase from modal
  const handlePurchase = useCallback((item: StoreItem) => {
    console.log('Purchase:', item.title, item.price);
    // In production, this would integrate with Stripe/PayPal checkout
  }, []);

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
      onClick={handleOpenModal}
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
        onClick={() => handleOpenModal(item)}
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
        onClick={() => handleOpenModal(item)}
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

  return (
    <div className="min-h-screen bg-base-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-base-content mb-4">Store</h1>
          <p className="text-base-content/70">Browse and discover games in our marketplace</p>
        </div>

        {/* Search and Filters */}
        <div className="mb-6">
          <StoreFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCategory={selectedCategory}
            onCategoryChange={setSelectedCategory}
            selectedGenre={selectedGenre}
            onGenreChange={setSelectedGenre}
            selectedPriceRange={selectedPriceRange}
            onPriceRangeChange={setSelectedPriceRange}
            showOnSaleOnly={showOnSaleOnly}
            onShowOnSaleChange={setShowOnSaleOnly}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            filteredCount={filteredCount}
            totalCount={totalCount}
            rightContent={<ViewToggle viewMode={viewMode} onViewModeChange={setViewMode} />}
          />
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
            {viewMode === 'grid' && <StoreGrid items={sortedItems} renderCard={renderCard} />}
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

      {/* Item Modal */}
      {selectedItem && (
        <StoreItemModal
          item={selectedItem}
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onPurchase={handlePurchase}
          onPlayNow={handlePlayNow}
          isWishlisted={isWishlisted(selectedItem.id)}
          onToggleWishlist={() => handleToggleWishlist(selectedItem)}
          allItems={sortedItems}
          onNavigateItem={handleNavigateItem}
        />
      )}
    </div>
  );
}
