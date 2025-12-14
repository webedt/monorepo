import { useState, useCallback, useMemo } from 'react';
import type {
  StoreItem,
  StoreCategory,
  StoreGenre,
  PriceRange,
  StoreSortField,
  SortDirection,
} from '@/types/store';

const STORAGE_KEY = 'store-filter-preferences';

export interface StoreFilterState {
  searchQuery: string;
  selectedCategory: StoreCategory | 'all';
  selectedGenre: StoreGenre | 'all';
  selectedPriceRange: PriceRange;
  showOnSaleOnly: boolean;
  sortField: StoreSortField;
  sortDirection: SortDirection;
}

const defaultFilterState: StoreFilterState = {
  searchQuery: '',
  selectedCategory: 'all',
  selectedGenre: 'all',
  selectedPriceRange: 'all',
  showOnSaleOnly: false,
  sortField: null,
  sortDirection: null,
};

// Load filter preferences from localStorage
function loadFilterPreferences(): Partial<StoreFilterState> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load store filter preferences:', e);
  }
  return {};
}

// Save filter preferences to localStorage
function saveFilterPreferences(prefs: Partial<StoreFilterState>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save store filter preferences:', e);
  }
}

/**
 * useStoreFilters - Custom hook for managing store search and filter state.
 * Implements filtering logic from SPEC.md Section 3.3.
 *
 * @param items - Array of store items to filter
 * @param persistFilters - Whether to persist filter state to localStorage (default: false)
 */
export function useStoreFilters(items: StoreItem[], persistFilters: boolean = false) {
  // Initialize state with saved preferences if persistence is enabled
  const initialState = persistFilters
    ? { ...defaultFilterState, ...loadFilterPreferences() }
    : defaultFilterState;

  const [searchQuery, setSearchQuery] = useState(initialState.searchQuery);
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory | 'all'>(
    initialState.selectedCategory
  );
  const [selectedGenre, setSelectedGenre] = useState<StoreGenre | 'all'>(
    initialState.selectedGenre
  );
  const [selectedPriceRange, setSelectedPriceRange] = useState<PriceRange>(
    initialState.selectedPriceRange
  );
  const [showOnSaleOnly, setShowOnSaleOnly] = useState(initialState.showOnSaleOnly);
  const [sortField, setSortField] = useState<StoreSortField>(initialState.sortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialState.sortDirection);

  // Persist filters to localStorage when they change
  const persistState = useCallback(
    (state: Partial<StoreFilterState>) => {
      if (persistFilters) {
        saveFilterPreferences(state);
      }
    },
    [persistFilters]
  );

  // Update search query
  const updateSearchQuery = useCallback(
    (query: string) => {
      setSearchQuery(query);
      persistState({ searchQuery: query });
    },
    [persistState]
  );

  // Update category filter
  const updateCategory = useCallback(
    (category: StoreCategory | 'all') => {
      setSelectedCategory(category);
      persistState({ selectedCategory: category });
    },
    [persistState]
  );

  // Update genre filter
  const updateGenre = useCallback(
    (genre: StoreGenre | 'all') => {
      setSelectedGenre(genre);
      persistState({ selectedGenre: genre });
    },
    [persistState]
  );

  // Update price range filter
  const updatePriceRange = useCallback(
    (priceRange: PriceRange) => {
      setSelectedPriceRange(priceRange);
      persistState({ selectedPriceRange: priceRange });
    },
    [persistState]
  );

  // Update on sale filter
  const updateShowOnSaleOnly = useCallback(
    (showOnSale: boolean) => {
      setShowOnSaleOnly(showOnSale);
      persistState({ showOnSaleOnly: showOnSale });
    },
    [persistState]
  );

  // Handle sort click with cycling through asc -> desc -> none
  const handleSort = useCallback(
    (field: Exclude<StoreSortField, null>) => {
      let newSortField: StoreSortField = field;
      let newSortDirection: SortDirection = 'asc';

      if (sortField === field) {
        if (sortDirection === 'asc') {
          newSortDirection = 'desc';
        } else if (sortDirection === 'desc') {
          newSortField = null;
          newSortDirection = null;
        }
      }

      setSortField(newSortField);
      setSortDirection(newSortDirection);
      persistState({ sortField: newSortField, sortDirection: newSortDirection });
    },
    [sortField, sortDirection, persistState]
  );

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedGenre('all');
    setSelectedPriceRange('all');
    setShowOnSaleOnly(false);
    setSortField(null);
    setSortDirection(null);

    if (persistFilters) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [persistFilters]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return (
      searchQuery !== '' ||
      selectedCategory !== 'all' ||
      selectedGenre !== 'all' ||
      selectedPriceRange !== 'all' ||
      showOnSaleOnly
    );
  }, [searchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly]);

  // Filter items based on search and filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search filter - searches across multiple fields (universal search)
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
  }, [items, searchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly]);

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

  return {
    // Filtered and sorted items
    items: sortedItems,
    filteredCount: sortedItems.length,
    totalCount: items.length,

    // Search state
    searchQuery,
    setSearchQuery: updateSearchQuery,

    // Filter state
    selectedCategory,
    setSelectedCategory: updateCategory,
    selectedGenre,
    setSelectedGenre: updateGenre,
    selectedPriceRange,
    setSelectedPriceRange: updatePriceRange,
    showOnSaleOnly,
    setShowOnSaleOnly: updateShowOnSaleOnly,

    // Sort state
    sortField,
    sortDirection,
    handleSort,

    // Utilities
    hasActiveFilters,
    clearFilters,
  };
}
