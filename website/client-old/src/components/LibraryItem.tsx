/**
 * LibraryItem Component
 *
 * A unified component for rendering library items across different view modes.
 * Re-exports and combines functionality from LibraryItemCard and LibraryListItem.
 *
 * Implements SPEC.md Sections 4.2-4.4:
 * - Displays item thumbnail, title, description, price
 * - Quick favorite (star) button accessible from any view (SPEC 4.4)
 * - Collection folder management
 * - Launch and details actions
 *
 * Usage:
 * - For grid view: use LibraryItemCard
 * - For list views: use LibraryListItem
 * - For the full view components: import from './library'
 *
 * @see ./library/LibraryItemCard.tsx for grid view implementation
 * @see ./library/LibraryListItem.tsx for list view implementation
 */

import { useNavigate } from 'react-router-dom';
import type { LibraryItem as LibraryItemType, Collection } from '@/types/library';

// Re-export the library item components
export { default as LibraryItemCard } from './library/LibraryItemCard';
export { default as LibraryListItem } from './library/LibraryListItem';

export interface LibraryItemProps {
  item: LibraryItemType;
  viewMode: 'grid' | 'list' | 'compact';
  isFavorite: boolean;
  onToggleFavorite: (itemId: number) => void;
  collections: Collection[];
  itemCollections: Collection[];
  onAddToCollection: (itemId: number, collectionId: number) => void;
  onRemoveFromCollection: (itemId: number, collectionId: number) => void;
  onOpenCollectionModal: () => void;
  collectionMenuOpen: boolean;
  onSetCollectionMenuOpen: (open: boolean) => void;
}

/**
 * LibraryItem - Renders a library item with favorite toggle, collection management,
 * and action buttons. Adapts its layout based on the viewMode prop.
 *
 * Features:
 * - Quick Favorite: Star icon for adding/removing from favorites (SPEC 4.4)
 * - Collection Management: Folder icon to add/remove from collections (SPEC 4.4)
 * - Launch Action: Play button to launch the item
 * - Details Action: Info button to view full item details
 */
export default function LibraryItem({
  item,
  viewMode,
  isFavorite,
  onToggleFavorite,
  collections,
  itemCollections,
  onAddToCollection,
  onRemoveFromCollection,
  onOpenCollectionModal,
  collectionMenuOpen,
  onSetCollectionMenuOpen,
}: LibraryItemProps) {
  const navigate = useNavigate();

  // Render favorite button with star icon
  const renderFavoriteButton = () => {
    const buttonSize = viewMode === 'compact' ? 'btn-xs' : 'btn-sm';
    const iconSize = viewMode === 'compact' ? 'h-4 w-4' : 'h-5 w-5';

    return (
      <button
        className={`btn btn-ghost ${buttonSize} btn-circle`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(item.id);
        }}
        title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`${iconSize} ${isFavorite ? 'text-warning fill-warning' : ''}`}
          viewBox="0 0 24 24"
          fill={isFavorite ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
      </button>
    );
  };

  // Render collection menu with folder icon
  const renderCollectionMenu = () => {
    const buttonSize = viewMode === 'compact' ? 'btn-xs' : 'btn-sm';
    const iconSize = viewMode === 'compact' ? 'h-4 w-4' : 'h-5 w-5';

    return (
      <div className="relative">
        <button
          className={`btn btn-ghost ${buttonSize} btn-circle`}
          onClick={(e) => {
            e.stopPropagation();
            onSetCollectionMenuOpen(!collectionMenuOpen);
          }}
          title="Add to Collection"
          aria-label="Add to collection"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
            />
          </svg>
        </button>

        {collectionMenuOpen && (
          <div
            className="absolute right-0 top-full mt-1 w-48 bg-base-100 rounded-lg shadow-xl border border-base-300 py-2 z-50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-xs font-semibold text-base-content/60 uppercase">
              Collections
            </div>
            {collections.length === 0 ? (
              <div className="px-3 py-2 text-sm text-base-content/50">No collections yet</div>
            ) : (
              collections.map((collection) => {
                const isInCollection = itemCollections.some((c) => c.id === collection.id);
                return (
                  <button
                    key={collection.id}
                    onClick={() => {
                      if (isInCollection) {
                        onRemoveFromCollection(item.id, collection.id);
                      } else {
                        onAddToCollection(item.id, collection.id);
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-base-200 flex items-center gap-2"
                  >
                    <span
                      className={`w-4 h-4 flex items-center justify-center ${isInCollection ? 'text-success' : 'text-base-content/30'}`}
                    >
                      {isInCollection ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
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
                  onSetCollectionMenuOpen(false);
                  onOpenCollectionModal();
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

  // Render action buttons (launch, details)
  const renderActionButtons = () => {
    const buttonSize = viewMode === 'compact' ? 'btn-xs' : 'btn-sm';
    const iconSize = viewMode === 'compact' ? 'h-4 w-4' : 'h-5 w-5';

    return (
      <>
        <button
          className={`btn btn-ghost ${buttonSize} btn-circle`}
          onClick={(e) => {
            e.stopPropagation();
            console.log('Launch:', item.title);
          }}
          title="Launch"
          aria-label="Launch application"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={iconSize} viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button
          className={`btn btn-ghost ${buttonSize} btn-circle`}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/library/${item.id}`);
          }}
          title="View Details"
          aria-label="View item details"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={iconSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </>
    );
  };

  // Grid view layout
  if (viewMode === 'grid') {
    return (
      <div className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow">
        <figure
          className="relative h-48 overflow-hidden cursor-pointer group"
          onClick={() => navigate(`/library/${item.id}`)}
        >
          <img
            src={item.thumbnail}
            alt={item.title}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-16 w-16 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </div>
          <div className="absolute top-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
            {renderFavoriteButton()}
          </div>
        </figure>
        <div className="card-body p-4">
          <h2 className="card-title text-lg">{item.title}</h2>
          <p className="text-sm text-base-content/70 line-clamp-2 mb-2">{item.description}</p>
          <div className="flex items-center justify-between">
            <span className="text-sm text-success font-semibold">Owned</span>
            <div className="flex gap-2">
              {renderCollectionMenu()}
              {renderActionButtons()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Compact list view layout
  if (viewMode === 'compact') {
    return (
      <div
        className="flex items-center gap-4 p-3 bg-base-100 rounded hover:bg-base-200 transition-colors cursor-pointer"
        onClick={() => navigate(`/library/${item.id}`)}
      >
        <img src={item.thumbnail} alt={item.title} className="w-10 h-10 object-cover rounded flex-shrink-0" />
        <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
          {renderFavoriteButton()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-base-content truncate">{item.title}</h3>
        </div>
        <div className="hidden sm:block w-16 text-xs text-base-content/60 text-center">{item.playCount ?? 0}</div>
        <div className="hidden sm:block w-20 text-xs text-base-content/60">{item.price}</div>
        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {renderCollectionMenu()}
          {renderActionButtons()}
        </div>
      </div>
    );
  }

  // Default list view layout
  return (
    <div
      className="flex flex-col md:flex-row items-start md:items-center gap-4 p-4 bg-base-100 rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
      onClick={() => navigate(`/library/${item.id}`)}
    >
      <img src={item.thumbnail} alt={item.title} className="w-full md:w-24 h-48 md:h-24 object-cover rounded" />
      <div className="hidden md:block" onClick={(e) => e.stopPropagation()}>
        {renderFavoriteButton()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
          <div className="md:hidden" onClick={(e) => e.stopPropagation()}>
            {renderFavoriteButton()}
          </div>
        </div>
        <p className="text-sm text-base-content/70 mt-1 line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-success font-semibold">Owned</span>
        </div>
        <div className="flex flex-wrap gap-4 mt-2 text-xs text-base-content/60 md:hidden">
          <span>Added: {new Date(item.purchasedDate).toLocaleDateString()}</span>
          {item.lastPlayedDate && <span>Last played: {new Date(item.lastPlayedDate).toLocaleDateString()}</span>}
          <span>{item.price}</span>
        </div>
      </div>
      <div className="hidden md:block w-32 text-sm text-base-content/60">
        {new Date(item.purchasedDate).toLocaleDateString()}
      </div>
      <div className="hidden md:block w-32 text-sm text-base-content/60">
        {item.lastPlayedDate ? new Date(item.lastPlayedDate).toLocaleDateString() : '-'}
      </div>
      <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
        <div className="hidden md:block text-lg font-semibold text-base-content/60 w-24">{item.price}</div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {renderCollectionMenu()}
          {renderActionButtons()}
        </div>
      </div>
    </div>
  );
}
