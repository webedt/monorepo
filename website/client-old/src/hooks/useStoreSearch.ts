/**
 * useStoreSearch hook - Store search and filtering state management.
 *
 * This hook provides comprehensive search and filtering capabilities for the store,
 * implementing SPEC.md Section 3.3 - Search & Filtering requirements.
 *
 * Features:
 * - Universal search across title, description, tags, creator fields
 * - Category filter (games, tools, assets, templates, plugins, audio, other)
 * - Genre filter (action, adventure, puzzle, racing, strategy, etc.)
 * - Price range filter (free, under $5, under $10, under $25, under $50, over $50)
 * - On-sale filter toggle
 * - URL query parameter synchronization for bookmarkable searches
 * - Debounced search for improved performance (300ms)
 * - Active filter tracking with individual clear buttons
 * - Sort functionality (title, price, release date, rating)
 *
 * @example
 * ```tsx
 * import { useStoreSearch } from '@/hooks/useStoreSearch';
 *
 * function StorePage() {
 *   const {
 *     searchQuery,
 *     setSearchQuery,
 *     selectedCategory,
 *     setSelectedCategory,
 *     sortedItems,
 *     hasActiveFilters,
 *     clearFilters,
 *   } = useStoreSearch(storeItems);
 *
 *   return (
 *     <div>
 *       <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
 *       {sortedItems.map(item => <ItemCard key={item.id} item={item} />)}
 *     </div>
 *   );
 * }
 * ```
 */

// Re-export the useStoreFilters hook as useStoreSearch for consistency with the spec
export { useStoreFilters as useStoreSearch } from './useStoreFilters';

// Also export types for convenience
export type {
  StoreFilterState,
  ActiveFilter,
  UseStoreFiltersReturn as UseStoreSearchReturn,
} from './useStoreFilters';
