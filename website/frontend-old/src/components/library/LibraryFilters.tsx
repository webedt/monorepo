import type { LibraryFilter, Collection, SortField, SortDirection } from '@/types/library';

// Filter label mapping as per SPEC.md Section 4.3
const filterLabels: Record<LibraryFilter, string> = {
  'all': 'All Items',
  'recently-added': 'Recently Added',
  'recently-played': 'Recently Played',
  'most-used': 'Most Used',
  'favorites': 'Favorites',
  'wishlisted': 'Wishlisted',
};

interface LibraryFiltersProps {
  // Filter state
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;

  // Collection state
  selectedCollection: number | null;
  onCollectionChange: (collectionId: number | null) => void;
  collections: Collection[];
  onCreateCollection: () => void;
  onDeleteCollection: (collectionId: number) => void;

  // Sort state
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: Exclude<SortField, null>) => void;

  // Results info
  totalItems: number;
  displayedItems: number;
}

/**
 * LibraryFilters - Filter and sorting controls for the library page.
 * Implements filtering options from SPEC.md Section 4.3.
 */
export default function LibraryFilters({
  filter,
  onFilterChange,
  selectedCollection,
  onCollectionChange,
  collections,
  onCreateCollection,
  onDeleteCollection,
  sortField,
  sortDirection,
  onSort,
  totalItems,
  displayedItems,
}: LibraryFiltersProps) {

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

  return (
    <div className="space-y-4">
      {/* Category filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(filterLabels) as LibraryFilter[]).map((filterKey) => (
          <button
            key={filterKey}
            onClick={() => onFilterChange(filterKey)}
            className={`btn btn-sm ${
              filter === filterKey ? 'btn-primary' : 'btn-ghost'
            }`}
            aria-pressed={filter === filterKey}
          >
            {filterLabels[filterKey]}
          </button>
        ))}
      </div>

      {/* Collections row - By collection/folder filter */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-base-content/60">Collections:</span>
        <button
          onClick={() => onCollectionChange(null)}
          className={`btn btn-xs ${selectedCollection === null ? 'btn-secondary' : 'btn-ghost'}`}
          aria-pressed={selectedCollection === null}
        >
          All
        </button>
        {collections.map((collection) => (
          <div key={collection.id} className="relative group">
            <button
              onClick={() => onCollectionChange(collection.id)}
              className={`btn btn-xs ${selectedCollection === collection.id ? 'btn-secondary' : 'btn-ghost'}`}
              aria-pressed={selectedCollection === collection.id}
            >
              {collection.name}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete collection "${collection.name}"?`)) {
                  onDeleteCollection(collection.id);
                  if (selectedCollection === collection.id) {
                    onCollectionChange(null);
                  }
                }
              }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-error text-error-content rounded-full text-xs hidden group-hover:flex items-center justify-center"
              title="Delete collection"
              aria-label={`Delete ${collection.name} collection`}
            >
              x
            </button>
          </div>
        ))}
        <button
          onClick={onCreateCollection}
          className="btn btn-xs btn-ghost text-primary"
          aria-label="Create new collection"
        >
          + New
        </button>
      </div>

      {/* Sort options and results count */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Sort buttons */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-base-content/60">Sort by:</span>
          <button
            onClick={() => onSort('title')}
            className={`btn btn-xs ${sortField === 'title' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by title"
          >
            Title {renderSortIcon('title')}
          </button>
          <button
            onClick={() => onSort('price')}
            className={`btn btn-xs ${sortField === 'price' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by price"
          >
            Price {renderSortIcon('price')}
          </button>
          <button
            onClick={() => onSort('purchasedDate')}
            className={`btn btn-xs ${sortField === 'purchasedDate' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by date added"
          >
            Date Added {renderSortIcon('purchasedDate')}
          </button>
          <button
            onClick={() => onSort('playCount')}
            className={`btn btn-xs ${sortField === 'playCount' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by play count"
          >
            Play Count {renderSortIcon('playCount')}
          </button>
        </div>

        {/* Results count */}
        <div className="text-sm text-base-content/60">
          Showing {displayedItems} of {totalItems} items
        </div>
      </div>
    </div>
  );
}
