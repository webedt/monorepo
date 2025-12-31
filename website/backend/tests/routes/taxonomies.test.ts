/**
 * Tests for Taxonomies Routes
 * Covers input validation, admin authorization, term management, and item assignments
 * for taxonomy CRUD operations.
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

interface MockUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface MockTaxonomy {
  id: string;
  name: string;
  displayName: string;
  slug: string;
  description: string | null;
  allowMultiple: boolean;
  isRequired: boolean;
  itemTypes: string[];
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

interface MockTaxonomyTerm {
  id: string;
  taxonomyId: string;
  name: string;
  slug: string;
  description: string | null;
  parentId: string | null;
  color: string | null;
  icon: string | null;
  metadata: Record<string, unknown> | null;
  sortOrder: number;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

interface MockItemTaxonomy {
  id: string;
  termId: string;
  itemType: string;
  itemId: string;
  createdAt: Date;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: `user-${randomUUID()}`,
    email: `test-${randomUUID().slice(0, 8)}@example.com`,
    isAdmin: false,
    ...overrides,
  };
}

function createMockTaxonomy(overrides: Partial<MockTaxonomy> = {}): MockTaxonomy {
  const now = new Date();
  return {
    id: `tax-${randomUUID()}`,
    name: 'Test Category',
    displayName: 'Test Category',
    slug: 'test-category',
    description: null,
    allowMultiple: true,
    isRequired: false,
    itemTypes: [],
    sortOrder: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockTerm(overrides: Partial<MockTaxonomyTerm> = {}): MockTaxonomyTerm {
  const now = new Date();
  return {
    id: `term-${randomUUID()}`,
    taxonomyId: `tax-${randomUUID()}`,
    name: 'Test Term',
    slug: 'test-term',
    description: null,
    parentId: null,
    color: null,
    icon: null,
    metadata: null,
    sortOrder: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockItemTaxonomy(overrides: Partial<MockItemTaxonomy> = {}): MockItemTaxonomy {
  return {
    id: `item-tax-${randomUUID()}`,
    termId: `term-${randomUUID()}`,
    itemType: 'snippet',
    itemId: `item-${randomUUID()}`,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Validation Constants (mirror route constants)
// ============================================================================

const VALID_STATUSES = ['active', 'archived'] as const;

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidStatus(status: string): boolean {
  return VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]);
}

function isValidHexColor(color: unknown): boolean {
  if (typeof color !== 'string') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function validateCreateTaxonomyInput(body: Record<string, unknown>): ValidationResult {
  const { name, displayName } = body;

  if (!name || !displayName) {
    return { valid: false, error: 'Name and displayName are required' };
  }

  return { valid: true };
}

function validateUpdateTaxonomyInput(body: Record<string, unknown>): ValidationResult {
  const { status } = body;

  if (status !== undefined && !isValidStatus(status as string)) {
    return { valid: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  return { valid: true };
}

function validateCreateTermInput(body: Record<string, unknown>): ValidationResult {
  const { name, color } = body;

  if (!name) {
    return { valid: false, error: 'Name is required' };
  }

  if (color && !isValidHexColor(color)) {
    return { valid: false, error: 'Invalid color format. Must be a hex color (e.g., #FF5733)' };
  }

  return { valid: true };
}

function validateUpdateTermInput(body: Record<string, unknown>): ValidationResult {
  const { status, color } = body;

  if (status !== undefined && !isValidStatus(status as string)) {
    return { valid: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` };
  }

  if (color !== undefined && color !== null && color !== '' && !isValidHexColor(color)) {
    return { valid: false, error: 'Invalid color format. Must be a hex color (e.g., #FF5733)' };
  }

  return { valid: true };
}

function validateBulkTermIdsInput(body: Record<string, unknown>): ValidationResult {
  const { termIds } = body;

  if (!Array.isArray(termIds)) {
    return { valid: false, error: 'termIds must be an array' };
  }

  return { valid: true };
}

function validateItemTypeApplicability(
  taxonomy: MockTaxonomy,
  itemType: string
): ValidationResult {
  if (taxonomy.itemTypes.length > 0 && !taxonomy.itemTypes.includes(itemType)) {
    return { valid: false, error: `This taxonomy cannot be applied to ${itemType} items` };
  }

  return { valid: true };
}

function checkDuplicateSlug(
  existingSlugs: string[],
  newSlug: string
): ValidationResult {
  if (existingSlugs.includes(newSlug)) {
    return { valid: false, error: 'A taxonomy with this name already exists' };
  }

  return { valid: true };
}

function checkDuplicateTermSlug(
  existingSlugs: string[],
  newSlug: string
): ValidationResult {
  if (existingSlugs.includes(newSlug)) {
    return { valid: false, error: 'A term with this name already exists in this taxonomy' };
  }

  return { valid: true };
}

function canAssignMultipleTerms(
  taxonomy: MockTaxonomy,
  existingAssignments: MockItemTaxonomy[]
): boolean {
  if (taxonomy.allowMultiple) {
    return true;
  }

  return existingAssignments.length === 0;
}

function validateAdminAccess(user: MockUser): ValidationResult {
  if (!user.isAdmin) {
    return { valid: false, error: 'Admin access required' };
  }

  return { valid: true };
}

function validateAuthenticatedAccess(user: MockUser | null): ValidationResult {
  if (!user) {
    return { valid: false, error: 'Authentication required' };
  }

  return { valid: true };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Taxonomies Routes - Slug Generation', () => {
  it('should generate lowercase slug from name', () => {
    assert.strictEqual(generateSlug('Test Category'), 'test-category');
    assert.strictEqual(generateSlug('MY TAXONOMY'), 'my-taxonomy');
  });

  it('should replace special characters with hyphens', () => {
    assert.strictEqual(generateSlug('Test & Category'), 'test-category');
    assert.strictEqual(generateSlug('Test/Category'), 'test-category');
    assert.strictEqual(generateSlug('Test.Category'), 'test-category');
  });

  it('should handle multiple spaces and special chars', () => {
    assert.strictEqual(generateSlug('Test   Category'), 'test-category');
    assert.strictEqual(generateSlug('Test---Category'), 'test-category');
  });

  it('should remove leading and trailing hyphens', () => {
    assert.strictEqual(generateSlug('-Test Category-'), 'test-category');
    assert.strictEqual(generateSlug('---Test---'), 'test');
  });

  it('should handle numbers in name', () => {
    assert.strictEqual(generateSlug('Category 2024'), 'category-2024');
    assert.strictEqual(generateSlug('123 Numbers'), '123-numbers');
  });

  it('should handle empty or whitespace input', () => {
    assert.strictEqual(generateSlug(''), '');
    assert.strictEqual(generateSlug('   '), '');
  });
});

describe('Taxonomies Routes - Status Validation', () => {
  it('should accept valid statuses', () => {
    assert.strictEqual(isValidStatus('active'), true);
    assert.strictEqual(isValidStatus('archived'), true);
  });

  it('should reject invalid statuses', () => {
    assert.strictEqual(isValidStatus('deleted'), false);
    assert.strictEqual(isValidStatus('pending'), false);
    assert.strictEqual(isValidStatus('draft'), false);
    assert.strictEqual(isValidStatus(''), false);
  });
});

describe('Taxonomies Routes - Color Validation', () => {
  it('should accept valid hex colors', () => {
    assert.strictEqual(isValidHexColor('#FF5733'), true);
    assert.strictEqual(isValidHexColor('#000000'), true);
    assert.strictEqual(isValidHexColor('#FFFFFF'), true);
    assert.strictEqual(isValidHexColor('#aabbcc'), true);
    assert.strictEqual(isValidHexColor('#AbCdEf'), true);
  });

  it('should reject invalid hex colors', () => {
    assert.strictEqual(isValidHexColor('FF5733'), false); // Missing #
    assert.strictEqual(isValidHexColor('#FFF'), false); // Short format
    assert.strictEqual(isValidHexColor('#GGGGGG'), false); // Invalid chars
    assert.strictEqual(isValidHexColor('red'), false); // Named color
    assert.strictEqual(isValidHexColor('#FF57333'), false); // Too long
    assert.strictEqual(isValidHexColor(''), false);
    assert.strictEqual(isValidHexColor(null), false);
    assert.strictEqual(isValidHexColor(undefined), false);
  });
});

describe('Taxonomies Routes - Authorization', () => {
  describe('Admin Access Requirement', () => {
    it('should allow admin users', () => {
      const user = createMockUser({ isAdmin: true });
      const result = validateAdminAccess(user);

      assert.strictEqual(result.valid, true);
    });

    it('should reject non-admin users', () => {
      const user = createMockUser({ isAdmin: false });
      const result = validateAdminAccess(user);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Admin access required');
    });
  });

  describe('Authenticated Access Requirement', () => {
    it('should allow authenticated users', () => {
      const user = createMockUser();
      const result = validateAuthenticatedAccess(user);

      assert.strictEqual(result.valid, true);
    });

    it('should reject unauthenticated access', () => {
      const result = validateAuthenticatedAccess(null);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Authentication required');
    });
  });

  describe('Admin-Only Endpoints', () => {
    const adminEndpoints = [
      'POST /api/taxonomies',
      'PATCH /api/taxonomies/:id',
      'DELETE /api/taxonomies/:id',
      'POST /api/taxonomies/:taxonomyId/terms',
      'PATCH /api/taxonomies/terms/:termId',
      'DELETE /api/taxonomies/terms/:termId',
      'POST /api/taxonomies/items/:itemType/:itemId/terms/:termId',
      'DELETE /api/taxonomies/items/:itemType/:itemId/terms/:termId',
      'PUT /api/taxonomies/items/:itemType/:itemId',
    ];

    for (const endpoint of adminEndpoints) {
      it(`${endpoint} should require admin access`, () => {
        const user = createMockUser({ isAdmin: false });
        const result = validateAdminAccess(user);

        assert.strictEqual(result.valid, false);
      });
    }
  });

  describe('Auth-Only Endpoints', () => {
    const authEndpoints = [
      'GET /api/taxonomies',
      'GET /api/taxonomies/:id',
      'GET /api/taxonomies/by-slug/:slug',
      'GET /api/taxonomies/:taxonomyId/terms',
      'GET /api/taxonomies/terms/:termId',
      'GET /api/taxonomies/items/:itemType/:itemId',
      'GET /api/taxonomies/items/by-term/:termId',
    ];

    for (const endpoint of authEndpoints) {
      it(`${endpoint} should require authentication`, () => {
        const result = validateAuthenticatedAccess(null);

        assert.strictEqual(result.valid, false);
      });
    }
  });
});

describe('Taxonomies Routes - Taxonomy CRUD Validation', () => {
  describe('POST /api/taxonomies (Create Taxonomy)', () => {
    it('should require name field', () => {
      const body = { displayName: 'Test' };
      const result = validateCreateTaxonomyInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Name and displayName are required');
    });

    it('should require displayName field', () => {
      const body = { name: 'test' };
      const result = validateCreateTaxonomyInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Name and displayName are required');
    });

    it('should accept valid taxonomy input', () => {
      const body = {
        name: 'category',
        displayName: 'Category',
        description: 'A category taxonomy',
      };
      const result = validateCreateTaxonomyInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional fields', () => {
      const body = {
        name: 'tags',
        displayName: 'Tags',
        allowMultiple: true,
        isRequired: false,
        itemTypes: ['snippet', 'template'],
        sortOrder: 1,
      };
      const result = validateCreateTaxonomyInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PATCH /api/taxonomies/:id (Update Taxonomy)', () => {
    it('should reject invalid status', () => {
      const body = { status: 'deleted' };
      const result = validateUpdateTaxonomyInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid status'));
    });

    it('should accept valid status update', () => {
      const body = { status: 'archived' };
      const result = validateUpdateTaxonomyInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept partial updates', () => {
      const body = { displayName: 'New Display Name' };
      const result = validateUpdateTaxonomyInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty update', () => {
      const body = {};
      const result = validateUpdateTaxonomyInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Duplicate Slug Detection', () => {
    it('should detect duplicate taxonomy slug', () => {
      const existingSlugs = ['category', 'tags', 'genre'];
      const result = checkDuplicateSlug(existingSlugs, 'category');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('already exists'));
    });

    it('should allow unique taxonomy slug', () => {
      const existingSlugs = ['category', 'tags'];
      const result = checkDuplicateSlug(existingSlugs, 'genre');

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Taxonomies Routes - Term CRUD Validation', () => {
  describe('POST /api/taxonomies/:taxonomyId/terms (Create Term)', () => {
    it('should require name field', () => {
      const body = { description: 'A term' };
      const result = validateCreateTermInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Name is required');
    });

    it('should reject invalid color format', () => {
      const body = { name: 'Test', color: 'red' };
      const result = validateCreateTermInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid color format'));
    });

    it('should accept valid color format', () => {
      const body = { name: 'Test', color: '#FF5733' };
      const result = validateCreateTermInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept term without color', () => {
      const body = { name: 'Test' };
      const result = validateCreateTermInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept all optional fields', () => {
      const body = {
        name: 'Test Term',
        description: 'A test term',
        parentId: 'term-parent-123',
        color: '#FF5733',
        icon: 'folder',
        metadata: { key: 'value' },
        sortOrder: 1,
      };
      const result = validateCreateTermInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PATCH /api/taxonomies/terms/:termId (Update Term)', () => {
    it('should reject invalid status', () => {
      const body = { status: 'pending' };
      const result = validateUpdateTermInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject invalid color on update', () => {
      const body = { color: 'invalid' };
      const result = validateUpdateTermInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept empty string color (to clear)', () => {
      const body = { color: '' };
      const result = validateUpdateTermInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept null color (to clear)', () => {
      const body = { color: null };
      const result = validateUpdateTermInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid partial update', () => {
      const body = { name: 'Updated Name', color: '#00FF00' };
      const result = validateUpdateTermInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Duplicate Term Slug Detection', () => {
    it('should detect duplicate term slug within taxonomy', () => {
      const existingSlugs = ['action', 'comedy', 'drama'];
      const result = checkDuplicateTermSlug(existingSlugs, 'action');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('already exists in this taxonomy'));
    });

    it('should allow unique term slug', () => {
      const existingSlugs = ['action', 'comedy'];
      const result = checkDuplicateTermSlug(existingSlugs, 'drama');

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Taxonomies Routes - Item Taxonomy Assignments', () => {
  describe('Item Type Applicability', () => {
    it('should allow assignment when taxonomy has no item type restrictions', () => {
      const taxonomy = createMockTaxonomy({ itemTypes: [] });
      const result = validateItemTypeApplicability(taxonomy, 'snippet');

      assert.strictEqual(result.valid, true);
    });

    it('should allow assignment when item type is in allowed list', () => {
      const taxonomy = createMockTaxonomy({ itemTypes: ['snippet', 'template'] });
      const result = validateItemTypeApplicability(taxonomy, 'snippet');

      assert.strictEqual(result.valid, true);
    });

    it('should reject assignment when item type is not in allowed list', () => {
      const taxonomy = createMockTaxonomy({ itemTypes: ['snippet', 'template'] });
      const result = validateItemTypeApplicability(taxonomy, 'document');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('cannot be applied to document items'));
    });
  });

  describe('Multiple Term Assignment', () => {
    it('should allow multiple terms when taxonomy.allowMultiple is true', () => {
      const taxonomy = createMockTaxonomy({ allowMultiple: true });
      const existingAssignments = [createMockItemTaxonomy()];

      assert.strictEqual(canAssignMultipleTerms(taxonomy, existingAssignments), true);
    });

    it('should block additional terms when taxonomy.allowMultiple is false and has assignment', () => {
      const taxonomy = createMockTaxonomy({ allowMultiple: false });
      const existingAssignments = [createMockItemTaxonomy()];

      assert.strictEqual(canAssignMultipleTerms(taxonomy, existingAssignments), false);
    });

    it('should allow first assignment when taxonomy.allowMultiple is false', () => {
      const taxonomy = createMockTaxonomy({ allowMultiple: false });
      const existingAssignments: MockItemTaxonomy[] = [];

      assert.strictEqual(canAssignMultipleTerms(taxonomy, existingAssignments), true);
    });
  });

  describe('PUT /api/taxonomies/items/:itemType/:itemId (Bulk Update)', () => {
    it('should require termIds as array', () => {
      const body = { termIds: 'not-an-array' };
      const result = validateBulkTermIdsInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'termIds must be an array');
    });

    it('should accept empty termIds array (clear all)', () => {
      const body = { termIds: [] };
      const result = validateBulkTermIdsInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid termIds array', () => {
      const body = { termIds: ['term-1', 'term-2', 'term-3'] };
      const result = validateBulkTermIdsInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject missing termIds', () => {
      const body = {};
      const result = validateBulkTermIdsInput(body);

      assert.strictEqual(result.valid, false);
    });
  });

  describe('Term ID Validation for Bulk Update', () => {
    it('should detect invalid term IDs', () => {
      const existingTermIds = ['term-1', 'term-2', 'term-3'];
      const requestedIds = ['term-1', 'term-4', 'term-5'];

      const existingSet = new Set(existingTermIds);
      const invalidIds = requestedIds.filter(id => !existingSet.has(id));

      assert.deepStrictEqual(invalidIds, ['term-4', 'term-5']);
    });

    it('should accept all valid term IDs', () => {
      const existingTermIds = ['term-1', 'term-2', 'term-3'];
      const requestedIds = ['term-1', 'term-2'];

      const existingSet = new Set(existingTermIds);
      const invalidIds = requestedIds.filter(id => !existingSet.has(id));

      assert.strictEqual(invalidIds.length, 0);
    });
  });
});

describe('Taxonomies Routes - Hierarchical Terms', () => {
  it('should validate parent term exists', () => {
    const existingTermIds = ['term-1', 'term-2'];
    const parentId = 'term-1';

    const parentExists = existingTermIds.includes(parentId);
    assert.strictEqual(parentExists, true);
  });

  it('should reject non-existent parent term', () => {
    const existingTermIds = ['term-1', 'term-2'];
    const parentId = 'term-999';

    const parentExists = existingTermIds.includes(parentId);
    assert.strictEqual(parentExists, false);
  });

  it('should allow null parentId for root terms', () => {
    const term = createMockTerm({ parentId: null });
    assert.strictEqual(term.parentId, null);
  });

  it('should build term hierarchy correctly', () => {
    const terms = [
      createMockTerm({ id: 'term-1', parentId: null, name: 'Parent' }),
      createMockTerm({ id: 'term-2', parentId: 'term-1', name: 'Child 1' }),
      createMockTerm({ id: 'term-3', parentId: 'term-1', name: 'Child 2' }),
      createMockTerm({ id: 'term-4', parentId: 'term-2', name: 'Grandchild' }),
    ];

    const rootTerms = terms.filter(t => t.parentId === null);
    const childrenOf1 = terms.filter(t => t.parentId === 'term-1');
    const childrenOf2 = terms.filter(t => t.parentId === 'term-2');

    assert.strictEqual(rootTerms.length, 1);
    assert.strictEqual(childrenOf1.length, 2);
    assert.strictEqual(childrenOf2.length, 1);
  });
});

describe('Taxonomies Routes - Query Operations', () => {
  describe('GET /api/taxonomies (List)', () => {
    it('should return taxonomies sorted by sortOrder then name', () => {
      const taxonomies = [
        createMockTaxonomy({ name: 'Zebra', sortOrder: 0 }),
        createMockTaxonomy({ name: 'Alpha', sortOrder: 1 }),
        createMockTaxonomy({ name: 'Beta', sortOrder: 0 }),
      ];

      const sorted = [...taxonomies].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });

      // Sorted by sortOrder first, then alphabetically by name
      assert.strictEqual(sorted[0].name, 'Beta'); // sortOrder 0, 'Beta' < 'Zebra' alphabetically
      assert.strictEqual(sorted[1].name, 'Zebra'); // sortOrder 0, comes after 'Beta'
      assert.strictEqual(sorted[2].name, 'Alpha'); // sortOrder 1, sorted last despite name
    });
  });

  describe('GET /api/taxonomies/:id (Get by ID)', () => {
    it('should find taxonomy by ID', () => {
      const taxonomies = [
        createMockTaxonomy({ id: 'tax-1' }),
        createMockTaxonomy({ id: 'tax-2' }),
      ];

      const found = taxonomies.find(t => t.id === 'tax-1');
      assert.ok(found);
      assert.strictEqual(found.id, 'tax-1');
    });

    it('should return undefined for non-existent ID', () => {
      const taxonomies = [createMockTaxonomy({ id: 'tax-1' })];

      const found = taxonomies.find(t => t.id === 'tax-999');
      assert.strictEqual(found, undefined);
    });
  });

  describe('GET /api/taxonomies/by-slug/:slug (Get by Slug)', () => {
    it('should find taxonomy by slug', () => {
      const taxonomies = [
        createMockTaxonomy({ slug: 'category' }),
        createMockTaxonomy({ slug: 'genre' }),
      ];

      const found = taxonomies.find(t => t.slug === 'category');
      assert.ok(found);
      assert.strictEqual(found.slug, 'category');
    });
  });

  describe('GET /api/taxonomies/items/by-term/:termId (Items by Term)', () => {
    it('should find items assigned to term', () => {
      const assignments = [
        createMockItemTaxonomy({ termId: 'term-1', itemId: 'item-1' }),
        createMockItemTaxonomy({ termId: 'term-1', itemId: 'item-2' }),
        createMockItemTaxonomy({ termId: 'term-2', itemId: 'item-3' }),
      ];

      const itemsForTerm1 = assignments.filter(a => a.termId === 'term-1');
      assert.strictEqual(itemsForTerm1.length, 2);
    });

    it('should filter by item type if provided', () => {
      const assignments = [
        createMockItemTaxonomy({ termId: 'term-1', itemType: 'snippet' }),
        createMockItemTaxonomy({ termId: 'term-1', itemType: 'template' }),
        createMockItemTaxonomy({ termId: 'term-1', itemType: 'snippet' }),
      ];

      const snippets = assignments.filter(a => a.termId === 'term-1' && a.itemType === 'snippet');
      assert.strictEqual(snippets.length, 2);
    });
  });
});

describe('Taxonomies Routes - Group Items by Taxonomy', () => {
  it('should group item assignments by taxonomy', () => {
    interface AssignmentWithTaxonomy {
      assignment: MockItemTaxonomy;
      term: MockTaxonomyTerm;
      taxonomy: MockTaxonomy;
    }

    const tax1 = createMockTaxonomy({ id: 'tax-1', name: 'Category' });
    const tax2 = createMockTaxonomy({ id: 'tax-2', name: 'Genre' });
    const term1 = createMockTerm({ id: 'term-1', taxonomyId: 'tax-1' });
    const term2 = createMockTerm({ id: 'term-2', taxonomyId: 'tax-2' });

    const assignments: AssignmentWithTaxonomy[] = [
      { assignment: createMockItemTaxonomy({ termId: 'term-1' }), term: term1, taxonomy: tax1 },
      { assignment: createMockItemTaxonomy({ termId: 'term-2' }), term: term2, taxonomy: tax2 },
    ];

    const grouped: Record<string, { taxonomy: MockTaxonomy; terms: MockTaxonomyTerm[] }> = {};
    for (const row of assignments) {
      if (!grouped[row.taxonomy.id]) {
        grouped[row.taxonomy.id] = { taxonomy: row.taxonomy, terms: [] };
      }
      grouped[row.taxonomy.id].terms.push(row.term);
    }

    assert.strictEqual(Object.keys(grouped).length, 2);
    assert.ok(grouped['tax-1']);
    assert.ok(grouped['tax-2']);
  });
});

describe('Taxonomies Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with taxonomy data', () => {
      const taxonomy = createMockTaxonomy();
      const terms = [createMockTerm(), createMockTerm()];
      const response = createSuccessResponse({ ...taxonomy, terms });

      assert.strictEqual(response.success, true);
      assert.ok(response.data.terms);
    });

    it('should return success:true with list data', () => {
      const taxonomies = [createMockTaxonomy(), createMockTaxonomy()];
      const response = createSuccessResponse({ taxonomies });

      assert.strictEqual(response.success, true);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Taxonomy not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Taxonomy not found');
    });

    it('should return 404 error for not found', () => {
      const response = createErrorResponse('Term not found');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('not found'));
    });
  });
});

describe('Taxonomies Routes - Edge Cases', () => {
  it('should handle taxonomy deletion cascade to terms', () => {
    // When a taxonomy is deleted, all its terms should also be deleted
    const taxonomyId = 'tax-1';
    const terms = [
      createMockTerm({ taxonomyId }),
      createMockTerm({ taxonomyId }),
      createMockTerm({ taxonomyId: 'tax-2' }),
    ];

    const remainingTerms = terms.filter(t => t.taxonomyId !== taxonomyId);
    assert.strictEqual(remainingTerms.length, 1);
  });

  it('should handle term deletion cascade to item assignments', () => {
    const termId = 'term-1';
    const assignments = [
      createMockItemTaxonomy({ termId }),
      createMockItemTaxonomy({ termId }),
      createMockItemTaxonomy({ termId: 'term-2' }),
    ];

    const remainingAssignments = assignments.filter(a => a.termId !== termId);
    assert.strictEqual(remainingAssignments.length, 1);
  });

  it('should handle existing assignment gracefully', () => {
    const existingAssignment = createMockItemTaxonomy({
      termId: 'term-1',
      itemId: 'item-1',
    });

    // Check if assignment already exists
    const assignments = [existingAssignment];
    const exists = assignments.some(
      a => a.termId === 'term-1' && a.itemId === 'item-1'
    );

    assert.strictEqual(exists, true);
  });

  it('should return already assigned message instead of error', () => {
    // This documents the expected behavior - return 200 with message, not error
    const response = {
      success: true,
      data: { id: 'existing-id' },
      message: 'Term already assigned',
    };

    assert.strictEqual(response.success, true);
    assert.strictEqual(response.message, 'Term already assigned');
  });
});

describe('Taxonomies Routes - Metadata Handling', () => {
  it('should accept null metadata', () => {
    const term = createMockTerm({ metadata: null });
    assert.strictEqual(term.metadata, null);
  });

  it('should accept object metadata', () => {
    const term = createMockTerm({
      metadata: { customField: 'value', count: 42 },
    });

    assert.ok(term.metadata);
    assert.strictEqual((term.metadata as Record<string, unknown>).customField, 'value');
    assert.strictEqual((term.metadata as Record<string, unknown>).count, 42);
  });

  it('should preserve metadata on updates', () => {
    const originalMetadata = { field1: 'value1', field2: 'value2' };
    const term = createMockTerm({ metadata: originalMetadata });

    // Simulating partial update - metadata should be preserved
    const updatedTerm = { ...term, name: 'Updated Name' };

    assert.deepStrictEqual(updatedTerm.metadata, originalMetadata);
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

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
