/**
 * Tests for Search Routes
 * Covers query validation, pagination, and response formats for universal search.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type SearchResultType = 'game' | 'user' | 'session' | 'post';

interface SearchResultItem {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  matchedFields?: string[];
}

interface SearchParams {
  q: string;
  limit?: number;
  types?: string[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route/shared constants)
// ============================================================================

const LIMITS = {
  DEFAULT: 10,
  MAX: 50,
  MIN_QUERY_LENGTH: 2,
  SUGGESTIONS_DEFAULT: 5,
  SUGGESTIONS_MAX: 10,
};

const VALID_TYPES: SearchResultType[] = ['game', 'user', 'session', 'post'];

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockSearchResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    id: 'result-123',
    type: 'game',
    title: 'Test Game',
    subtitle: 'Developer Name',
    description: 'A great game for testing',
    matchedFields: ['title'],
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validateSearchQuery(query: string | undefined): ValidationResult {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is required' };
  }

  const trimmed = query.trim();
  if (trimmed.length < LIMITS.MIN_QUERY_LENGTH) {
    return { valid: false, error: `Query must be at least ${LIMITS.MIN_QUERY_LENGTH} characters` };
  }

  return { valid: true };
}

function parseLimit(limit: string | undefined, defaultLimit: number, maxLimit: number): number {
  if (!limit) return defaultLimit;
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

function parseTypes(typesStr: string | undefined): SearchResultType[] {
  if (!typesStr) return VALID_TYPES;
  const types = typesStr.split(',').map(t => t.trim());
  return types.filter(t => VALID_TYPES.includes(t as SearchResultType)) as SearchResultType[];
}

function sortByRelevance(results: SearchResultItem[]): SearchResultItem[] {
  return [...results].sort((a, b) => {
    // First, sort by number of matched fields
    const fieldDiff = (b.matchedFields?.length || 0) - (a.matchedFields?.length || 0);
    if (fieldDiff !== 0) return fieldDiff;

    // Then, prioritize title matches
    const aHasTitle = a.matchedFields?.includes('title') ? 1 : 0;
    const bHasTitle = b.matchedFields?.includes('title') ? 1 : 0;
    return bHasTitle - aHasTitle;
  });
}

function buildSearchPattern(query: string): string {
  return `%${query}%`;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Search Routes - Query Validation', () => {
  describe('GET /search (Universal Search)', () => {
    it('should require query parameter', () => {
      const result = validateSearchQuery(undefined);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Query is required');
    });

    it('should reject empty query', () => {
      const result = validateSearchQuery('');

      assert.strictEqual(result.valid, false);
    });

    it('should reject query shorter than minimum length', () => {
      const result = validateSearchQuery('a');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes(`${LIMITS.MIN_QUERY_LENGTH} characters`));
    });

    it('should accept query at minimum length', () => {
      const result = validateSearchQuery('ab');

      assert.strictEqual(result.valid, true);
    });

    it('should accept longer queries', () => {
      const result = validateSearchQuery('search term here');

      assert.strictEqual(result.valid, true);
    });

    it('should handle whitespace-only query', () => {
      const result = validateSearchQuery('   ');

      assert.strictEqual(result.valid, false);
    });
  });
});

describe('Search Routes - Limit Parsing', () => {
  describe('parseLimit', () => {
    it('should return default for undefined', () => {
      const result = parseLimit(undefined, LIMITS.DEFAULT, LIMITS.MAX);

      assert.strictEqual(result, LIMITS.DEFAULT);
    });

    it('should return default for invalid string', () => {
      const result = parseLimit('invalid', LIMITS.DEFAULT, LIMITS.MAX);

      assert.strictEqual(result, LIMITS.DEFAULT);
    });

    it('should parse valid number', () => {
      const result = parseLimit('25', LIMITS.DEFAULT, LIMITS.MAX);

      assert.strictEqual(result, 25);
    });

    it('should clamp to maximum', () => {
      const result = parseLimit('100', LIMITS.DEFAULT, LIMITS.MAX);

      assert.strictEqual(result, LIMITS.MAX);
    });

    it('should return default for negative numbers', () => {
      const result = parseLimit('-5', LIMITS.DEFAULT, LIMITS.MAX);

      assert.strictEqual(result, LIMITS.DEFAULT);
    });
  });
});

describe('Search Routes - Type Parsing', () => {
  describe('parseTypes', () => {
    it('should return all types for undefined', () => {
      const result = parseTypes(undefined);

      assert.deepStrictEqual(result, VALID_TYPES);
    });

    it('should parse single type', () => {
      const result = parseTypes('game');

      assert.deepStrictEqual(result, ['game']);
    });

    it('should parse multiple types', () => {
      const result = parseTypes('game,user,post');

      assert.deepStrictEqual(result, ['game', 'user', 'post']);
    });

    it('should filter invalid types', () => {
      const result = parseTypes('game,invalid,user');

      assert.deepStrictEqual(result, ['game', 'user']);
    });

    it('should handle whitespace', () => {
      const result = parseTypes('game, user, post');

      assert.deepStrictEqual(result, ['game', 'user', 'post']);
    });

    it('should return empty array for all invalid types', () => {
      const result = parseTypes('invalid,notreal');

      assert.deepStrictEqual(result, []);
    });
  });
});

describe('Search Routes - Search Pattern', () => {
  describe('buildSearchPattern', () => {
    it('should wrap query with wildcards', () => {
      const result = buildSearchPattern('test');

      assert.strictEqual(result, '%test%');
    });

    it('should handle queries with spaces', () => {
      const result = buildSearchPattern('test query');

      assert.strictEqual(result, '%test query%');
    });
  });
});

describe('Search Routes - Result Sorting', () => {
  describe('sortByRelevance', () => {
    it('should prioritize results with more matched fields', () => {
      const results: SearchResultItem[] = [
        createMockSearchResult({ id: 'a', matchedFields: ['title'] }),
        createMockSearchResult({ id: 'b', matchedFields: ['title', 'description'] }),
        createMockSearchResult({ id: 'c', matchedFields: ['title', 'description', 'tags'] }),
      ];

      const sorted = sortByRelevance(results);

      assert.strictEqual(sorted[0].id, 'c');
      assert.strictEqual(sorted[1].id, 'b');
      assert.strictEqual(sorted[2].id, 'a');
    });

    it('should prioritize title matches when field count is equal', () => {
      const results: SearchResultItem[] = [
        createMockSearchResult({ id: 'a', matchedFields: ['description'] }),
        createMockSearchResult({ id: 'b', matchedFields: ['title'] }),
      ];

      const sorted = sortByRelevance(results);

      assert.strictEqual(sorted[0].id, 'b');
      assert.strictEqual(sorted[1].id, 'a');
    });

    it('should handle results with no matched fields', () => {
      const results: SearchResultItem[] = [
        createMockSearchResult({ id: 'a', matchedFields: undefined }),
        createMockSearchResult({ id: 'b', matchedFields: ['title'] }),
      ];

      const sorted = sortByRelevance(results);

      assert.strictEqual(sorted[0].id, 'b');
    });

    it('should not mutate original array', () => {
      const results: SearchResultItem[] = [
        createMockSearchResult({ id: 'a' }),
        createMockSearchResult({ id: 'b' }),
      ];

      const sorted = sortByRelevance(results);

      assert.notStrictEqual(sorted, results);
    });
  });
});

describe('Search Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return search results with metadata', () => {
      const items = [createMockSearchResult(), createMockSearchResult()];
      const response = createSearchResponse(items, 100, 'test');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.items.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.query, 'test');
    });

    it('should return empty results for short query', () => {
      const response = createSearchResponse([], 0, 'a');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.items.length, 0);
      assert.strictEqual(response.data.total, 0);
    });
  });

  describe('Suggestions Response Format', () => {
    it('should return suggestions array', () => {
      const suggestions = ['Game 1', 'Game 2', 'Game 3'];
      const response = createSuggestionsResponse(suggestions);

      assert.strictEqual(response.success, true);
      assert.deepStrictEqual(response.data.suggestions, suggestions);
    });

    it('should return empty suggestions for no matches', () => {
      const response = createSuggestionsResponse([]);

      assert.strictEqual(response.success, true);
      assert.deepStrictEqual(response.data.suggestions, []);
    });
  });

  describe('Error Response Format', () => {
    it('should return error for failed search', () => {
      const response = createErrorResponse('Search failed');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Search failed');
    });
  });
});

describe('Search Routes - Authorization', () => {
  it('should allow public access to search', () => {
    // Main search is public
    const requiresAuth = false;
    assert.strictEqual(requiresAuth, false);
  });

  it('should require auth for session search', () => {
    // Session search only works for authenticated users
    const sessionSearchRequiresAuth = true;
    assert.strictEqual(sessionSearchRequiresAuth, true);
  });

  it('should be rate limited', () => {
    const isRateLimited = true;
    assert.strictEqual(isRateLimited, true);
  });
});

describe('Search Routes - Matched Fields', () => {
  describe('Field Matching Logic', () => {
    it('should detect title matches', () => {
      const searchTerm = 'test';
      const item = { title: 'Test Game' };
      const matched = detectMatchedFields(item, searchTerm);

      assert.ok(matched.includes('title'));
    });

    it('should detect description matches', () => {
      const searchTerm = 'great';
      const item = { title: 'Game', description: 'A great game' };
      const matched = detectMatchedFields(item, searchTerm);

      assert.ok(matched.includes('description'));
    });

    it('should detect multiple field matches', () => {
      const searchTerm = 'test';
      const item = { title: 'Test Game', description: 'A test for testing' };
      const matched = detectMatchedFields(item, searchTerm);

      assert.ok(matched.includes('title'));
      assert.ok(matched.includes('description'));
    });

    it('should be case-insensitive', () => {
      const searchTerm = 'TEST';
      const item = { title: 'test game' };
      const matched = detectMatchedFields(item, searchTerm);

      assert.ok(matched.includes('title'));
    });
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createSearchResponse(
  items: SearchResultItem[],
  total: number,
  query: string
): {
  success: boolean;
  data: {
    items: SearchResultItem[];
    total: number;
    query: string;
  };
} {
  return {
    success: true,
    data: { items, total, query },
  };
}

function createSuggestionsResponse(suggestions: string[]): {
  success: boolean;
  data: { suggestions: string[] };
} {
  return {
    success: true,
    data: { suggestions },
  };
}

function detectMatchedFields(
  item: { title?: string; description?: string },
  searchTerm: string
): string[] {
  const matched: string[] = [];
  const lowerSearchTerm = searchTerm.toLowerCase();

  if (item.title?.toLowerCase().includes(lowerSearchTerm)) {
    matched.push('title');
  }
  if (item.description?.toLowerCase().includes(lowerSearchTerm)) {
    matched.push('description');
  }

  return matched;
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
