import { useState, useCallback } from 'react';
import type { Collection, LibraryPreferences } from '@/types/library';
import { ViewMode } from '@/hooks/useViewMode';

const STORAGE_KEY = 'library-preferences';
const VIEW_MODE_KEY = 'library-view-mode';

/**
 * Load library preferences from localStorage
 */
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

/**
 * Save library preferences to localStorage
 */
function savePreferences(prefs: LibraryPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save library preferences:', e);
  }
}

/**
 * Load view mode from localStorage
 */
function loadViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored && ['grid', 'detailed', 'minimal'].includes(stored)) {
      return stored as ViewMode;
    }
  } catch (e) {
    console.error('Failed to load view mode:', e);
  }
  return 'grid';
}

/**
 * Save view mode to localStorage
 */
function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch (e) {
    console.error('Failed to save view mode:', e);
  }
}

/**
 * useLibraryPreferences - Hook for managing library user preferences.
 * Persists favorites, collections, and view mode to localStorage.
 *
 * Implements the user preference persistence requirements from SPEC.md Section 4.
 */
export function useLibraryPreferences() {
  const [preferences, setPreferences] = useState<LibraryPreferences>(loadPreferences);
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode);

  // Update preferences and persist to localStorage
  const updatePreferences = useCallback((updater: (prev: LibraryPreferences) => LibraryPreferences) => {
    setPreferences(prev => {
      const next = updater(prev);
      savePreferences(next);
      return next;
    });
  }, []);

  // Set view mode and persist
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    saveViewMode(mode);
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

  // Get item collection IDs
  const getItemCollectionIds = useCallback((itemId: number): number[] => {
    return preferences.itemCollections[itemId] || [];
  }, [preferences.itemCollections]);

  return {
    // View mode
    viewMode,
    setViewMode,

    // Favorites
    favorites: preferences.favorites,
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
    getItemCollectionIds,

    // Raw preferences access
    itemCollections: preferences.itemCollections,
  };
}
