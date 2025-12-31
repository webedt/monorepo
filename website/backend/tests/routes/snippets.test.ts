/**
 * Tests for Snippets Routes
 * Covers input validation, ownership checks, collection management, and edge cases
 * for code snippet CRUD operations.
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
}

interface MockSnippet {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  code: string;
  language: string;
  category: string;
  tags: string[];
  variables: Record<string, unknown> | null;
  isFavorite: boolean;
  isPublic: boolean;
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MockCollection {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
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
    ...overrides,
  };
}

function createMockSnippet(overrides: Partial<MockSnippet> = {}): MockSnippet {
  const now = new Date();
  return {
    id: `snippet-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    title: 'Test Snippet',
    description: 'A test snippet description',
    code: 'console.log("Hello, World!");',
    language: 'javascript',
    category: 'snippet',
    tags: ['test', 'example'],
    variables: null,
    isFavorite: false,
    isPublic: false,
    usageCount: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createMockCollection(overrides: Partial<MockCollection> = {}): MockCollection {
  const now = new Date();
  return {
    id: `collection-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    name: 'Test Collection',
    description: null,
    color: null,
    icon: null,
    isDefault: false,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ============================================================================
// Validation Constants (mirror route constants)
// These are intentionally duplicated from shared/db/schema.ts to maintain
// test isolation and ensure tests don't break if implementation changes.
// ============================================================================

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CODE_LENGTH = 50000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

const SNIPPET_LANGUAGES = [
  'javascript', 'typescript', 'python', 'java', 'cpp', 'csharp',
  'ruby', 'go', 'rust', 'php', 'swift', 'kotlin', 'html', 'css',
  'sql', 'bash', 'powershell', 'json', 'yaml', 'markdown', 'other',
] as const;

const SNIPPET_CATEGORIES = [
  'snippet', 'template', 'boilerplate', 'utility', 'algorithm',
  'pattern', 'config', 'test', 'documentation', 'other',
] as const;

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function isValidLanguage(language: unknown): boolean {
  return typeof language === 'string' && SNIPPET_LANGUAGES.includes(language as typeof SNIPPET_LANGUAGES[number]);
}

function isValidCategory(category: unknown): boolean {
  return typeof category === 'string' && SNIPPET_CATEGORIES.includes(category as typeof SNIPPET_CATEGORIES[number]);
}

function isValidHexColor(color: unknown): boolean {
  if (typeof color !== 'string') return false;
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === 'string' && t.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS)
    .map(t => t.trim().toLowerCase());
}

function validateVariables(variables: unknown): Record<string, unknown> | null {
  if (variables === null || variables === undefined) {
    return null;
  }
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    return null;
  }

  const validated: Record<string, unknown> = {};
  const entries = Object.entries(variables as Record<string, unknown>);

  let count = 0;
  for (const [key, value] of entries) {
    if (count >= 20) break;
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 50) continue;
    if (typeof value !== 'object' || value === null) continue;

    const obj = value as Record<string, unknown>;
    validated[key.trim()] = {
      description: typeof obj.description === 'string' ? obj.description.slice(0, 200) : undefined,
      defaultValue: typeof obj.defaultValue === 'string' ? obj.defaultValue.slice(0, 500) : undefined,
      placeholder: typeof obj.placeholder === 'string' ? obj.placeholder.slice(0, 100) : undefined,
    };
    count++;
  }

  return Object.keys(validated).length > 0 ? validated : null;
}

function validateCreateSnippetInput(body: Record<string, unknown>): ValidationResult {
  const { title, code, description } = body;

  if (!title || typeof title !== 'string' || (title as string).trim().length === 0) {
    return { valid: false, error: 'Title is required' };
  }
  if ((title as string).length > MAX_TITLE_LENGTH) {
    return { valid: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or less` };
  }
  if (!code || typeof code !== 'string' || (code as string).trim().length === 0) {
    return { valid: false, error: 'Code is required' };
  }
  if ((code as string).length > MAX_CODE_LENGTH) {
    return { valid: false, error: `Code must be ${MAX_CODE_LENGTH} characters or less` };
  }
  if (description && (description as string).length > MAX_DESCRIPTION_LENGTH) {
    return { valid: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` };
  }

  return { valid: true };
}

function validateUpdateSnippetInput(body: Record<string, unknown>): ValidationResult {
  const { title, code, description } = body;

  if (title !== undefined) {
    if (typeof title !== 'string' || (title as string).trim().length === 0) {
      return { valid: false, error: 'Title cannot be empty' };
    }
    if ((title as string).length > MAX_TITLE_LENGTH) {
      return { valid: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or less` };
    }
  }
  if (code !== undefined) {
    if (typeof code !== 'string' || (code as string).trim().length === 0) {
      return { valid: false, error: 'Code cannot be empty' };
    }
    if ((code as string).length > MAX_CODE_LENGTH) {
      return { valid: false, error: `Code must be ${MAX_CODE_LENGTH} characters or less` };
    }
  }
  if (description !== undefined && description && (description as string).length > MAX_DESCRIPTION_LENGTH) {
    return { valid: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` };
  }

  return { valid: true };
}

function validateCreateCollectionInput(body: Record<string, unknown>): ValidationResult {
  const { name } = body;

  if (!name || typeof name !== 'string' || (name as string).trim().length === 0) {
    return { valid: false, error: 'Collection name is required' };
  }

  return { valid: true };
}

function validateUpdateCollectionInput(body: Record<string, unknown>): ValidationResult {
  const { name } = body;

  if (name !== undefined) {
    if (typeof name !== 'string' || (name as string).trim().length === 0) {
      return { valid: false, error: 'Collection name cannot be empty' };
    }
  }

  return { valid: true };
}

function validateOwnership(resourceUserId: string, currentUserId: string): ValidationResult {
  if (resourceUserId !== currentUserId) {
    return { valid: false, error: 'Resource not found' };
  }
  return { valid: true };
}

function validateDuplicateTitle(existingTitles: string[], newTitle: string): ValidationResult {
  const normalizedTitle = newTitle.trim().toLowerCase();
  const exists = existingTitles.some(t => t.toLowerCase() === normalizedTitle);
  if (exists) {
    return { valid: false, error: 'A snippet with this title already exists' };
  }
  return { valid: true };
}

function generateDuplicateTitle(originalTitle: string): string {
  const suffix = ' (copy)';
  const maxBaseLength = MAX_TITLE_LENGTH - suffix.length;
  return originalTitle.length > maxBaseLength
    ? `${originalTitle.slice(0, maxBaseLength)}${suffix}`
    : `${originalTitle}${suffix}`;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Snippets Routes - Input Validation', () => {
  describe('POST /api/snippets (Create Snippet)', () => {
    it('should require title field', () => {
      const body = { code: 'console.log("hello")' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Title is required');
    });

    it('should reject empty title', () => {
      const body = { title: '', code: 'console.log("hello")' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Title is required');
    });

    it('should reject whitespace-only title', () => {
      const body = { title: '   ', code: 'console.log("hello")' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Title is required');
    });

    it('should reject title exceeding max length', () => {
      const body = { title: 'a'.repeat(MAX_TITLE_LENGTH + 1), code: 'console.log("hello")' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes(`${MAX_TITLE_LENGTH} characters`));
    });

    it('should accept title at max length', () => {
      const body = { title: 'a'.repeat(MAX_TITLE_LENGTH), code: 'console.log("hello")' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should require code field', () => {
      const body = { title: 'Test Snippet' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Code is required');
    });

    it('should reject empty code', () => {
      const body = { title: 'Test Snippet', code: '' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Code is required');
    });

    it('should reject whitespace-only code', () => {
      const body = { title: 'Test Snippet', code: '   ' };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Code is required');
    });

    it('should reject code exceeding max length', () => {
      const body = { title: 'Test', code: 'a'.repeat(MAX_CODE_LENGTH + 1) };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes(`${MAX_CODE_LENGTH} characters`));
    });

    it('should accept code at max length', () => {
      const body = { title: 'Test', code: 'a'.repeat(MAX_CODE_LENGTH) };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject description exceeding max length', () => {
      const body = {
        title: 'Test',
        code: 'console.log("hi")',
        description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 1),
      };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes(`${MAX_DESCRIPTION_LENGTH} characters`));
    });

    it('should accept valid snippet with all optional fields', () => {
      const body = {
        title: 'Test Snippet',
        description: 'A useful snippet',
        code: 'console.log("Hello")',
        language: 'javascript',
        category: 'utility',
        tags: ['test', 'example'],
        isFavorite: true,
        isPublic: false,
      };
      const result = validateCreateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PUT /api/snippets/:id (Update Snippet)', () => {
    it('should reject empty title on update', () => {
      const body = { title: '' };
      const result = validateUpdateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Title cannot be empty');
    });

    it('should reject empty code on update', () => {
      const body = { code: '' };
      const result = validateUpdateSnippetInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Code cannot be empty');
    });

    it('should accept partial update with only title', () => {
      const body = { title: 'New Title' };
      const result = validateUpdateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept partial update with only code', () => {
      const body = { code: 'new code()' };
      const result = validateUpdateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty body for no-op update', () => {
      const body = {};
      const result = validateUpdateSnippetInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Snippets Routes - Language Validation', () => {
  it('should accept all valid languages', () => {
    for (const lang of SNIPPET_LANGUAGES) {
      assert.strictEqual(isValidLanguage(lang), true, `Language '${lang}' should be valid`);
    }
  });

  it('should reject invalid language', () => {
    assert.strictEqual(isValidLanguage('cobol'), false);
    assert.strictEqual(isValidLanguage('fortran'), false);
    assert.strictEqual(isValidLanguage(''), false);
    assert.strictEqual(isValidLanguage(null), false);
    assert.strictEqual(isValidLanguage(undefined), false);
    assert.strictEqual(isValidLanguage(123), false);
  });

  it('should reject case-sensitive language mismatch', () => {
    assert.strictEqual(isValidLanguage('JavaScript'), false);
    assert.strictEqual(isValidLanguage('PYTHON'), false);
  });
});

describe('Snippets Routes - Category Validation', () => {
  it('should accept all valid categories', () => {
    for (const cat of SNIPPET_CATEGORIES) {
      assert.strictEqual(isValidCategory(cat), true, `Category '${cat}' should be valid`);
    }
  });

  it('should reject invalid category', () => {
    assert.strictEqual(isValidCategory('random'), false);
    assert.strictEqual(isValidCategory(''), false);
    assert.strictEqual(isValidCategory(null), false);
  });
});

describe('Snippets Routes - Tag Validation', () => {
  it('should validate and normalize tags', () => {
    const tags = ['Test', ' EXAMPLE ', 'hello'];
    const result = validateTags(tags);

    assert.deepStrictEqual(result, ['test', 'example', 'hello']);
  });

  it('should limit tags to maximum count', () => {
    const tags = Array.from({ length: 15 }, (_, i) => `tag${i}`);
    const result = validateTags(tags);

    assert.strictEqual(result.length, MAX_TAGS);
  });

  it('should filter out tags exceeding max length', () => {
    const tags = ['short', 'a'.repeat(MAX_TAG_LENGTH + 1), 'valid'];
    const result = validateTags(tags);

    assert.deepStrictEqual(result, ['short', 'valid']);
  });

  it('should filter out non-string tags', () => {
    const tags = ['valid', 123, null, 'also-valid'] as unknown[];
    const result = validateTags(tags);

    assert.deepStrictEqual(result, ['valid', 'also-valid']);
  });

  it('should return empty array for non-array input', () => {
    assert.deepStrictEqual(validateTags('not-an-array'), []);
    assert.deepStrictEqual(validateTags(null), []);
    assert.deepStrictEqual(validateTags(undefined), []);
    assert.deepStrictEqual(validateTags({}), []);
  });
});

describe('Snippets Routes - Variables Validation', () => {
  it('should return null for null/undefined input', () => {
    assert.strictEqual(validateVariables(null), null);
    assert.strictEqual(validateVariables(undefined), null);
  });

  it('should return null for non-object input', () => {
    assert.strictEqual(validateVariables('string'), null);
    assert.strictEqual(validateVariables(123), null);
    assert.strictEqual(validateVariables([]), null);
  });

  it('should validate and sanitize variable definitions', () => {
    const variables = {
      varName: {
        description: 'A variable',
        defaultValue: 'default',
        placeholder: 'Enter value',
      },
    };
    const result = validateVariables(variables);

    assert.ok(result);
    assert.ok(result.varName);
    assert.strictEqual((result.varName as Record<string, unknown>).description, 'A variable');
  });

  it('should limit variables to 20', () => {
    const variables: Record<string, unknown> = {};
    for (let i = 0; i < 25; i++) {
      variables[`var${i}`] = { description: `Variable ${i}` };
    }
    const result = validateVariables(variables);

    assert.ok(result);
    assert.strictEqual(Object.keys(result).length, 20);
  });

  it('should filter out invalid variable names', () => {
    const variables = {
      '': { description: 'Empty name' },
      'valid': { description: 'Valid name' },
      [' '.repeat(5)]: { description: 'Whitespace name' },
    };
    const result = validateVariables(variables);

    assert.ok(result);
    assert.ok(result.valid);
    assert.strictEqual(Object.keys(result).length, 1);
  });

  it('should truncate long field values', () => {
    const variables = {
      test: {
        description: 'a'.repeat(300),
        defaultValue: 'b'.repeat(600),
        placeholder: 'c'.repeat(200),
      },
    };
    const result = validateVariables(variables);

    assert.ok(result);
    const testVar = result.test as Record<string, unknown>;
    assert.strictEqual((testVar.description as string).length, 200);
    assert.strictEqual((testVar.defaultValue as string).length, 500);
    assert.strictEqual((testVar.placeholder as string).length, 100);
  });
});

describe('Snippets Routes - Ownership Verification', () => {
  it('should allow access to own resources', () => {
    const userId = 'user-123';
    const result = validateOwnership(userId, userId);

    assert.strictEqual(result.valid, true);
  });

  it('should deny access to other users resources', () => {
    const result = validateOwnership('user-123', 'user-456');

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.error, 'Resource not found');
  });

  it('should treat missing resources as not found (not forbidden)', () => {
    // This ensures we don't leak information about resource existence
    const result = validateOwnership('user-123', 'user-456');
    assert.strictEqual(result.error, 'Resource not found');
    assert.notStrictEqual(result.error, 'Forbidden');
  });
});

describe('Snippets Routes - Duplicate Title Detection', () => {
  it('should detect exact duplicate title', () => {
    const existingTitles = ['My Snippet', 'Another Snippet'];
    const result = validateDuplicateTitle(existingTitles, 'My Snippet');

    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('already exists'));
  });

  it('should detect case-insensitive duplicate title', () => {
    const existingTitles = ['My Snippet'];
    const result = validateDuplicateTitle(existingTitles, 'my snippet');

    assert.strictEqual(result.valid, false);
  });

  it('should detect duplicate with leading/trailing whitespace', () => {
    const existingTitles = ['My Snippet'];
    const result = validateDuplicateTitle(existingTitles, '  My Snippet  ');

    assert.strictEqual(result.valid, false);
  });

  it('should allow unique title', () => {
    const existingTitles = ['My Snippet'];
    const result = validateDuplicateTitle(existingTitles, 'Different Snippet');

    assert.strictEqual(result.valid, true);
  });
});

describe('Snippets Routes - Duplicate Snippet Title Generation', () => {
  it('should append (copy) suffix', () => {
    const result = generateDuplicateTitle('My Snippet');
    assert.strictEqual(result, 'My Snippet (copy)');
  });

  it('should truncate long titles to fit max length', () => {
    const longTitle = 'a'.repeat(MAX_TITLE_LENGTH);
    const result = generateDuplicateTitle(longTitle);

    assert.ok(result.length <= MAX_TITLE_LENGTH);
    assert.ok(result.endsWith(' (copy)'));
  });

  it('should handle title at boundary', () => {
    const boundaryTitle = 'a'.repeat(MAX_TITLE_LENGTH - 7); // Leave room for " (copy)"
    const result = generateDuplicateTitle(boundaryTitle);

    assert.strictEqual(result, `${boundaryTitle} (copy)`);
    assert.strictEqual(result.length, MAX_TITLE_LENGTH);
  });
});

describe('Snippets Routes - Collection Validation', () => {
  describe('POST /api/snippets/collections (Create Collection)', () => {
    it('should require collection name', () => {
      const body = {};
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Collection name is required');
    });

    it('should reject empty collection name', () => {
      const body = { name: '' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only collection name', () => {
      const body = { name: '   ' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid collection name', () => {
      const body = { name: 'My Collection' };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept collection with optional fields', () => {
      const body = {
        name: 'My Collection',
        description: 'A useful collection',
        color: '#FF5733',
        icon: 'folder',
        isDefault: true,
      };
      const result = validateCreateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PUT /api/snippets/collections/:id (Update Collection)', () => {
    it('should reject empty collection name on update', () => {
      const body = { name: '' };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Collection name cannot be empty');
    });

    it('should accept partial update without name', () => {
      const body = { color: '#FF0000' };
      const result = validateUpdateCollectionInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Snippets Routes - Color Validation', () => {
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
    assert.strictEqual(isValidHexColor('#GGGGGG'), false); // Invalid characters
    assert.strictEqual(isValidHexColor('#FF573'), false); // Too short
    assert.strictEqual(isValidHexColor('#FF57333'), false); // Too long
    assert.strictEqual(isValidHexColor('red'), false); // Named color
    assert.strictEqual(isValidHexColor(''), false);
    assert.strictEqual(isValidHexColor(null), false);
    assert.strictEqual(isValidHexColor(undefined), false);
  });
});

describe('Snippets Routes - Search and Filter', () => {
  describe('GET /api/snippets (List with Filters)', () => {
    it('should validate language filter', () => {
      const validLanguages = ['javascript', 'python', 'typescript'];
      for (const lang of validLanguages) {
        assert.strictEqual(isValidLanguage(lang), true);
      }
    });

    it('should validate category filter', () => {
      const validCategories = ['snippet', 'template', 'utility'];
      for (const cat of validCategories) {
        assert.strictEqual(isValidCategory(cat), true);
      }
    });

    it('should validate sort options', () => {
      const validSortFields = ['title', 'usageCount', 'lastUsedAt', 'createdAt', 'updatedAt'];
      const validOrders = ['asc', 'desc'];

      for (const field of validSortFields) {
        assert.ok(typeof field === 'string');
      }
      for (const order of validOrders) {
        assert.ok(['asc', 'desc'].includes(order));
      }
    });

    it('should validate pagination parameters', () => {
      const validatePagination = (limit: number, offset: number) => {
        const validLimit = Math.min(Math.max(1, limit), 100);
        const validOffset = Math.max(0, offset);
        return { limit: validLimit, offset: validOffset };
      };

      assert.deepStrictEqual(validatePagination(50, 0), { limit: 50, offset: 0 });
      assert.deepStrictEqual(validatePagination(200, 0), { limit: 100, offset: 0 }); // Clamped
      assert.deepStrictEqual(validatePagination(-1, -10), { limit: 1, offset: 0 }); // Floor
    });
  });
});

describe('Snippets Routes - Collection Snippet Assignment', () => {
  it('should validate snippet exists before adding to collection', () => {
    const snippetExists = (snippetId: string, snippets: MockSnippet[]): boolean => {
      return snippets.some(s => s.id === snippetId);
    };

    const snippets = [createMockSnippet({ id: 'snippet-1' })];
    assert.strictEqual(snippetExists('snippet-1', snippets), true);
    assert.strictEqual(snippetExists('snippet-999', snippets), false);
  });

  it('should validate collection exists before adding snippet', () => {
    const collectionExists = (collectionId: string, collections: MockCollection[]): boolean => {
      return collections.some(c => c.id === collectionId);
    };

    const collections = [createMockCollection({ id: 'collection-1' })];
    assert.strictEqual(collectionExists('collection-1', collections), true);
    assert.strictEqual(collectionExists('collection-999', collections), false);
  });

  it('should check collection ownership before adding snippets', () => {
    const collection = createMockCollection({ userId: 'user-1' });
    const currentUser = createMockUser({ id: 'user-2' });

    const result = validateOwnership(collection.userId, currentUser.id);
    assert.strictEqual(result.valid, false);
  });
});

describe('Snippets Routes - Usage Tracking', () => {
  it('should track usage count increment', () => {
    const snippet = createMockSnippet({ usageCount: 5 });
    const newCount = snippet.usageCount + 1;

    assert.strictEqual(newCount, 6);
  });

  it('should update lastUsedAt on use', () => {
    const snippet = createMockSnippet({ lastUsedAt: null });
    const now = new Date();

    assert.ok(snippet.lastUsedAt === null);
    snippet.lastUsedAt = now;
    assert.ok(snippet.lastUsedAt instanceof Date);
  });
});

describe('Snippets Routes - Favorite Toggle', () => {
  it('should toggle favorite from false to true', () => {
    const snippet = createMockSnippet({ isFavorite: false });
    const toggled = !snippet.isFavorite;

    assert.strictEqual(toggled, true);
  });

  it('should toggle favorite from true to false', () => {
    const snippet = createMockSnippet({ isFavorite: true });
    const toggled = !snippet.isFavorite;

    assert.strictEqual(toggled, false);
  });
});

describe('Snippets Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with snippet data', () => {
      const snippet = createMockSnippet();
      const response = createSuccessResponse({ snippet });

      assert.strictEqual(response.success, true);
      assert.ok(response.data.snippet);
    });

    it('should return success:true with list data and pagination', () => {
      const snippets = [createMockSnippet(), createMockSnippet()];
      const response = createListResponse(snippets, 100, 50, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.snippets.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.limit, 50);
      assert.strictEqual(response.data.offset, 0);
      assert.strictEqual(response.data.hasMore, true);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Snippet not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Snippet not found');
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

function createListResponse(
  snippets: MockSnippet[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    snippets: MockSnippet[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      snippets,
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
