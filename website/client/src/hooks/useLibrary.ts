import { useState, useCallback, useMemo } from 'react';
import type { LibraryItem, Collection, LibraryFilter, SortField, SortDirection, LibraryPreferences } from '@/types/library';

const STORAGE_KEY = 'library-preferences';

// Load preferences from localStorage
function loadPreferences(): LibraryPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load library preferences:', e);
  }
  return {
    favorites: [],
    collections: [],
    itemCollections: {},
  };
}

// Save preferences to localStorage
function savePreferences(prefs: LibraryPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save library preferences:', e);
  }
}

export function useLibrary(items: LibraryItem[]) {
  const [preferences, setPreferences] = useState<LibraryPreferences>(loadPreferences);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(12);

  // Update preferences and persist to localStorage
  const updatePreferences = useCallback((updater: (prev: LibraryPreferences) => LibraryPreferences) => {
    setPreferences(prev => {
      const next = updater(prev);
      savePreferences(next);
      return next;
    });
  }, []);

  // Toggle favorite status for an item
  const toggleFavorite = useCallback((itemId: number) => {
    updatePreferences(prev => {
      const newFavorites = prev.favorites.includes(itemId)
        ? prev.favorites.filter(id => id !== itemId)
        : [...prev.favorites, itemId];
      return { ...prev, favorites: newFavorites };
    });
  }, [updatePreferences]);

  // Check if an item is favorited
  const isFavorite = useCallback((itemId: number) => {
    return preferences.favorites.includes(itemId);
  }, [preferences.favorites]);

  // Create a new collection
  const createCollection = useCallback((name: string, color?: string) => {
    const newCollection: Collection = {
      id: Date.now(),
      name,
      color,
      createdAt: new Date().toISOString(),
    };
    updatePreferences(prev => ({
      ...prev,
      collections: [...prev.collections, newCollection],
    }));
    return newCollection;
  }, [updatePreferences]);

  // Delete a collection
  const deleteCollection = useCallback((collectionId: number) => {
    updatePreferences(prev => {
      const newItemCollections = { ...prev.itemCollections };
      // Remove this collection from all items
      Object.keys(newItemCollections).forEach(itemId => {
        newItemCollections[Number(itemId)] = newItemCollections[Number(itemId)].filter(
          id => id !== collectionId
        );
      });
      return {
        ...prev,
        collections: prev.collections.filter(c => c.id !== collectionId),
        itemCollections: newItemCollections,
      };
    });
  }, [updatePreferences]);

  // Rename a collection
  const renameCollection = useCallback((collectionId: number, newName: string) => {
    updatePreferences(prev => ({
      ...prev,
      collections: prev.collections.map(c =>
        c.id === collectionId ? { ...c, name: newName } : c
      ),
    }));
  }, [updatePreferences]);

  // Add item to collection
  const addToCollection = useCallback((itemId: number, collectionId: number) => {
    updatePreferences(prev => {
      const currentCollections = prev.itemCollections[itemId] || [];
      if (currentCollections.includes(collectionId)) {
        return prev;
      }
      return {
        ...prev,
        itemCollections: {
          ...prev.itemCollections,
          [itemId]: [...currentCollections, collectionId],
        },
      };
    });
  }, [updatePreferences]);

  // Remove item from collection
  const removeFromCollection = useCallback((itemId: number, collectionId: number) => {
    updatePreferences(prev => {
      const currentCollections = prev.itemCollections[itemId] || [];
      return {
        ...prev,
        itemCollections: {
          ...prev.itemCollections,
          [itemId]: currentCollections.filter(id => id !== collectionId),
        },
      };
    });
  }, [updatePreferences]);

  // Get collections for an item
  const getItemCollections = useCallback((itemId: number): Collection[] => {
    const collectionIds = preferences.itemCollections[itemId] || [];
    return preferences.collections.filter(c => collectionIds.includes(c.id));
  }, [preferences.collections, preferences.itemCollections]);

  // Handle sort click with cycling through asc -> desc -> none
  const handleSort = useCallback((field: Exclude<SortField, null>) => {
    if (sortField === field) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortField(null);
        setSortDirection(null);
      }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to first page when sorting changes
  }, [sortField, sortDirection]);

  // Enhance items with favorite status
  const enhancedItems = useMemo(() => {
    return items.map(item => ({
      ...item,
      isFavorite: preferences.favorites.includes(item.id),
      collectionIds: preferences.itemCollections[item.id] || [],
    }));
  }, [items, preferences.favorites, preferences.itemCollections]);

  // Filter items based on selected filter and collection
  const filteredItems = useMemo(() => {
    let result = enhancedItems;

    // Apply collection filter first if selected
    if (selectedCollection !== null) {
      result = result.filter(item =>
        (preferences.itemCollections[item.id] || []).includes(selectedCollection)
      );
    }

    // Apply category filter
    switch (filter) {
      case 'favorites':
        result = result.filter(item => item.isFavorite);
        break;
      case 'recently-added':
        result = [...result].sort((a, b) =>
          new Date(b.purchasedDate).getTime() - new Date(a.purchasedDate).getTime()
        );
        break;
      case 'recently-played':
        result = [...result]
          .filter(item => item.lastPlayedDate)
          .sort((a, b) =>
            new Date(b.lastPlayedDate || 0).getTime() - new Date(a.lastPlayedDate || 0).getTime()
          );
        break;
      case 'most-used':
        result = [...result].sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
        break;
      case 'wishlisted':
        result = result.filter(item => item.isWishlisted);
        break;
      default:
        // 'all' - no additional filtering
        break;
    }

    return result;
  }, [enhancedItems, filter, selectedCollection, preferences.itemCollections]);

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
          const priceA = parseFloat(a.price.replace('$', '')) || 0;
          const priceB = parseFloat(b.price.replace('$', '')) || 0;
          comparison = priceA - priceB;
          break;
        case 'purchasedDate':
          comparison = new Date(a.purchasedDate).getTime() - new Date(b.purchasedDate).getTime();
          break;
        case 'lastPlayedDate':
          const dateA = a.lastPlayedDate ? new Date(a.lastPlayedDate).getTime() : 0;
          const dateB = b.lastPlayedDate ? new Date(b.lastPlayedDate).getTime() : 0;
          comparison = dateA - dateB;
          break;
        case 'playCount':
          comparison = (a.playCount || 0) - (b.playCount || 0);
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return sortedItems.slice(start, end);
  }, [sortedItems, currentPage, itemsPerPage]);

  // Change filter and reset page
  const changeFilter = useCallback((newFilter: LibraryFilter) => {
    setFilter(newFilter);
    setCurrentPage(1);
  }, []);

  // Select collection and reset page
  const selectCollection = useCallback((collectionId: number | null) => {
    setSelectedCollection(collectionId);
    setCurrentPage(1);
  }, []);

  return {
    // Items
    items: paginatedItems,
    totalItems: sortedItems.length,
    allItems: sortedItems,

    // Filtering
    filter,
    setFilter: changeFilter,
    selectedCollection,
    setSelectedCollection: selectCollection,

    // Sorting
    sortField,
    sortDirection,
    handleSort,

    // Pagination
    currentPage,
    setCurrentPage,
    totalPages,
    itemsPerPage,
    setItemsPerPage,

    // Favorites
    toggleFavorite,
    isFavorite,

    // Collections
    collections: preferences.collections,
    createCollection,
    deleteCollection,
    renameCollection,
    addToCollection,
    removeFromCollection,
    getItemCollections,
  };
}
