import { useState, useCallback, useMemo } from 'react';
import type { WishlistPreferences } from '@/types/store';

const STORAGE_KEY = 'wishlist-preferences';

// Load preferences from localStorage
function loadPreferences(): WishlistPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load wishlist preferences:', e);
  }
  return {
    wishlistedItems: [],
    lastUpdated: new Date().toISOString(),
  };
}

// Save preferences to localStorage
function savePreferences(prefs: WishlistPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.error('Failed to save wishlist preferences:', e);
  }
}

export function useWishlist() {
  const [preferences, setPreferences] = useState<WishlistPreferences>(loadPreferences);

  // Update preferences and persist to localStorage
  const updatePreferences = useCallback((updater: (prev: WishlistPreferences) => WishlistPreferences) => {
    setPreferences(prev => {
      const next = updater(prev);
      savePreferences(next);
      return next;
    });
  }, []);

  // Toggle wishlist status for an item
  const toggleWishlist = useCallback((itemId: number) => {
    updatePreferences(prev => {
      const newWishlistedItems = prev.wishlistedItems.includes(itemId)
        ? prev.wishlistedItems.filter(id => id !== itemId)
        : [...prev.wishlistedItems, itemId];
      return {
        ...prev,
        wishlistedItems: newWishlistedItems,
        lastUpdated: new Date().toISOString(),
      };
    });
  }, [updatePreferences]);

  // Add item to wishlist
  const addToWishlist = useCallback((itemId: number) => {
    updatePreferences(prev => {
      if (prev.wishlistedItems.includes(itemId)) {
        return prev;
      }
      return {
        ...prev,
        wishlistedItems: [...prev.wishlistedItems, itemId],
        lastUpdated: new Date().toISOString(),
      };
    });
  }, [updatePreferences]);

  // Remove item from wishlist
  const removeFromWishlist = useCallback((itemId: number) => {
    updatePreferences(prev => ({
      ...prev,
      wishlistedItems: prev.wishlistedItems.filter(id => id !== itemId),
      lastUpdated: new Date().toISOString(),
    }));
  }, [updatePreferences]);

  // Check if an item is wishlisted
  const isWishlisted = useCallback((itemId: number) => {
    return preferences.wishlistedItems.includes(itemId);
  }, [preferences.wishlistedItems]);

  // Get all wishlisted item IDs
  const wishlistedItems = useMemo(() => {
    return preferences.wishlistedItems;
  }, [preferences.wishlistedItems]);

  // Get wishlist count
  const wishlistCount = useMemo(() => {
    return preferences.wishlistedItems.length;
  }, [preferences.wishlistedItems]);

  // Clear entire wishlist
  const clearWishlist = useCallback(() => {
    updatePreferences(() => ({
      wishlistedItems: [],
      lastUpdated: new Date().toISOString(),
    }));
  }, [updatePreferences]);

  return {
    // Wishlist items
    wishlistedItems,
    wishlistCount,

    // Actions
    toggleWishlist,
    addToWishlist,
    removeFromWishlist,
    clearWishlist,

    // Queries
    isWishlisted,

    // Metadata
    lastUpdated: preferences.lastUpdated,
  };
}
