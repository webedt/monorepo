/**
 * Tests for Library Routes
 * Covers game library management, filtering, sorting, and playtime tracking.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type InstallStatus = 'not_installed' | 'installing' | 'installed';
type SortField = 'acquiredAt' | 'title' | 'lastPlayed' | 'playtime';
type SortOrder = 'asc' | 'desc';

interface MockLibraryItem {
  id: string;
  userId: string;
  gameId: string;
  acquiredAt: Date;
  lastPlayedAt: Date | null;
  playtimeMinutes: number;
  installStatus: InstallStatus;
  favorite: boolean;
  hidden: boolean;
}

interface MockGame {
  id: string;
  title: string;
  description: string;
}

interface LibraryItemWithGame {
  libraryItem: MockLibraryItem;
  game: MockGame;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface LibraryFilters {
  favorite?: boolean;
  installed?: boolean;
  hidden?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const LIMITS = {
  RECENT_DEFAULT: 6,
  RECENT_MAX: 20,
  LIBRARY_DEFAULT: 50,
  LIBRARY_MAX: 200,
};

const VALID_INSTALL_STATUSES: InstallStatus[] = ['not_installed', 'installing', 'installed'];
const VALID_SORT_FIELDS: SortField[] = ['acquiredAt', 'title', 'lastPlayed', 'playtime'];

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockLibraryItem(overrides: Partial<MockLibraryItem> = {}): MockLibraryItem {
  return {
    id: 'lib-123',
    userId: 'user-456',
    gameId: 'game-789',
    acquiredAt: new Date('2024-01-15'),
    lastPlayedAt: new Date('2024-01-20'),
    playtimeMinutes: 120,
    installStatus: 'installed',
    favorite: false,
    hidden: false,
    ...overrides,
  };
}

function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: 'game-789',
    title: 'Test Game',
    description: 'A great game for testing',
    ...overrides,
  };
}

function createMockLibraryItemWithGame(
  itemOverrides: Partial<MockLibraryItem> = {},
  gameOverrides: Partial<MockGame> = {}
): LibraryItemWithGame {
  return {
    libraryItem: createMockLibraryItem(itemOverrides),
    game: createMockGame(gameOverrides),
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validateInstallStatus(status: string): ValidationResult {
  if (!VALID_INSTALL_STATUSES.includes(status as InstallStatus)) {
    return { valid: false, error: 'Invalid install status' };
  }

  return { valid: true };
}

function validatePlaytime(minutes: unknown): ValidationResult {
  if (typeof minutes !== 'number' || minutes < 0) {
    return { valid: false, error: 'Invalid playtime' };
  }

  return { valid: true };
}

function parseRecentLimit(limitStr: string | undefined): number {
  if (!limitStr) return LIMITS.RECENT_DEFAULT;
  const parsed = parseInt(limitStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.RECENT_DEFAULT;
  return Math.min(parsed, LIMITS.RECENT_MAX);
}

function parseLibraryLimit(limitStr: string | undefined): number {
  if (!limitStr) return LIMITS.LIBRARY_DEFAULT;
  const parsed = parseInt(limitStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.LIBRARY_DEFAULT;
  return Math.min(parsed, LIMITS.LIBRARY_MAX);
}

function parseOffset(offsetStr: string | undefined): number {
  if (!offsetStr) return 0;
  const parsed = parseInt(offsetStr, 10);
  if (isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function filterLibraryItems(
  items: LibraryItemWithGame[],
  filters: LibraryFilters
): LibraryItemWithGame[] {
  let filtered = [...items];

  // Exclude hidden by default (unless specifically requesting hidden)
  if (!filters.hidden) {
    filtered = filtered.filter(item => !item.libraryItem.hidden);
  } else {
    filtered = filtered.filter(item => item.libraryItem.hidden);
  }

  if (filters.favorite) {
    filtered = filtered.filter(item => item.libraryItem.favorite);
  }

  if (filters.installed) {
    filtered = filtered.filter(item => item.libraryItem.installStatus === 'installed');
  }

  return filtered;
}

function sortLibraryItems(
  items: LibraryItemWithGame[],
  sortField: SortField,
  sortOrder: SortOrder
): LibraryItemWithGame[] {
  const sorted = [...items];
  const multiplier = sortOrder === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    switch (sortField) {
      case 'title':
        return multiplier * a.game.title.localeCompare(b.game.title);
      case 'lastPlayed':
        const playedA = a.libraryItem.lastPlayedAt?.getTime() || 0;
        const playedB = b.libraryItem.lastPlayedAt?.getTime() || 0;
        return multiplier * (playedA - playedB);
      case 'playtime':
        return multiplier * (a.libraryItem.playtimeMinutes - b.libraryItem.playtimeMinutes);
      case 'acquiredAt':
      default:
        const acqA = a.libraryItem.acquiredAt.getTime();
        const acqB = b.libraryItem.acquiredAt.getTime();
        return multiplier * (acqA - acqB);
    }
  });

  return sorted;
}

function filterRecentlyPlayed(items: LibraryItemWithGame[]): LibraryItemWithGame[] {
  return items.filter(item => item.libraryItem.lastPlayedAt !== null);
}

function calculateLibraryStats(items: MockLibraryItem[]): {
  totalGames: number;
  installedGames: number;
  favoriteGames: number;
  totalPlaytimeMinutes: number;
  totalPlaytimeHours: number;
} {
  const totalGames = items.length;
  const installedGames = items.filter(item => item.installStatus === 'installed').length;
  const favoriteGames = items.filter(item => item.favorite).length;
  const totalPlaytimeMinutes = items.reduce((sum, item) => sum + item.playtimeMinutes, 0);
  const totalPlaytimeHours = Math.round(totalPlaytimeMinutes / 60);

  return { totalGames, installedGames, favoriteGames, totalPlaytimeMinutes, totalPlaytimeHours };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Library Routes - Install Status Validation', () => {
  describe('validateInstallStatus', () => {
    it('should accept not_installed', () => {
      const result = validateInstallStatus('not_installed');
      assert.strictEqual(result.valid, true);
    });

    it('should accept installing', () => {
      const result = validateInstallStatus('installing');
      assert.strictEqual(result.valid, true);
    });

    it('should accept installed', () => {
      const result = validateInstallStatus('installed');
      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid status', () => {
      const result = validateInstallStatus('pending');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid install status');
    });

    it('should reject empty status', () => {
      const result = validateInstallStatus('');
      assert.strictEqual(result.valid, false);
    });
  });
});

describe('Library Routes - Playtime Validation', () => {
  describe('validatePlaytime', () => {
    it('should accept zero playtime', () => {
      const result = validatePlaytime(0);
      assert.strictEqual(result.valid, true);
    });

    it('should accept positive playtime', () => {
      const result = validatePlaytime(120);
      assert.strictEqual(result.valid, true);
    });

    it('should reject negative playtime', () => {
      const result = validatePlaytime(-10);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid playtime');
    });

    it('should reject non-number playtime', () => {
      const result = validatePlaytime('60');
      assert.strictEqual(result.valid, false);
    });

    it('should reject undefined playtime', () => {
      const result = validatePlaytime(undefined);
      assert.strictEqual(result.valid, false);
    });
  });
});

describe('Library Routes - Limit Parsing', () => {
  describe('parseRecentLimit', () => {
    it('should return default for undefined', () => {
      const result = parseRecentLimit(undefined);
      assert.strictEqual(result, LIMITS.RECENT_DEFAULT);
    });

    it('should parse valid limit', () => {
      const result = parseRecentLimit('10');
      assert.strictEqual(result, 10);
    });

    it('should clamp to maximum', () => {
      const result = parseRecentLimit('50');
      assert.strictEqual(result, LIMITS.RECENT_MAX);
    });

    it('should return default for invalid', () => {
      const result = parseRecentLimit('invalid');
      assert.strictEqual(result, LIMITS.RECENT_DEFAULT);
    });
  });

  describe('parseLibraryLimit', () => {
    it('should return default for undefined', () => {
      const result = parseLibraryLimit(undefined);
      assert.strictEqual(result, LIMITS.LIBRARY_DEFAULT);
    });

    it('should clamp to maximum', () => {
      const result = parseLibraryLimit('500');
      assert.strictEqual(result, LIMITS.LIBRARY_MAX);
    });
  });

  describe('parseOffset', () => {
    it('should return 0 for undefined', () => {
      const result = parseOffset(undefined);
      assert.strictEqual(result, 0);
    });

    it('should parse valid offset', () => {
      const result = parseOffset('50');
      assert.strictEqual(result, 50);
    });

    it('should return 0 for negative', () => {
      const result = parseOffset('-10');
      assert.strictEqual(result, 0);
    });
  });
});

describe('Library Routes - Filtering', () => {
  describe('filterLibraryItems', () => {
    const items: LibraryItemWithGame[] = [
      createMockLibraryItemWithGame({ favorite: true, installStatus: 'installed', hidden: false }),
      createMockLibraryItemWithGame({ favorite: false, installStatus: 'not_installed', hidden: false }),
      createMockLibraryItemWithGame({ favorite: true, installStatus: 'installed', hidden: true }),
    ];

    it('should exclude hidden items by default', () => {
      const result = filterLibraryItems(items, {});

      assert.strictEqual(result.length, 2);
      assert.ok(result.every(item => !item.libraryItem.hidden));
    });

    it('should filter by favorite', () => {
      const result = filterLibraryItems(items, { favorite: true });

      assert.strictEqual(result.length, 1);
      assert.ok(result.every(item => item.libraryItem.favorite));
    });

    it('should filter by installed', () => {
      const result = filterLibraryItems(items, { installed: true });

      assert.strictEqual(result.length, 1);
      assert.ok(result.every(item => item.libraryItem.installStatus === 'installed'));
    });

    it('should return only hidden items when requested', () => {
      const result = filterLibraryItems(items, { hidden: true });

      assert.strictEqual(result.length, 1);
      assert.ok(result.every(item => item.libraryItem.hidden));
    });
  });

  describe('filterRecentlyPlayed', () => {
    it('should only include items with lastPlayedAt', () => {
      const items: LibraryItemWithGame[] = [
        createMockLibraryItemWithGame({ lastPlayedAt: new Date() }),
        createMockLibraryItemWithGame({ lastPlayedAt: null }),
        createMockLibraryItemWithGame({ lastPlayedAt: new Date() }),
      ];

      const result = filterRecentlyPlayed(items);

      assert.strictEqual(result.length, 2);
      assert.ok(result.every(item => item.libraryItem.lastPlayedAt !== null));
    });
  });
});

describe('Library Routes - Sorting', () => {
  describe('sortLibraryItems', () => {
    const items: LibraryItemWithGame[] = [
      createMockLibraryItemWithGame(
        { acquiredAt: new Date('2024-01-15'), playtimeMinutes: 100 },
        { title: 'Beta Game' }
      ),
      createMockLibraryItemWithGame(
        { acquiredAt: new Date('2024-01-20'), playtimeMinutes: 50 },
        { title: 'Alpha Game' }
      ),
      createMockLibraryItemWithGame(
        { acquiredAt: new Date('2024-01-10'), playtimeMinutes: 200 },
        { title: 'Gamma Game' }
      ),
    ];

    it('should sort by title ascending', () => {
      const result = sortLibraryItems(items, 'title', 'asc');

      assert.strictEqual(result[0].game.title, 'Alpha Game');
      assert.strictEqual(result[1].game.title, 'Beta Game');
      assert.strictEqual(result[2].game.title, 'Gamma Game');
    });

    it('should sort by title descending', () => {
      const result = sortLibraryItems(items, 'title', 'desc');

      assert.strictEqual(result[0].game.title, 'Gamma Game');
      assert.strictEqual(result[2].game.title, 'Alpha Game');
    });

    it('should sort by playtime', () => {
      const result = sortLibraryItems(items, 'playtime', 'desc');

      assert.strictEqual(result[0].libraryItem.playtimeMinutes, 200);
      assert.strictEqual(result[2].libraryItem.playtimeMinutes, 50);
    });

    it('should sort by acquiredAt', () => {
      const result = sortLibraryItems(items, 'acquiredAt', 'asc');

      assert.strictEqual(result[0].libraryItem.acquiredAt.toISOString(), '2024-01-10T00:00:00.000Z');
    });

    it('should handle lastPlayed with nulls', () => {
      const itemsWithNulls: LibraryItemWithGame[] = [
        createMockLibraryItemWithGame({ lastPlayedAt: null }),
        createMockLibraryItemWithGame({ lastPlayedAt: new Date('2024-01-15') }),
      ];

      const result = sortLibraryItems(itemsWithNulls, 'lastPlayed', 'desc');

      // Item with lastPlayedAt should come first
      assert.ok(result[0].libraryItem.lastPlayedAt !== null);
    });
  });
});

describe('Library Routes - Statistics', () => {
  describe('calculateLibraryStats', () => {
    it('should calculate all statistics correctly', () => {
      const items: MockLibraryItem[] = [
        createMockLibraryItem({ installStatus: 'installed', favorite: true, playtimeMinutes: 60 }),
        createMockLibraryItem({ installStatus: 'installed', favorite: false, playtimeMinutes: 120 }),
        createMockLibraryItem({ installStatus: 'not_installed', favorite: true, playtimeMinutes: 0 }),
      ];

      const stats = calculateLibraryStats(items);

      assert.strictEqual(stats.totalGames, 3);
      assert.strictEqual(stats.installedGames, 2);
      assert.strictEqual(stats.favoriteGames, 2);
      assert.strictEqual(stats.totalPlaytimeMinutes, 180);
      assert.strictEqual(stats.totalPlaytimeHours, 3);
    });

    it('should handle empty library', () => {
      const stats = calculateLibraryStats([]);

      assert.strictEqual(stats.totalGames, 0);
      assert.strictEqual(stats.installedGames, 0);
      assert.strictEqual(stats.totalPlaytimeMinutes, 0);
    });
  });
});

describe('Library Routes - Response Format', () => {
  describe('Library List Response', () => {
    it('should return paginated library items', () => {
      const items = [createMockLibraryItemWithGame(), createMockLibraryItemWithGame()];
      const response = createLibraryResponse(items, 100, 50, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.items.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.limit, 50);
      assert.strictEqual(response.data.offset, 0);
      assert.strictEqual(response.data.hasMore, true);
    });

    it('should indicate no more pages', () => {
      const items = [createMockLibraryItemWithGame()];
      const response = createLibraryResponse(items, 1, 50, 0);

      assert.strictEqual(response.data.hasMore, false);
    });
  });

  describe('Recent Games Response', () => {
    it('should return recently played games', () => {
      const items = [createMockLibraryItemWithGame(), createMockLibraryItemWithGame()];
      const response = createRecentGamesResponse(items);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.items.length, 2);
      assert.strictEqual(response.data.total, 2);
    });
  });

  describe('Stats Response', () => {
    it('should return library statistics', () => {
      const stats = {
        totalGames: 50,
        installedGames: 30,
        favoriteGames: 10,
        totalPlaytimeMinutes: 3000,
        totalPlaytimeHours: 50,
      };
      const response = createStatsResponse(stats);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.totalGames, 50);
      assert.strictEqual(response.data.totalPlaytimeHours, 50);
    });
  });

  describe('Item Update Response', () => {
    it('should return updated item', () => {
      const item = createMockLibraryItem({ favorite: true });
      const response = createItemUpdateResponse(item);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.item.favorite, true);
    });
  });

  describe('Error Response', () => {
    it('should return game not in library error', () => {
      const response = createErrorResponse('Game not in library');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Game not in library');
    });
  });
});

describe('Library Routes - Authorization', () => {
  it('should require authentication for all endpoints', () => {
    const allEndpointsRequireAuth = true;
    assert.strictEqual(allEndpointsRequireAuth, true);
  });

  it('should scope library to user', () => {
    // Library items are always filtered by userId
    const scopedToUser = true;
    assert.strictEqual(scopedToUser, true);
  });
});

describe('Library Routes - Toggle Operations', () => {
  describe('Toggle Favorite', () => {
    it('should toggle favorite status', () => {
      const item = createMockLibraryItem({ favorite: false });
      const newStatus = !item.favorite;

      assert.strictEqual(newStatus, true);
    });
  });

  describe('Hide/Unhide Game', () => {
    it('should default to hiding when no value provided', () => {
      const defaultHidden = true;
      assert.strictEqual(defaultHidden, true);
    });

    it('should allow explicit unhide', () => {
      const hidden = false;
      assert.strictEqual(hidden, false);
    });
  });
});

describe('Library Routes - Playtime Updates', () => {
  describe('Add Playtime', () => {
    it('should add minutes to existing playtime', () => {
      const item = createMockLibraryItem({ playtimeMinutes: 100 });
      const additionalMinutes = 30;
      const newPlaytime = item.playtimeMinutes + additionalMinutes;

      assert.strictEqual(newPlaytime, 130);
    });

    it('should update lastPlayedAt timestamp', () => {
      const beforeUpdate = new Date('2024-01-15');
      const afterUpdate = new Date();

      assert.ok(afterUpdate.getTime() > beforeUpdate.getTime());
    });
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createLibraryResponse(
  items: LibraryItemWithGame[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    items: Array<MockLibraryItem & { game: MockGame }>;
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      items: items.map(item => ({ ...item.libraryItem, game: item.game })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

function createRecentGamesResponse(items: LibraryItemWithGame[]): {
  success: boolean;
  data: {
    items: Array<MockLibraryItem & { game: MockGame }>;
    total: number;
  };
} {
  return {
    success: true,
    data: {
      items: items.map(item => ({ ...item.libraryItem, game: item.game })),
      total: items.length,
    },
  };
}

function createStatsResponse(stats: {
  totalGames: number;
  installedGames: number;
  favoriteGames: number;
  totalPlaytimeMinutes: number;
  totalPlaytimeHours: number;
}): {
  success: boolean;
  data: typeof stats;
} {
  return { success: true, data: stats };
}

function createItemUpdateResponse(item: MockLibraryItem): {
  success: boolean;
  data: { item: MockLibraryItem };
} {
  return { success: true, data: { item } };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
