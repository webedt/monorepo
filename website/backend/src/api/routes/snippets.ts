/**
 * Snippets Routes
 * Handles user code snippets and templates for common code patterns
 */

import { Router, Request, Response } from 'express';
import {
  db,
  snippets,
  snippetCollections,
  snippetsInCollections,
  SNIPPET_LANGUAGES,
  SNIPPET_CATEGORIES,
  eq,
  and,
  desc,
  asc,
  sql,
  ilike,
  or,
} from '@webedt/shared';
import type { SnippetLanguage, SnippetCategory } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { isDatabaseError, isUniqueConstraintError } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Validation constants
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CODE_LENGTH = 50000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;

// Validation helpers
function isValidHexColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR_REGEX.test(color);
}

function isValidLanguage(lang: unknown): lang is SnippetLanguage {
  return typeof lang === 'string' && (SNIPPET_LANGUAGES as readonly string[]).includes(lang);
}

function isValidCategory(cat: unknown): cat is SnippetCategory {
  return typeof cat === 'string' && (SNIPPET_CATEGORIES as readonly string[]).includes(cat);
}

function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t): t is string => typeof t === 'string' && t.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS)
    .map(t => t.trim().toLowerCase());
}

type SnippetVariables = Record<string, {
  description?: string;
  defaultValue?: string;
  placeholder?: string;
}>;

function validateVariables(variables: unknown): SnippetVariables | null {
  if (variables === null || variables === undefined) {
    return null;
  }
  if (typeof variables !== 'object' || Array.isArray(variables)) {
    return null;
  }

  const validated: SnippetVariables = {};
  const entries = Object.entries(variables as Record<string, unknown>);

  // Limit to 20 variables max
  let count = 0;
  for (const [key, value] of entries) {
    if (count >= 20) break;
    // Validate key (variable name)
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 50) continue;
    // Skip if value is not an object
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

// ===========================================================================
// SNIPPET ROUTES
// ===========================================================================

// List user's snippets with optional filtering and pagination
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const {
      language,
      category,
      search,
      favorite,
      collectionId,
      sortBy = 'updatedAt',
      order = 'desc',
      limit: limitParam,
      offset: offsetParam,
    } = req.query;

    // Parse pagination parameters
    const limit = Math.min(Math.max(parseInt(limitParam as string, 10) || 50, 1), 100);
    const offset = Math.max(parseInt(offsetParam as string, 10) || 0, 0);

    // Build base query conditions
    const conditions = [eq(snippets.userId, authReq.user!.id)];

    // Apply filters
    if (language && isValidLanguage(language)) {
      conditions.push(eq(snippets.language, language));
    }
    if (category && isValidCategory(category)) {
      conditions.push(eq(snippets.category, category));
    }
    if (favorite === 'true') {
      conditions.push(eq(snippets.isFavorite, true));
    }

    // Apply search filter at database level
    if (typeof search === 'string' && search.trim()) {
      const searchPattern = `%${search.trim()}%`;
      conditions.push(
        or(
          ilike(snippets.title, searchPattern),
          ilike(snippets.description, searchPattern),
          ilike(snippets.code, searchPattern)
        )!
      );
    }

    // Filter by collection if specified - use a subquery approach
    let snippetIdsInCollection: Set<string> | null = null;
    if (typeof collectionId === 'string') {
      const collectionSnippetIds = await db
        .select({ snippetId: snippetsInCollections.snippetId })
        .from(snippetsInCollections)
        .where(eq(snippetsInCollections.collectionId, collectionId));

      snippetIdsInCollection = new Set(collectionSnippetIds.map(c => c.snippetId));
    }

    // Build sort order
    const sortColumn = (() => {
      switch (sortBy) {
        case 'title': return snippets.title;
        case 'usageCount': return snippets.usageCount;
        case 'lastUsedAt': return snippets.lastUsedAt;
        case 'createdAt': return snippets.createdAt;
        case 'updatedAt':
        default: return snippets.updatedAt;
      }
    })();
    const orderDirection = order === 'asc' ? asc(sortColumn) : desc(sortColumn);

    // Get total count for pagination
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(snippets)
      .where(and(...conditions));
    let total = countResult[0]?.count || 0;

    // Get snippets with pagination
    let userSnippets = await db
      .select()
      .from(snippets)
      .where(and(...conditions))
      .orderBy(orderDirection)
      .limit(limit)
      .offset(offset);

    // Apply collection filter in-memory if needed (after main query for pagination)
    if (snippetIdsInCollection !== null) {
      userSnippets = userSnippets.filter(s => snippetIdsInCollection!.has(s.id));
      // Note: total count may be inaccurate when filtering by collection
      // For accurate count, would need a more complex query
    }

    res.json({
      success: true,
      data: {
        snippets: userSnippets,
        total,
        limit,
        offset,
        languages: SNIPPET_LANGUAGES,
        categories: SNIPPET_CATEGORIES,
      },
    });
  } catch (error) {
    logger.error('List snippets error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to fetch snippets' });
  }
});

// Get a single snippet
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    const [snippet] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!snippet) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    // Get collections this snippet belongs to
    const collections = await db
      .select({
        id: snippetCollections.id,
        name: snippetCollections.name,
        color: snippetCollections.color,
        icon: snippetCollections.icon,
      })
      .from(snippetsInCollections)
      .innerJoin(snippetCollections, eq(snippetsInCollections.collectionId, snippetCollections.id))
      .where(eq(snippetsInCollections.snippetId, id));

    res.json({
      success: true,
      data: {
        ...snippet,
        collections,
      },
    });
  } catch (error) {
    logger.error('Get snippet error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to fetch snippet' });
  }
});

// Create a new snippet
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const {
      title,
      description,
      code,
      language = 'other',
      category = 'snippet',
      tags = [],
      variables,
      isFavorite = false,
      isPublic = false,
      collectionIds = [],
    } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Title is required' });
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
      res.status(400).json({ success: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or less` });
      return;
    }
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Code is required' });
      return;
    }
    if (code.length > MAX_CODE_LENGTH) {
      res.status(400).json({ success: false, error: `Code must be ${MAX_CODE_LENGTH} characters or less` });
      return;
    }
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ success: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` });
      return;
    }

    const snippetId = uuidv4();
    const validatedTags = validateTags(tags);

    // Create snippet
    const [newSnippet] = await db
      .insert(snippets)
      .values({
        id: snippetId,
        userId: authReq.user!.id,
        title: title.trim(),
        description: description?.trim() || null,
        code: code.trim(),
        language: isValidLanguage(language) ? language : 'other',
        category: isValidCategory(category) ? category : 'snippet',
        tags: validatedTags,
        variables: validateVariables(variables),
        isFavorite: Boolean(isFavorite),
        isPublic: Boolean(isPublic),
      })
      .returning();

    // Add to collections if specified
    if (Array.isArray(collectionIds) && collectionIds.length > 0) {
      // Verify collections belong to user
      const userCollections = await db
        .select({ id: snippetCollections.id })
        .from(snippetCollections)
        .where(eq(snippetCollections.userId, authReq.user!.id));

      const userCollectionIds = new Set(userCollections.map(c => c.id));
      const validCollectionIds = collectionIds.filter(id => userCollectionIds.has(id));

      if (validCollectionIds.length > 0) {
        await db.insert(snippetsInCollections).values(
          validCollectionIds.map(collectionId => ({
            id: uuidv4(),
            snippetId,
            collectionId,
          }))
        );
      }
    }

    logger.info(`Created snippet ${snippetId}`, {
      component: 'Snippets',
      snippetId,
      userId: authReq.user!.id,
      language,
      category,
    });

    res.status(201).json({
      success: true,
      data: newSnippet,
    });
  } catch (error) {
    logger.error('Create snippet error', error as Error, { component: 'Snippets' });

    // Check for unique constraint violation
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'A snippet with this title already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to create snippet' });
  }
});

// Update a snippet
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const {
      title,
      description,
      code,
      language,
      category,
      tags,
      variables,
      isFavorite,
      isPublic,
    } = req.body;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    // Build update object
    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length === 0) {
        res.status(400).json({ success: false, error: 'Title cannot be empty' });
        return;
      }
      if (title.length > MAX_TITLE_LENGTH) {
        res.status(400).json({ success: false, error: `Title must be ${MAX_TITLE_LENGTH} characters or less` });
        return;
      }
      updates.title = title.trim();
    }
    if (description !== undefined) {
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        res.status(400).json({ success: false, error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` });
        return;
      }
      updates.description = description?.trim() || null;
    }
    if (code !== undefined) {
      if (typeof code !== 'string' || code.trim().length === 0) {
        res.status(400).json({ success: false, error: 'Code cannot be empty' });
        return;
      }
      if (code.length > MAX_CODE_LENGTH) {
        res.status(400).json({ success: false, error: `Code must be ${MAX_CODE_LENGTH} characters or less` });
        return;
      }
      updates.code = code.trim();
    }
    if (language !== undefined && isValidLanguage(language)) {
      updates.language = language;
    }
    if (category !== undefined && isValidCategory(category)) {
      updates.category = category;
    }
    if (tags !== undefined) {
      updates.tags = validateTags(tags);
    }
    if (variables !== undefined) {
      updates.variables = validateVariables(variables);
    }
    if (isFavorite !== undefined) {
      updates.isFavorite = Boolean(isFavorite);
    }
    if (isPublic !== undefined) {
      updates.isPublic = Boolean(isPublic);
    }

    const [updated] = await db
      .update(snippets)
      .set(updates)
      .where(eq(snippets.id, id))
      .returning();

    logger.info(`Updated snippet ${id}`, {
      component: 'Snippets',
      snippetId: id,
      userId: authReq.user!.id,
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error('Update snippet error', error as Error, { component: 'Snippets' });

    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'A snippet with this title already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to update snippet' });
  }
});

// Delete a snippet
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    // Delete (cascade will remove from collections)
    await db.delete(snippets).where(eq(snippets.id, id));

    logger.info(`Deleted snippet ${id}`, {
      component: 'Snippets',
      snippetId: id,
      userId: authReq.user!.id,
    });

    res.json({
      success: true,
      message: 'Snippet deleted',
    });
  } catch (error) {
    logger.error('Delete snippet error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to delete snippet' });
  }
});

// Record snippet usage (increment usage count)
router.post('/:id/use', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    const [updated] = await db
      .update(snippets)
      .set({
        usageCount: sql`${snippets.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(eq(snippets.id, id))
      .returning();

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error('Record snippet usage error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to record usage' });
  }
});

// Toggle favorite status
router.post('/:id/favorite', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    const [updated] = await db
      .update(snippets)
      .set({
        isFavorite: !existing.isFavorite,
        updatedAt: new Date(),
      })
      .where(eq(snippets.id, id))
      .returning();

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error('Toggle favorite error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to toggle favorite' });
  }
});

// Duplicate a snippet
router.post('/:id/duplicate', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, id), eq(snippets.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    const newId = uuidv4();
    // Ensure duplicated title fits within MAX_TITLE_LENGTH
    const suffix = ' (copy)';
    const maxBaseLength = MAX_TITLE_LENGTH - suffix.length;
    const duplicateTitle = existing.title.length > maxBaseLength
      ? `${existing.title.slice(0, maxBaseLength)}${suffix}`
      : `${existing.title}${suffix}`;

    const [duplicated] = await db
      .insert(snippets)
      .values({
        id: newId,
        userId: authReq.user!.id,
        title: duplicateTitle,
        description: existing.description,
        code: existing.code,
        language: existing.language,
        category: existing.category,
        tags: existing.tags,
        variables: existing.variables,
        isFavorite: false,
        isPublic: false,
        usageCount: 0,
      })
      .returning();

    logger.info(`Duplicated snippet ${id} -> ${newId}`, {
      component: 'Snippets',
      originalId: id,
      newId,
      userId: authReq.user!.id,
    });

    res.status(201).json({
      success: true,
      data: duplicated,
    });
  } catch (error) {
    logger.error('Duplicate snippet error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to duplicate snippet' });
  }
});

// ===========================================================================
// COLLECTION ROUTES
// ===========================================================================

// List user's snippet collections
router.get('/collections/list', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const collections = await db
      .select()
      .from(snippetCollections)
      .where(eq(snippetCollections.userId, authReq.user!.id))
      .orderBy(asc(snippetCollections.sortOrder), asc(snippetCollections.name));

    // Get snippet counts per collection, filtered by user's collections only
    const userCollectionIds = collections.map(c => c.id);
    let countMap = new Map<string, number>();

    if (userCollectionIds.length > 0) {
      const collectionCounts = await db
        .select({
          collectionId: snippetsInCollections.collectionId,
          count: sql<number>`count(*)::int`,
        })
        .from(snippetsInCollections)
        .where(sql`${snippetsInCollections.collectionId} = ANY(${userCollectionIds})`)
        .groupBy(snippetsInCollections.collectionId);

      countMap = new Map(collectionCounts.map(c => [c.collectionId, c.count]));
    }

    const collectionsWithCounts = collections.map(c => ({
      ...c,
      snippetCount: countMap.get(c.id) || 0,
    }));

    res.json({
      success: true,
      data: {
        collections: collectionsWithCounts,
        total: collections.length,
      },
    });
  } catch (error) {
    logger.error('List snippet collections error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to fetch collections' });
  }
});

// Create a snippet collection
router.post('/collections', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { name, description, color, icon, isDefault = false } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Collection name is required' });
      return;
    }

    const collectionId = uuidv4();

    // If this is set as default, clear other defaults first
    if (isDefault) {
      await db
        .update(snippetCollections)
        .set({ isDefault: false })
        .where(eq(snippetCollections.userId, authReq.user!.id));
    }

    const [newCollection] = await db
      .insert(snippetCollections)
      .values({
        id: collectionId,
        userId: authReq.user!.id,
        name: name.trim(),
        description: description?.trim() || null,
        color: isValidHexColor(color) ? color : null,
        icon: icon || null,
        isDefault: Boolean(isDefault),
      })
      .returning();

    logger.info(`Created snippet collection ${collectionId}`, {
      component: 'Snippets',
      collectionId,
      userId: authReq.user!.id,
    });

    res.status(201).json({
      success: true,
      data: newCollection,
    });
  } catch (error) {
    logger.error('Create snippet collection error', error as Error, { component: 'Snippets' });

    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'A collection with this name already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to create collection' });
  }
});

// Update a snippet collection
router.put('/collections/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { name, description, color, icon, sortOrder, isDefault } = req.body;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippetCollections)
      .where(and(eq(snippetCollections.id, id), eq(snippetCollections.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ success: false, error: 'Collection name cannot be empty' });
        return;
      }
      updates.name = name.trim();
    }
    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }
    if (color !== undefined) {
      updates.color = isValidHexColor(color) ? color : null;
    }
    if (icon !== undefined) {
      updates.icon = icon || null;
    }
    if (sortOrder !== undefined && typeof sortOrder === 'number') {
      updates.sortOrder = sortOrder;
    }
    if (isDefault !== undefined) {
      if (isDefault) {
        // Clear other defaults first
        await db
          .update(snippetCollections)
          .set({ isDefault: false })
          .where(eq(snippetCollections.userId, authReq.user!.id));
      }
      updates.isDefault = Boolean(isDefault);
    }

    const [updated] = await db
      .update(snippetCollections)
      .set(updates)
      .where(eq(snippetCollections.id, id))
      .returning();

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    logger.error('Update snippet collection error', error as Error, { component: 'Snippets' });

    if (isUniqueConstraintError(error)) {
      res.status(409).json({ success: false, error: 'A collection with this name already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to update collection' });
  }
});

// Delete a snippet collection
router.delete('/collections/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(snippetCollections)
      .where(and(eq(snippetCollections.id, id), eq(snippetCollections.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Delete (cascade will remove snippet associations but not snippets themselves)
    await db.delete(snippetCollections).where(eq(snippetCollections.id, id));

    logger.info(`Deleted snippet collection ${id}`, {
      component: 'Snippets',
      collectionId: id,
      userId: authReq.user!.id,
    });

    res.json({
      success: true,
      message: 'Collection deleted',
    });
  } catch (error) {
    logger.error('Delete snippet collection error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to delete collection' });
  }
});

// Add snippet to collection
router.post('/collections/:collectionId/snippets/:snippetId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { collectionId, snippetId } = req.params;

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(snippetCollections)
      .where(and(eq(snippetCollections.id, collectionId), eq(snippetCollections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Verify snippet ownership
    const [snippet] = await db
      .select()
      .from(snippets)
      .where(and(eq(snippets.id, snippetId), eq(snippets.userId, authReq.user!.id)));

    if (!snippet) {
      res.status(404).json({ success: false, error: 'Snippet not found' });
      return;
    }

    // Check if already in collection
    const [existing] = await db
      .select()
      .from(snippetsInCollections)
      .where(and(
        eq(snippetsInCollections.snippetId, snippetId),
        eq(snippetsInCollections.collectionId, collectionId)
      ));

    if (existing) {
      res.json({
        success: true,
        message: 'Snippet already in collection',
      });
      return;
    }

    await db.insert(snippetsInCollections).values({
      id: uuidv4(),
      snippetId,
      collectionId,
    });

    res.json({
      success: true,
      message: 'Snippet added to collection',
    });
  } catch (error) {
    logger.error('Add snippet to collection error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to add snippet to collection' });
  }
});

// Remove snippet from collection
router.delete('/collections/:collectionId/snippets/:snippetId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { collectionId, snippetId } = req.params;

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(snippetCollections)
      .where(and(eq(snippetCollections.id, collectionId), eq(snippetCollections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    await db
      .delete(snippetsInCollections)
      .where(and(
        eq(snippetsInCollections.snippetId, snippetId),
        eq(snippetsInCollections.collectionId, collectionId)
      ));

    res.json({
      success: true,
      message: 'Snippet removed from collection',
    });
  } catch (error) {
    logger.error('Remove snippet from collection error', error as Error, { component: 'Snippets' });
    res.status(500).json({ success: false, error: 'Failed to remove snippet from collection' });
  }
});

export default router;
