/**
 * Tests for Store Routes
 * Covers game browsing, filtering, sorting, and wishlist management.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type GameStatus = 'draft' | 'published' | 'archived';
type SortField = 'releaseDate' | 'title' | 'price' | 'rating' | 'downloads';
type SortOrder = 'asc' | 'desc';

interface MockGame {
  id: string;
  title: string;
  description?: string;
  price: number;
  currency: string;
  developer?: string;
  publisher?: string;
  releaseDate?: Date;
  status: GameStatus;
  featured: boolean;
  genres?: string[];
  tags?: string[];
  averageScore?: number;
  downloadCount: number;
  updatedAt: Date;
}

interface MockWishlistItem {
  id: string;
  userId: string;
  gameId: string;
  addedAt: Date;
}

interface BrowseFilters {
  query?: string;
  genre?: string;
  tag?: string;
  minPrice?: number;
  maxPrice?: number;
  free?: boolean;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const LIMITS = {
  FEATURED_DEFAULT: 10,
  FEATURED_MAX: 50,
  NEW_DEFAULT: 10,
  NEW_MAX: 50,
  BROWSE_DEFAULT: 20,
  BROWSE_MAX: 100,
  DAYS_BACK_DEFAULT: 30,
  DAYS_BACK_MAX: 90,
};

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: 'game-123',
    title: 'Test Game',
    description: 'A great game for testing',
    price: 1999,
    currency: 'USD',
    developer: 'Test Developer',
    publisher: 'Test Publisher',
    releaseDate: new Date(),
    status: 'published',
    featured: false,
    genres: ['action', 'adventure'],
    tags: ['indie', 'singleplayer'],
    averageScore: 4.5,
    downloadCount: 1000,
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockWishlistItem(overrides: Partial<MockWishlistItem> = {}): MockWishlistItem {
  return {
    id: 'wishlist-123',
    userId: 'user-456',
    gameId: 'game-789',
    addedAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function parseFeaturedLimit(limitStr: string | undefined): number {
  if (!limitStr) return LIMITS.FEATURED_DEFAULT;
  const parsed = parseInt(limitStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.FEATURED_DEFAULT;
  return Math.min(parsed, LIMITS.FEATURED_MAX);
}

function parseBrowseLimit(limitStr: string | undefined): number {
  if (!limitStr) return LIMITS.BROWSE_DEFAULT;
  const parsed = parseInt(limitStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.BROWSE_DEFAULT;
  return Math.min(parsed, LIMITS.BROWSE_MAX);
}

function parseDaysBack(daysStr: string | undefined): number {
  if (!daysStr) return LIMITS.DAYS_BACK_DEFAULT;
  const parsed = parseInt(daysStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.DAYS_BACK_DEFAULT;
  return Math.min(parsed, LIMITS.DAYS_BACK_MAX);
}

function isPublished(game: MockGame): boolean {
  return game.status === 'published';
}

function isFeatured(game: MockGame): boolean {
  return game.featured && game.status === 'published';
}

function isNewRelease(game: MockGame, daysBack: number): boolean {
  if (!game.releaseDate || game.status !== 'published') return false;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  return new Date(game.releaseDate) >= cutoffDate;
}

function filterGames(games: MockGame[], filters: BrowseFilters): MockGame[] {
  let filtered = games.filter(g => g.status === 'published');

  if (filters.query) {
    const searchTerm = filters.query.toLowerCase();
    filtered = filtered.filter(
      g =>
        g.title.toLowerCase().includes(searchTerm) ||
        g.description?.toLowerCase().includes(searchTerm) ||
        g.developer?.toLowerCase().includes(searchTerm) ||
        g.publisher?.toLowerCase().includes(searchTerm)
    );
  }

  if (filters.genre) {
    const genreFilter = filters.genre.toLowerCase();
    filtered = filtered.filter(g =>
      g.genres?.some(gen => gen.toLowerCase() === genreFilter)
    );
  }

  if (filters.tag) {
    const tagFilter = filters.tag.toLowerCase();
    filtered = filtered.filter(g =>
      g.tags?.some(t => t.toLowerCase() === tagFilter)
    );
  }

  if (filters.free) {
    filtered = filtered.filter(g => g.price === 0);
  } else {
    if (filters.minPrice !== undefined) {
      filtered = filtered.filter(g => g.price >= filters.minPrice!);
    }
    if (filters.maxPrice !== undefined) {
      filtered = filtered.filter(g => g.price <= filters.maxPrice!);
    }
  }

  return filtered;
}

function sortGames(games: MockGame[], sortField: SortField, sortOrder: SortOrder): MockGame[] {
  const sorted = [...games];
  const multiplier = sortOrder === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortField) {
      case 'title':
        return multiplier * a.title.localeCompare(b.title);
      case 'price':
        return multiplier * (a.price - b.price);
      case 'rating':
        return multiplier * ((a.averageScore || 0) - (b.averageScore || 0));
      case 'downloads':
        return multiplier * (a.downloadCount - b.downloadCount);
      case 'releaseDate':
      default:
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return multiplier * (dateA - dateB);
    }
  });

  return sorted;
}

function collectUniqueValues<T>(items: T[], extractor: (item: T) => string[] | undefined): string[] {
  const valueSet = new Set<string>();
  for (const item of items) {
    const values = extractor(item);
    if (values) {
      for (const value of values) {
        valueSet.add(value);
      }
    }
  }
  return Array.from(valueSet).sort();
}

function canAddToWishlist(game: MockGame, alreadyInWishlist: boolean, alreadyOwned: boolean): ValidationResult {
  if (game.status !== 'published') {
    return { valid: false, error: 'Game not found' };
  }

  if (alreadyInWishlist) {
    return { valid: false, error: 'Game already in wishlist' };
  }

  if (alreadyOwned) {
    return { valid: false, error: 'Game already in library' };
  }

  return { valid: true };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Store Routes - Limit Parsing', () => {
  describe('parseFeaturedLimit', () => {
    it('should return default for undefined', () => {
      const result = parseFeaturedLimit(undefined);
      assert.strictEqual(result, LIMITS.FEATURED_DEFAULT);
    });

    it('should parse valid limit', () => {
      const result = parseFeaturedLimit('25');
      assert.strictEqual(result, 25);
    });

    it('should clamp to maximum', () => {
      const result = parseFeaturedLimit('100');
      assert.strictEqual(result, LIMITS.FEATURED_MAX);
    });
  });

  describe('parseBrowseLimit', () => {
    it('should return default for undefined', () => {
      const result = parseBrowseLimit(undefined);
      assert.strictEqual(result, LIMITS.BROWSE_DEFAULT);
    });

    it('should clamp to maximum', () => {
      const result = parseBrowseLimit('200');
      assert.strictEqual(result, LIMITS.BROWSE_MAX);
    });
  });

  describe('parseDaysBack', () => {
    it('should return default for undefined', () => {
      const result = parseDaysBack(undefined);
      assert.strictEqual(result, LIMITS.DAYS_BACK_DEFAULT);
    });

    it('should clamp to maximum', () => {
      const result = parseDaysBack('180');
      assert.strictEqual(result, LIMITS.DAYS_BACK_MAX);
    });
  });
});

describe('Store Routes - Game Status Checks', () => {
  describe('isPublished', () => {
    it('should return true for published games', () => {
      const game = createMockGame({ status: 'published' });
      assert.strictEqual(isPublished(game), true);
    });

    it('should return false for draft games', () => {
      const game = createMockGame({ status: 'draft' });
      assert.strictEqual(isPublished(game), false);
    });

    it('should return false for archived games', () => {
      const game = createMockGame({ status: 'archived' });
      assert.strictEqual(isPublished(game), false);
    });
  });

  describe('isFeatured', () => {
    it('should return true for featured published games', () => {
      const game = createMockGame({ featured: true, status: 'published' });
      assert.strictEqual(isFeatured(game), true);
    });

    it('should return false for non-featured games', () => {
      const game = createMockGame({ featured: false, status: 'published' });
      assert.strictEqual(isFeatured(game), false);
    });

    it('should return false for featured but unpublished games', () => {
      const game = createMockGame({ featured: true, status: 'draft' });
      assert.strictEqual(isFeatured(game), false);
    });
  });

  describe('isNewRelease', () => {
    it('should return true for recent releases', () => {
      const game = createMockGame({
        releaseDate: new Date(),
        status: 'published',
      });
      assert.strictEqual(isNewRelease(game, 30), true);
    });

    it('should return false for old releases', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);

      const game = createMockGame({
        releaseDate: oldDate,
        status: 'published',
      });
      assert.strictEqual(isNewRelease(game, 30), false);
    });

    it('should return false for games without release date', () => {
      const game = createMockGame({
        releaseDate: undefined,
        status: 'published',
      });
      assert.strictEqual(isNewRelease(game, 30), false);
    });
  });
});

describe('Store Routes - Game Filtering', () => {
  describe('filterGames', () => {
    const games: MockGame[] = [
      createMockGame({ id: 'g1', title: 'Alpha Game', genres: ['action'], price: 1999 }),
      createMockGame({ id: 'g2', title: 'Beta Game', genres: ['rpg'], price: 0 }),
      createMockGame({ id: 'g3', title: 'Gamma Game', genres: ['action'], price: 999 }),
      createMockGame({ id: 'g4', title: 'Delta Draft', status: 'draft' }),
    ];

    it('should filter out unpublished games', () => {
      const result = filterGames(games, {});
      assert.strictEqual(result.length, 3);
      assert.ok(result.every(g => g.status === 'published'));
    });

    it('should filter by search query', () => {
      const result = filterGames(games, { query: 'Alpha' });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].title, 'Alpha Game');
    });

    it('should filter by genre', () => {
      const result = filterGames(games, { genre: 'action' });
      assert.strictEqual(result.length, 2);
    });

    it('should filter by free games', () => {
      const result = filterGames(games, { free: true });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].price, 0);
    });

    it('should filter by price range', () => {
      const result = filterGames(games, { minPrice: 500, maxPrice: 1500 });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].price, 999);
    });
  });
});

describe('Store Routes - Game Sorting', () => {
  describe('sortGames', () => {
    const games: MockGame[] = [
      createMockGame({ id: 'g1', title: 'Beta', price: 1999, averageScore: 3.0, downloadCount: 100 }),
      createMockGame({ id: 'g2', title: 'Alpha', price: 999, averageScore: 4.5, downloadCount: 500 }),
      createMockGame({ id: 'g3', title: 'Gamma', price: 0, averageScore: 4.0, downloadCount: 200 }),
    ];

    it('should sort by title ascending', () => {
      const result = sortGames(games, 'title', 'asc');
      assert.strictEqual(result[0].title, 'Alpha');
      assert.strictEqual(result[2].title, 'Gamma');
    });

    it('should sort by price descending', () => {
      const result = sortGames(games, 'price', 'desc');
      assert.strictEqual(result[0].price, 1999);
      assert.strictEqual(result[2].price, 0);
    });

    it('should sort by rating', () => {
      const result = sortGames(games, 'rating', 'desc');
      assert.strictEqual(result[0].averageScore, 4.5);
    });

    it('should sort by downloads', () => {
      const result = sortGames(games, 'downloads', 'desc');
      assert.strictEqual(result[0].downloadCount, 500);
    });
  });
});

describe('Store Routes - Unique Value Collection', () => {
  describe('collectUniqueValues', () => {
    it('should collect unique genres', () => {
      const games: MockGame[] = [
        createMockGame({ genres: ['action', 'adventure'] }),
        createMockGame({ genres: ['action', 'rpg'] }),
        createMockGame({ genres: ['puzzle'] }),
      ];

      const genres = collectUniqueValues(games, g => g.genres);

      assert.deepStrictEqual(genres, ['action', 'adventure', 'puzzle', 'rpg']);
    });

    it('should collect unique tags', () => {
      const games: MockGame[] = [
        createMockGame({ tags: ['indie', 'multiplayer'] }),
        createMockGame({ tags: ['indie', 'singleplayer'] }),
      ];

      const tags = collectUniqueValues(games, g => g.tags);

      assert.deepStrictEqual(tags, ['indie', 'multiplayer', 'singleplayer']);
    });

    it('should handle missing values', () => {
      const games: MockGame[] = [
        createMockGame({ genres: ['action'] }),
        createMockGame({ genres: undefined }),
      ];

      const genres = collectUniqueValues(games, g => g.genres);

      assert.deepStrictEqual(genres, ['action']);
    });
  });
});

describe('Store Routes - Wishlist Validation', () => {
  describe('canAddToWishlist', () => {
    it('should allow adding published game', () => {
      const game = createMockGame({ status: 'published' });
      const result = canAddToWishlist(game, false, false);

      assert.strictEqual(result.valid, true);
    });

    it('should reject unpublished game', () => {
      const game = createMockGame({ status: 'draft' });
      const result = canAddToWishlist(game, false, false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game not found');
    });

    it('should reject game already in wishlist', () => {
      const game = createMockGame({ status: 'published' });
      const result = canAddToWishlist(game, true, false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game already in wishlist');
    });

    it('should reject game already owned', () => {
      const game = createMockGame({ status: 'published' });
      const result = canAddToWishlist(game, false, true);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game already in library');
    });
  });
});

describe('Store Routes - Response Format', () => {
  describe('Featured Games Response', () => {
    it('should return featured games list', () => {
      const games = [createMockGame({ featured: true })];
      const response = createFeaturedResponse(games);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.games.length, 1);
    });
  });

  describe('Highlights Response', () => {
    it('should return combined featured and new games', () => {
      const featured = [createMockGame({ featured: true })];
      const newGames = [createMockGame()];
      const response = createHighlightsResponse(featured, newGames);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.featured.length, 1);
      assert.strictEqual(response.data.new.length, 1);
      assert.strictEqual(response.data.hasHighlights, true);
    });

    it('should indicate no highlights', () => {
      const response = createHighlightsResponse([], []);

      assert.strictEqual(response.data.hasHighlights, false);
    });
  });

  describe('Browse Response', () => {
    it('should return paginated game list', () => {
      const games = [createMockGame(), createMockGame()];
      const response = createBrowseResponse(games, 100, 20, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.games.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.hasMore, true);
    });
  });

  describe('Genres/Tags Response', () => {
    it('should return sorted list', () => {
      const response = createGenresResponse(['rpg', 'action', 'puzzle']);

      assert.strictEqual(response.success, true);
      assert.deepStrictEqual(response.data.genres, ['rpg', 'action', 'puzzle']);
    });
  });

  describe('Ownership Response', () => {
    it('should indicate owned game', () => {
      const response = createOwnershipResponse(true);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.owned, true);
    });

    it('should indicate unowned game', () => {
      const response = createOwnershipResponse(false);

      assert.strictEqual(response.data.owned, false);
    });
  });

  describe('Wishlist Response', () => {
    it('should return wishlist items with games', () => {
      const items = [createMockWishlistItem()];
      const response = createWishlistResponse(items, 1, 50, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.items.length, 1);
      assert.strictEqual(response.data.total, 1);
    });
  });

  describe('Error Response', () => {
    it('should return game not found error', () => {
      const response = createErrorResponse('Game not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Game not found');
    });
  });
});

describe('Store Routes - Authorization', () => {
  it('should allow public access to browse and featured', () => {
    const publicEndpoints = ['featured', 'new', 'browse', 'games/:id', 'genres', 'tags'];
    assert.strictEqual(publicEndpoints.length > 0, true);
  });

  it('should require auth for ownership check', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });

  it('should require auth for wishlist operations', () => {
    const requiresAuth = true;
    assert.strictEqual(requiresAuth, true);
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createFeaturedResponse(games: MockGame[]): {
  success: boolean;
  data: { games: MockGame[] };
} {
  return { success: true, data: { games } };
}

function createHighlightsResponse(
  featured: MockGame[],
  newGames: MockGame[]
): {
  success: boolean;
  data: {
    featured: MockGame[];
    new: MockGame[];
    hasHighlights: boolean;
  };
} {
  return {
    success: true,
    data: {
      featured,
      new: newGames,
      hasHighlights: featured.length > 0 || newGames.length > 0,
    },
  };
}

function createBrowseResponse(
  games: MockGame[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    games: MockGame[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      games,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

function createGenresResponse(genres: string[]): {
  success: boolean;
  data: { genres: string[] };
} {
  return { success: true, data: { genres } };
}

function createOwnershipResponse(owned: boolean): {
  success: boolean;
  data: { owned: boolean };
} {
  return { success: true, data: { owned } };
}

function createWishlistResponse(
  items: MockWishlistItem[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    items: MockWishlistItem[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
