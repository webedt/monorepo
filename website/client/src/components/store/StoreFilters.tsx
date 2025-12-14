import type { StoreCategory, StoreGenre, PriceRange, StoreSortField, SortDirection } from '@/types/store';
import { categoryLabels, genreLabels, priceRangeLabels } from '@/types/store';
import SearchBar from './SearchBar';
import FilterDropdown from './FilterDropdown';

interface StoreFiltersProps {
  // Search state
  searchQuery: string;
  onSearchChange: (query: string) => void;

  // Category filter
  selectedCategory: StoreCategory | 'all';
  onCategoryChange: (category: StoreCategory | 'all') => void;

  // Genre filter
  selectedGenre: StoreGenre | 'all';
  onGenreChange: (genre: StoreGenre | 'all') => void;

  // Price range filter
  selectedPriceRange: PriceRange;
  onPriceRangeChange: (priceRange: PriceRange) => void;

  // On sale filter
  showOnSaleOnly: boolean;
  onShowOnSaleChange: (showOnSale: boolean) => void;

  // Sort state (optional)
  sortField?: StoreSortField;
  sortDirection?: SortDirection;
  onSort?: (field: Exclude<StoreSortField, null>) => void;

  // Clear filters
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  // Results info
  filteredCount: number;
  totalCount: number;

  // Additional content (e.g., view toggle)
  rightContent?: React.ReactNode;
}

/**
 * StoreFilters - Combined filter controls component for the store.
 * Implements search and filtering from SPEC.md Section 3.3.
 * Combines search bar, filter dropdowns, and clear filters functionality.
 */
export default function StoreFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedGenre,
  onGenreChange,
  selectedPriceRange,
  onPriceRangeChange,
  showOnSaleOnly,
  onShowOnSaleChange,
  sortField,
  sortDirection,
  onSort,
  hasActiveFilters,
  onClearFilters,
  filteredCount,
  totalCount,
  rightContent,
}: StoreFiltersProps) {
  // Render sort icon for sort buttons
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

  return (
    <div className="space-y-4">
      {/* Search Box */}
      <SearchBar value={searchQuery} onChange={onSearchChange} />

      {/* Filter Dropdowns and Controls */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Category Dropdown */}
          <FilterDropdown
            value={selectedCategory}
            onChange={onCategoryChange}
            options={categoryLabels}
            ariaLabel="Filter by category"
          />

          {/* Genre Dropdown */}
          <FilterDropdown
            value={selectedGenre}
            onChange={onGenreChange}
            options={genreLabels}
            ariaLabel="Filter by genre"
          />

          {/* Price Range Dropdown */}
          <FilterDropdown
            value={selectedPriceRange}
            onChange={onPriceRangeChange}
            options={priceRangeLabels}
            ariaLabel="Filter by price range"
          />

          {/* On Sale Toggle */}
          <label className="cursor-pointer label gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={showOnSaleOnly}
              onChange={(e) => onShowOnSaleChange(e.target.checked)}
              aria-label="Show only items on sale"
            />
            <span className="label-text">On Sale</span>
          </label>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              className="btn btn-ghost btn-sm text-error"
              onClick={onClearFilters}
              aria-label="Clear all filters"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4 mr-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
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

        {/* Right side content (e.g., view toggle) */}
        {rightContent}
      </div>

      {/* Sort Options (optional) */}
      {onSort && (
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={() => onSort('releaseDate')}
            className={`btn btn-xs ${sortField === 'releaseDate' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by release date"
          >
            Release Date {renderSortIcon('releaseDate')}
          </button>
          <button
            onClick={() => onSort('rating')}
            className={`btn btn-xs ${sortField === 'rating' ? 'btn-accent' : 'btn-ghost'} flex items-center gap-1`}
            aria-label="Sort by rating"
          >
            Rating {renderSortIcon('rating')}
          </button>
        </div>
      )}

      {/* Results Count */}
      <div className="text-sm text-base-content/60">
        Showing {filteredCount} of {totalCount} items
        {hasActiveFilters && ' (filtered)'}
      </div>
    </div>
  );
}
