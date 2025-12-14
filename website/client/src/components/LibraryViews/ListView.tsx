import { useNavigate } from 'react-router-dom';
import type { LibraryItem, Collection, SortField, SortDirection } from '@/types/library';
import type { CloudSyncState } from '@/types/cloudServices';
import { CloudSyncIndicatorCompact } from '@/components/library';

export interface ListViewProps {
  items: LibraryItem[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: Exclude<SortField, null>) => void;
  isFavorite: (itemId: number) => boolean;
  onToggleFavorite: (itemId: number) => void;
  collections: Collection[];
  getItemCollections: (itemId: number) => Collection[];
  onAddToCollection: (itemId: number, collectionId: number) => void;
  onRemoveFromCollection: (itemId: number, collectionId: number) => void;
  onOpenCollectionModal: () => void;
  collectionMenuItemId: number | null;
  onSetCollectionMenuItemId: (itemId: number | null) => void;
  collectionMenuRef: React.RefObject<HTMLDivElement>;
  // Cloud sync props (optional, for future integration)
  getCloudSyncState?: (itemId: number) => CloudSyncState;
}

/**
 * ListView - Standard list view with more details for library items.
 * Implements SPEC.md Section 4.2 List View mode.
 */
export default function ListView({
  items,
  sortField,
  sortDirection,
  onSort,
  isFavorite,
  onToggleFavorite,
  collections,
  getItemCollections,
  onAddToCollection,
  onRemoveFromCollection,
  onOpenCollectionModal,
  collectionMenuItemId,
  onSetCollectionMenuItemId,
  collectionMenuRef,
  getCloudSyncState,
}: ListViewProps) {
  const navigate = useNavigate();

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

  const renderFavoriteButton = (item: LibraryItem) => {
    const favorite = isFavorite(item.id);
    return (
      <button
        className="btn btn-ghost btn-sm btn-circle"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(item.id);
        }}
        title={favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-5 w-5 ${favorite ? 'text-warning fill-warning' : ''}`}
          viewBox="0 0 24 24"
          fill={favorite ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      </button>
    );
  };

  const renderCollectionMenu = (item: LibraryItem) => {
    const itemCollectionList = getItemCollections(item.id);

    return (
      <div className="relative">
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={(e) => {
            e.stopPropagation();
            onSetCollectionMenuItemId(collectionMenuItemId === item.id ? null : item.id);
          }}
          title="Add to Collection"
          aria-label="Add to collection"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </button>

        {collectionMenuItemId === item.id && (
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
                const isInCollection = itemCollectionList.some(c => c.id === collection.id);
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
                  onSetCollectionMenuItemId(null);
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

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 bg-base-300 rounded-lg font-semibold text-sm mb-2">
        <div className="w-24 h-24"></div> {/* Thumbnail spacer */}
        <div className="w-12"></div> {/* Favorite spacer */}
        <button
          onClick={() => onSort('title')}
          className="flex-1 flex items-center gap-2 hover:text-primary transition-colors"
        >
          Title
          {renderSortIcon('title')}
        </button>
        <button
          onClick={() => onSort('price')}
          className="flex items-center gap-2 hover:text-primary transition-colors"
        >
          Price
          {renderSortIcon('price')}
        </button>
        <div className="w-32"></div> {/* Actions spacer */}
      </div>

      {/* Items */}
      {items.map((item) => (
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
            {renderFavoriteButton(item)}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-base-content">{item.title}</h3>
            <p className="text-sm text-base-content/70 mt-1">{item.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-success font-semibold">Owned</span>
              {/* Cloud Sync Indicator */}
              {getCloudSyncState && (
                <CloudSyncIndicatorCompact syncState={getCloudSyncState(item.id)} />
              )}
            </div>
          </div>

          {/* Price and Actions */}
          <div className="flex items-center gap-4">
            <div className="text-lg font-semibold text-base-content/60">{item.price}</div>
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              {renderCollectionMenu(item)}
              <button
                className="btn btn-ghost btn-sm btn-circle"
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('Launch:', item.title);
                }}
                title="Launch"
                aria-label="Launch application"
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
                aria-label="View item details"
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
      ))}
    </div>
  );
}
