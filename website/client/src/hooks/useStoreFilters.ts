import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  StoreItem,
  StoreCategory,
  StoreGenre,
  PriceRange,
  StoreSortField,
  SortDirection,
} from '@/types/store';

export interface StoreFilterState {
  searchQuery: string;
  selectedCategory: StoreCategory | 'all';
  selectedGenre: StoreGenre | 'all';
  selectedPriceRange: PriceRange;
  showOnSaleOnly: boolean;
  sortField: StoreSortField;
  sortDirection: SortDirection;
}

export interface ActiveFilter {
  type: 'search' | 'category' | 'genre' | 'priceRange' | 'onSale';
  label: string;
  value: string;
}

export interface UseStoreFiltersReturn {
  // Filter state
  searchQuery: string;
  debouncedSearchQuery: string;
  selectedCategory: StoreCategory | 'all';
  selectedGenre: StoreGenre | 'all';
  selectedPriceRange: PriceRange;
  showOnSaleOnly: boolean;

  // Sort state
  sortField: StoreSortField;
  sortDirection: SortDirection;

  // Computed state
  filteredItems: StoreItem[];
  sortedItems: StoreItem[];
  hasActiveFilters: boolean;
  activeFilters: ActiveFilter[];

  // Actions
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: StoreCategory | 'all') => void;
  setSelectedGenre: (genre: StoreGenre | 'all') => void;
  setSelectedPriceRange: (priceRange: PriceRange) => void;
  setShowOnSaleOnly: (showOnSale: boolean) => void;
  handleSort: (field: Exclude<StoreSortField, null>) => void;
  clearFilters: () => void;
  clearFilter: (type: ActiveFilter['type']) => void;
}

// Label mappings for active filter display
const categoryLabels: Record<StoreCategory | 'all', string> = {
  all: 'All Categories',
  games: 'Games',
  tools: 'Tools',
  assets: 'Assets',
  templates: 'Templates',
  plugins: 'Plugins',
  audio: 'Audio',
  other: 'Other',
};

const genreLabels: Record<StoreGenre | 'all', string> = {
  all: 'All Genres',
  action: 'Action',
  adventure: 'Adventure',
  puzzle: 'Puzzle',
  racing: 'Racing',
  strategy: 'Strategy',
  simulation: 'Simulation',
  rpg: 'RPG',
  platformer: 'Platformer',
  shooter: 'Shooter',
  sports: 'Sports',
  casual: 'Casual',
  educational: 'Educational',
  other: 'Other',
};

const priceRangeLabels: Record<PriceRange, string> = {
  all: 'All Prices',
  free: 'Free',
  under5: 'Under $5',
  under10: 'Under $10',
  under25: 'Under $25',
  under50: 'Under $50',
  over50: 'Over $50',
};

// Custom hook for debouncing values
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Custom hook for managing store search and filter state.
 * Implements filtering and sorting logic for the store catalog.
 * As per SPEC.md Section 3.3 - Search & Filtering.
 *
 * Features:
 * - URL query parameter synchronization for bookmarkable searches
 * - Debounced search for improved performance
 * - Active filter tracking for clear display
 *
 * @param items - Array of store items to filter and sort
 * @returns Filter state, computed results, and actions
 */
export function useStoreFilters(items: StoreItem[]): UseStoreFiltersReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const isInitialMount = useRef(true);

  // Initialize state from URL params or defaults
  const getInitialCategory = (): StoreCategory | 'all' => {
    const param = searchParams.get('category');
    if (param && param in categoryLabels) {
      return param as StoreCategory | 'all';
    }
    return 'all';
  };

  const getInitialGenre = (): StoreGenre | 'all' => {
    const param = searchParams.get('genre');
    if (param && param in genreLabels) {
      return param as StoreGenre | 'all';
    }
    return 'all';
  };

  const getInitialPriceRange = (): PriceRange => {
    const param = searchParams.get('price');
    if (param && param in priceRangeLabels) {
      return param as PriceRange;
    }
    return 'all';
  };

  // Search and filter state
  const [searchQuery, setSearchQueryInternal] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategoryInternal] = useState<StoreCategory | 'all'>(getInitialCategory);
  const [selectedGenre, setSelectedGenreInternal] = useState<StoreGenre | 'all'>(getInitialGenre);
  const [selectedPriceRange, setSelectedPriceRangeInternal] = useState<PriceRange>(getInitialPriceRange);
  const [showOnSaleOnly, setShowOnSaleOnlyInternal] = useState(searchParams.get('sale') === 'true');

  // Sort state
  const [sortField, setSortField] = useState<StoreSortField>(
    (searchParams.get('sortBy') as StoreSortField) || null
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    (searchParams.get('sortDir') as SortDirection) || null
  );

  // Debounced search query for filtering (300ms delay)
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Sync state changes to URL params
  useEffect(() => {
    // Skip the initial mount to avoid overwriting URL params
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const params = new URLSearchParams();

    if (searchQuery) {
      params.set('q', searchQuery);
    }
    if (selectedCategory !== 'all') {
      params.set('category', selectedCategory);
    }
    if (selectedGenre !== 'all') {
      params.set('genre', selectedGenre);
    }
    if (selectedPriceRange !== 'all') {
      params.set('price', selectedPriceRange);
    }
    if (showOnSaleOnly) {
      params.set('sale', 'true');
    }
    if (sortField) {
      params.set('sortBy', sortField);
    }
    if (sortDirection) {
      params.set('sortDir', sortDirection);
    }

    // Update URL without triggering navigation
    setSearchParams(params, { replace: true });
  }, [searchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly, sortField, sortDirection, setSearchParams]);

  // Filter items based on search and filters (use debounced search query)
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search filter - searches across multiple fields (using debounced value)
      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
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
  }, [items, debouncedSearchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly]);

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

  // Handle sort click - cycles through asc -> desc -> none
  const handleSort = useCallback((field: Exclude<StoreSortField, null>) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((currentDirection) => {
          if (currentDirection === 'asc') {
            return 'desc';
          } else if (currentDirection === 'desc') {
            return null;
          }
          return 'asc';
        });
        return currentField;
      } else {
        setSortDirection('asc');
        return field;
      }
    });
  }, []);

  // Wrapper functions to update state
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryInternal(query);
  }, []);

  const setSelectedCategory = useCallback((category: StoreCategory | 'all') => {
    setSelectedCategoryInternal(category);
  }, []);

  const setSelectedGenre = useCallback((genre: StoreGenre | 'all') => {
    setSelectedGenreInternal(genre);
  }, []);

  const setSelectedPriceRange = useCallback((priceRange: PriceRange) => {
    setSelectedPriceRangeInternal(priceRange);
  }, []);

  const setShowOnSaleOnly = useCallback((showOnSale: boolean) => {
    setShowOnSaleOnlyInternal(showOnSale);
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQueryInternal('');
    setSelectedCategoryInternal('all');
    setSelectedGenreInternal('all');
    setSelectedPriceRangeInternal('all');
    setShowOnSaleOnlyInternal(false);
    setSortField(null);
    setSortDirection(null);
  }, []);

  // Clear a specific filter
  const clearFilter = useCallback((type: ActiveFilter['type']) => {
    switch (type) {
      case 'search':
        setSearchQueryInternal('');
        break;
      case 'category':
        setSelectedCategoryInternal('all');
        break;
      case 'genre':
        setSelectedGenreInternal('all');
        break;
      case 'priceRange':
        setSelectedPriceRangeInternal('all');
        break;
      case 'onSale':
        setShowOnSaleOnlyInternal(false);
        break;
    }
  }, []);

  // Check if any filters are active
  const hasActiveFilters =
    searchQuery !== '' ||
    selectedCategory !== 'all' ||
    selectedGenre !== 'all' ||
    selectedPriceRange !== 'all' ||
    showOnSaleOnly;

  // Build list of active filters for display
  const activeFilters = useMemo((): ActiveFilter[] => {
    const filters: ActiveFilter[] = [];

    if (searchQuery) {
      filters.push({
        type: 'search',
        label: 'Search',
        value: searchQuery,
      });
    }

    if (selectedCategory !== 'all') {
      filters.push({
        type: 'category',
        label: 'Category',
        value: categoryLabels[selectedCategory],
      });
    }

    if (selectedGenre !== 'all') {
      filters.push({
        type: 'genre',
        label: 'Genre',
        value: genreLabels[selectedGenre],
      });
    }

    if (selectedPriceRange !== 'all') {
      filters.push({
        type: 'priceRange',
        label: 'Price',
        value: priceRangeLabels[selectedPriceRange],
      });
    }

    if (showOnSaleOnly) {
      filters.push({
        type: 'onSale',
        label: 'On Sale',
        value: 'Yes',
      });
    }

    return filters;
  }, [searchQuery, selectedCategory, selectedGenre, selectedPriceRange, showOnSaleOnly]);

  return {
    // Filter state
    searchQuery,
    debouncedSearchQuery,
    selectedCategory,
    selectedGenre,
    selectedPriceRange,
    showOnSaleOnly,

    // Sort state
    sortField,
    sortDirection,

    // Computed state
    filteredItems,
    sortedItems,
    hasActiveFilters,
    activeFilters,

    // Actions
    setSearchQuery,
    setSelectedCategory,
    setSelectedGenre,
    setSelectedPriceRange,
    setShowOnSaleOnly,
    handleSort,
    clearFilters,
    clearFilter,
  };
}
