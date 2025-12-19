import SearchBar from './SearchBar';
import FilterDropdown from './FilterDropdown';
import ViewToggle from '@/components/ViewToggle';
import type {
  StoreCategory,
  StoreGenre,
  PriceRange,
} from '@/types/store';
import { categoryLabels, genreLabels, priceRangeLabels } from '@/types/store';
import type { ActiveFilter } from '@/hooks/useStoreFilters';

type ViewMode = 'grid' | 'detailed' | 'minimal';

interface StoreFiltersProps {
  // Search state
  searchQuery: string;
  onSearchChange: (query: string) => void;

  // Filter state
  selectedCategory: StoreCategory | 'all';
  onCategoryChange: (category: StoreCategory | 'all') => void;
  selectedGenre: StoreGenre | 'all';
  onGenreChange: (genre: StoreGenre | 'all') => void;
  selectedPriceRange: PriceRange;
  onPriceRangeChange: (priceRange: PriceRange) => void;
  showOnSaleOnly: boolean;
  onShowOnSaleChange: (showOnSale: boolean) => void;

  // Actions
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  activeFilters?: ActiveFilter[];
  onClearFilter?: (type: ActiveFilter['type']) => void;

  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;

  // Results info
  totalItems: number;
  displayedItems: number;
}

/**
 * StoreFilters component - Combines search and filter controls.
 * Implements SPEC.md Section 3.3 - Search & Filtering:
 * - Universal Search Box
 * - Filter Dropdowns (category, genre, price range)
 * - On Sale toggle
 * - Active filter badges with individual clear buttons
 * - Clear filters functionality
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
  hasActiveFilters,
  onClearFilters,
  activeFilters = [],
  onClearFilter,
  viewMode,
  onViewModeChange,
  totalItems,
  displayedItems,
}: StoreFiltersProps) {
  return (
    <div className="space-y-4">
      {/* Search Box */}
      <SearchBar
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Search games, creators, tags..."
      />

      {/* Filter Dropdowns and View Toggle */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center">
          {/* Category Dropdown */}
          <FilterDropdown<StoreCategory | 'all'>
            value={selectedCategory}
            onChange={onCategoryChange}
            options={categoryLabels}
          />

          {/* Genre Dropdown */}
          <FilterDropdown<StoreGenre | 'all'>
            value={selectedGenre}
            onChange={onGenreChange}
            options={genreLabels}
          />

          {/* Price Range Dropdown */}
          <FilterDropdown<PriceRange>
            value={selectedPriceRange}
            onChange={onPriceRangeChange}
            options={priceRangeLabels}
          />

          {/* On Sale Toggle */}
          <label className="cursor-pointer label gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={showOnSaleOnly}
              onChange={(e) => onShowOnSaleChange(e.target.checked)}
            />
            <span className="label-text">On Sale</span>
          </label>

          {/* Clear All Filters Button */}
          {hasActiveFilters && (
            <button className="btn btn-ghost btn-sm text-error" onClick={onClearFilters}>
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
              Clear All
            </button>
          )}
        </div>

        <ViewToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
      </div>

      {/* Active Filter Badges */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-base-content/60">Active filters:</span>
          {activeFilters.map((filter) => (
            <div
              key={filter.type}
              className="badge badge-lg gap-2 bg-primary/10 border-primary/30"
            >
              <span className="text-xs text-base-content/60">{filter.label}:</span>
              <span className="font-medium truncate max-w-32">{filter.value}</span>
              {onClearFilter && (
                <button
                  className="btn btn-ghost btn-xs btn-circle -mr-1 hover:bg-primary/20"
                  onClick={() => onClearFilter(filter.type)}
                  aria-label={`Clear ${filter.label} filter`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3"
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
          ))}
        </div>
      )}

      {/* Results Count */}
      <div className="text-sm text-base-content/60">
        Showing {displayedItems} of {totalItems} items
        {hasActiveFilters && ' (filtered)'}
      </div>
    </div>
  );
}
