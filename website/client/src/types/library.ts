// Library item types
export interface LibraryItem {
  id: number;
  title: string;
  description: string;
  price: string;
  thumbnail: string;
  purchasedDate: string;
  lastPlayedDate?: string;
  playCount?: number;
  isFavorite?: boolean;
  collectionIds?: number[];
  isWishlisted?: boolean;
}

// Collection/folder for organizing library items
export interface Collection {
  id: number;
  name: string;
  color?: string;
  createdAt: string;
}

// Filter options for library
export type LibraryFilter =
  | 'all'
  | 'recently-added'
  | 'recently-played'
  | 'most-used'
  | 'favorites'
  | 'wishlisted';

// Sort field options
export type SortField = 'title' | 'price' | 'purchasedDate' | 'lastPlayedDate' | 'playCount' | null;

// Sort direction
export type SortDirection = 'asc' | 'desc' | null;

// Library preferences stored in localStorage
export interface LibraryPreferences {
  favorites: number[]; // Item IDs that are favorited
  collections: Collection[];
  itemCollections: Record<number, number[]>; // Map of itemId to collectionIds
}
