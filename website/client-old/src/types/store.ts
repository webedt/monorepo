// Store item types
export interface StoreItem {
  id: number;
  title: string;
  description: string;
  price: number | null; // null means free
  originalPrice?: number | null; // For showing discounts
  thumbnail: string;
  trailerUrl?: string;
  category: StoreCategory;
  genre: StoreGenre;
  tags: string[];
  creator: string;
  releaseDate: string;
  rating?: number; // 0-5 stars
  reviewCount?: number;
  isOnSale?: boolean;
  salePercentage?: number;
  isFeatured?: boolean;
  isNew?: boolean;
}

// Store categories
export type StoreCategory =
  | 'games'
  | 'tools'
  | 'assets'
  | 'templates'
  | 'plugins'
  | 'audio'
  | 'other';

// Store genres
export type StoreGenre =
  | 'action'
  | 'adventure'
  | 'puzzle'
  | 'racing'
  | 'strategy'
  | 'simulation'
  | 'rpg'
  | 'platformer'
  | 'shooter'
  | 'sports'
  | 'casual'
  | 'educational'
  | 'other';

// Price range filter options
export type PriceRange =
  | 'all'
  | 'free'
  | 'under5'
  | 'under10'
  | 'under25'
  | 'under50'
  | 'over50';

// Sort options
export type StoreSortField = 'title' | 'price' | 'releaseDate' | 'rating' | null;
export type SortDirection = 'asc' | 'desc' | null;

// Filter state
export interface StoreFilters {
  search: string;
  category: StoreCategory | 'all';
  genre: StoreGenre | 'all';
  priceRange: PriceRange;
  showOnSale: boolean;
  showFreeOnly: boolean;
}

// Wishlist preferences stored in localStorage
export interface WishlistPreferences {
  wishlistedItems: number[]; // Item IDs that are wishlisted
  lastUpdated: string;
}

// Category labels for display
export const categoryLabels: Record<StoreCategory | 'all', string> = {
  all: 'All Categories',
  games: 'Games',
  tools: 'Tools',
  assets: 'Assets',
  templates: 'Templates',
  plugins: 'Plugins',
  audio: 'Audio',
  other: 'Other',
};

// Genre labels for display
export const genreLabels: Record<StoreGenre | 'all', string> = {
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

// Price range labels for display
export const priceRangeLabels: Record<PriceRange, string> = {
  all: 'All Prices',
  free: 'Free',
  under5: 'Under $5',
  under10: 'Under $10',
  under25: 'Under $25',
  under50: 'Under $50',
  over50: 'Over $50',
};
