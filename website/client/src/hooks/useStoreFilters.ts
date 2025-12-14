import { useState, useMemo, useCallback } from 'react';
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

export interface UseStoreFiltersReturn {
  // Filter state
  searchQuery: string;
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

  // Actions
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (category: StoreCategory | 'all') => void;
  setSelectedGenre: (genre: StoreGenre | 'all') => void;
  setSelectedPriceRange: (priceRange: PriceRange) => void;
  setShowOnSaleOnly: (showOnSale: boolean) => void;
  handleSort: (field: Exclude<StoreSortField, null>) => void;
  clearFilters: () => void;
}

/**
 * Custom hook for managing store search and filter state.
 * Implements filtering and sorting logic for the store catalog.
 * As per SPEC.md Section 3.3 - Search & Filtering.
 *
 * @param items - Array of store items to filter and sort
 * @returns Filter state, computed results, and actions
 */
export function useStoreFilters(items: StoreItem[]): UseStoreFiltersReturn {
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory | 'all'>('all');
  const [selectedGenre, setSelectedGenre] = useState<StoreGenre | 'all'>('all');
  const [selectedPriceRange, setSelectedPriceRange] = useState<PriceRange>('all');
  const [showOnSaleOnly, setShowOnSaleOnly] = useState(false);

  // Sort state
  const [sortField, setSortField] = useState<StoreSortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // Filter items based on search and filters
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Search filter - searches across multiple fields
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

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedGenre('all');
    setSelectedPriceRange('all');
    setShowOnSaleOnly(false);
    setSortField(null);
    setSortDirection(null);
  }, []);

  // Check if any filters are active
  const hasActiveFilters =
    searchQuery !== '' ||
    selectedCategory !== 'all' ||
    selectedGenre !== 'all' ||
    selectedPriceRange !== 'all' ||
    showOnSaleOnly;

  return {
    // Filter state
    searchQuery,
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

    // Actions
    setSearchQuery,
    setSelectedCategory,
    setSelectedGenre,
    setSelectedPriceRange,
    setShowOnSaleOnly,
    handleSort,
    clearFilters,
  };
}
