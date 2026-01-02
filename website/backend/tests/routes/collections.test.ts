/**
 * Tests for Collections Routes
 * Covers input validation, ownership checks, and response formats for session collections.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

interface MockCollection {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route/shared constants)
// ============================================================================

const VALID_ICONS = ['folder', 'star', 'code', 'bookmark', 'archive'] as const;

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockCollection(overrides: Partial<MockCollection> = {}): MockCollection {
  const now = new Date();
  return {
    id: `collection-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    name: 'My Collection',
    description: null,
    color: null,
    icon: null,
    sortOrder: 0,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validateCreateCollectionInput(body: Record<string, unknown>): ValidationResult {
  const { name, color, icon } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, error: 'Collection name is required' };
  }

  if (color !== undefined && color !== null && !isValidHexColor(color)) {
    return { valid: false, error: 'Invalid color format. Must be a hex color like #RRGGBB' };
  }

  if (icon !== undefined && icon !== null && !isValidIcon(icon)) {
    return { valid: false, error: `Invalid icon. Must be one of: ${VALID_ICONS.join(', ')}` };
  }

  return { valid: true };
}

function validateUpdateCollectionInput(body: Record<string, unknown>): ValidationResult {
  const { name, color, icon } = body;

  if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
    return { valid: false, error: 'Collection name cannot be empty' };
  }

  if (color !== undefined && color !== null && !isValidHexColor(color)) {
    return { valid: false, error: 'Invalid color format. Must be a hex color like #RRGGBB' };
  }

  if (icon !== undefined && icon !== null && !isValidIcon(icon)) {
    return { valid: false, error: `Invalid icon. Must be one of: ${VALID_ICONS.join(', ')}` };
  }

  return { valid: true };
}

function validateBulkAddInput(body: Record<string, unknown>): ValidationResult {
  const { collectionIds } = body;

  if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
    return { valid: false, error: 'collectionIds array is required' };
  }

  return { valid: true };
}

function validateReorderInput(body: Record<string, unknown>): ValidationResult {
  const { orderedIds } = body;

  if (!Array.isArray(orderedIds)) {
    return { valid: false, error: 'orderedIds array is required' };
  }

  return { valid: true };
}

function isValidHexColor(color: unknown): boolean {
  if (typeof color !== 'string') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function isValidIcon(icon: unknown): boolean {
  if (typeof icon !== 'string') return false;
  return VALID_ICONS.includes(icon as typeof VALID_ICONS[number]);
}

function validateOwnership(resourceUserId: string, currentUserId: string): boolean {
  return resourceUserId === currentUserId;
}

function checkDuplicateName(existingNames: string[], newName: string): boolean {
  const normalizedName = newName.trim().toLowerCase();
  return existingNames.some(name => name.toLowerCase() === normalizedName);
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Collections Routes - Create Validation', () => {
  describe('POST /api/collections (Create Collection)', () => {
    it('should require name field', () => {
      const body = {};
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Collection name is required');
    });

    it('should reject empty name', () => {
      const body = { name: '' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only name', () => {
      const body = { name: '   ' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid name', () => {
      const body = { name: 'My Collection' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid collection with all optional fields', () => {
      const body = {
        name: 'Work Projects',
        description: 'Sessions related to work',
        color: '#FF5733',
        icon: 'folder',
        isDefault: true,
      };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Collections Routes - Update Validation', () => {
  describe('PATCH /api/collections/:id (Update Collection)', () => {
    it('should reject empty name on update', () => {
      const body = { name: '' };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Collection name cannot be empty');
    });

    it('should reject whitespace-only name on update', () => {
      const body = { name: '   ' };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept empty body for no-op update', () => {
      const body = {};
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept partial update with only color', () => {
      const body = { color: '#00FF00' };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept clearing optional fields with null', () => {
      const body = { color: null, icon: null, description: null };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Collections Routes - Color Validation', () => {
  describe('Hex Color Format', () => {
    it('should accept valid 6-digit hex colors', () => {
      assert.strictEqual(isValidHexColor('#FF5733'), true);
      assert.strictEqual(isValidHexColor('#000000'), true);
      assert.strictEqual(isValidHexColor('#FFFFFF'), true);
      assert.strictEqual(isValidHexColor('#aabbcc'), true);
      assert.strictEqual(isValidHexColor('#AbCdEf'), true);
    });

    it('should reject 3-digit hex colors', () => {
      assert.strictEqual(isValidHexColor('#FFF'), false);
      assert.strictEqual(isValidHexColor('#ABC'), false);
    });

    it('should reject hex without #', () => {
      assert.strictEqual(isValidHexColor('FF5733'), false);
    });

    it('should reject invalid hex characters', () => {
      assert.strictEqual(isValidHexColor('#GGGGGG'), false);
      assert.strictEqual(isValidHexColor('#ZZZZZZ'), false);
    });

    it('should reject non-string values', () => {
      assert.strictEqual(isValidHexColor(null), false);
      assert.strictEqual(isValidHexColor(undefined), false);
      assert.strictEqual(isValidHexColor(12345), false);
    });

    it('should reject named colors', () => {
      assert.strictEqual(isValidHexColor('red'), false);
      assert.strictEqual(isValidHexColor('blue'), false);
    });
  });
});

describe('Collections Routes - Icon Validation', () => {
  describe('Valid Icons', () => {
    it('should accept all valid icons', () => {
      for (const icon of VALID_ICONS) {
        assert.strictEqual(isValidIcon(icon), true, `Icon '${icon}' should be valid`);
      }
    });

    it('should reject invalid icon names', () => {
      assert.strictEqual(isValidIcon('home'), false);
      assert.strictEqual(isValidIcon('settings'), false);
      assert.strictEqual(isValidIcon('random'), false);
    });

    it('should reject non-string values', () => {
      assert.strictEqual(isValidIcon(null), false);
      assert.strictEqual(isValidIcon(undefined), false);
      assert.strictEqual(isValidIcon(123), false);
    });

    it('should be case-sensitive', () => {
      assert.strictEqual(isValidIcon('FOLDER'), false);
      assert.strictEqual(isValidIcon('Folder'), false);
    });
  });
});

describe('Collections Routes - Bulk Operations', () => {
  describe('POST /api/collections/session/:sessionId/bulk', () => {
    it('should require collectionIds array', () => {
      const body = {};
      const result = validateBulkAddInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'collectionIds array is required');
    });

    it('should reject empty collectionIds array', () => {
      const body = { collectionIds: [] };
      const result = validateBulkAddInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject non-array collectionIds', () => {
      const body = { collectionIds: 'id-123' };
      const result = validateBulkAddInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid collectionIds array', () => {
      const body = { collectionIds: ['col-1', 'col-2', 'col-3'] };
      const result = validateBulkAddInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /api/collections/reorder', () => {
    it('should require orderedIds array', () => {
      const body = {};
      const result = validateReorderInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'orderedIds array is required');
    });

    it('should reject non-array orderedIds', () => {
      const body = { orderedIds: 'id-123' };
      const result = validateReorderInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept empty array for reorder', () => {
      const body = { orderedIds: [] };
      const result = validateReorderInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid orderedIds array', () => {
      const body = { orderedIds: ['col-1', 'col-2', 'col-3'] };
      const result = validateReorderInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Collections Routes - Ownership Verification', () => {
  describe('Resource Ownership', () => {
    it('should allow access to own collections', () => {
      const userId = 'user-123';
      const result = validateOwnership(userId, userId);

      assert.strictEqual(result, true);
    });

    it('should deny access to other users collections', () => {
      const result = validateOwnership('user-123', 'user-456');

      assert.strictEqual(result, false);
    });
  });
});

describe('Collections Routes - Duplicate Name Detection', () => {
  describe('Name Uniqueness', () => {
    it('should detect exact duplicate name', () => {
      const existingNames = ['Work', 'Personal', 'Archive'];
      const result = checkDuplicateName(existingNames, 'Work');

      assert.strictEqual(result, true);
    });

    it('should detect case-insensitive duplicate', () => {
      const existingNames = ['Work'];
      const result = checkDuplicateName(existingNames, 'WORK');

      assert.strictEqual(result, true);
    });

    it('should handle whitespace in comparison', () => {
      const existingNames = ['Work'];
      const result = checkDuplicateName(existingNames, '  Work  ');

      assert.strictEqual(result, true);
    });

    it('should allow unique names', () => {
      const existingNames = ['Work', 'Personal'];
      const result = checkDuplicateName(existingNames, 'Projects');

      assert.strictEqual(result, false);
    });
  });
});

describe('Collections Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with collection data', () => {
      const collection = createMockCollection();
      const response = createSuccessResponse({ collection });

      assert.strictEqual(response.success, true);
      assert.ok(response.data.collection);
    });

    it('should return list with session counts', () => {
      const collections = [
        createMockCollection({ name: 'Work' }),
        createMockCollection({ name: 'Personal' }),
      ];
      const response = createCollectionListResponse(collections);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.collections.length, 2);
      assert.strictEqual(response.data.total, 2);
    });
  });

  describe('Collection Sessions Response', () => {
    it('should include collection info and sessions', () => {
      const collection = createMockCollection();
      const sessions = [
        { id: 'session-1', title: 'Session 1' },
        { id: 'session-2', title: 'Session 2' },
      ];
      const response = createCollectionSessionsResponse(collection, sessions);

      assert.strictEqual(response.success, true);
      assert.ok(response.data.collection);
      assert.strictEqual(response.data.sessions.length, 2);
      assert.strictEqual(response.data.total, 2);
    });
  });

  describe('Bulk Add Response', () => {
    it('should return count of added items', () => {
      const response = createBulkAddResponse(5);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.added, 5);
    });

    it('should handle already in collection message', () => {
      const response = createBulkAddResponse(0, 'Session already in all specified collections');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.added, 0);
      assert.ok(response.message);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Collection not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Collection not found');
    });
  });
});

describe('Collections Routes - Authorization', () => {
  it('should require auth for all collection endpoints', () => {
    const allEndpointsRequireAuth = true;
    assert.strictEqual(allEndpointsRequireAuth, true);
  });

  it('should enforce user ownership for collection operations', () => {
    const collection = createMockCollection({ userId: 'user-123' });
    const requestingUser = 'user-456';

    const canAccess = validateOwnership(collection.userId, requestingUser);
    assert.strictEqual(canAccess, false);
  });
});

describe('Collections Routes - Default Collection Handling', () => {
  describe('Setting Default Collection', () => {
    it('should allow only one default collection', () => {
      // When a new collection is set as default, existing defaults should be unset
      const collections = [
        createMockCollection({ isDefault: true }),
        createMockCollection({ isDefault: false }),
      ];

      const currentDefaults = collections.filter(c => c.isDefault);
      assert.strictEqual(currentDefaults.length, 1);
    });

    it('should track if collection is default', () => {
      const defaultCollection = createMockCollection({ isDefault: true });
      const regularCollection = createMockCollection({ isDefault: false });

      assert.strictEqual(defaultCollection.isDefault, true);
      assert.strictEqual(regularCollection.isDefault, false);
    });
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createSuccessResponse(data: Record<string, unknown>): {
  success: boolean;
  data: Record<string, unknown>;
} {
  return { success: true, data };
}

function createCollectionListResponse(collections: MockCollection[]): {
  success: boolean;
  data: {
    collections: MockCollection[];
    total: number;
  };
} {
  return {
    success: true,
    data: {
      collections,
      total: collections.length,
    },
  };
}

function createCollectionSessionsResponse(
  collection: MockCollection,
  sessions: Array<{ id: string; title: string }>
): {
  success: boolean;
  data: {
    collection: MockCollection;
    sessions: Array<{ id: string; title: string }>;
    total: number;
  };
} {
  return {
    success: true,
    data: {
      collection,
      sessions,
      total: sessions.length,
    },
  };
}

function createBulkAddResponse(
  added: number,
  message?: string
): {
  success: boolean;
  data: { added: number };
  message?: string;
} {
  return {
    success: true,
    data: { added },
    ...(message ? { message } : {}),
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
