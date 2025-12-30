/**
 * Taxonomy routes for admin-configurable categories, tags, and genres
 * Provides CRUD operations for taxonomies, terms, and item assignments
 *
 * @openapi
 * tags:
 *   - name: Taxonomies
 *     description: Admin-configurable categories, tags, and classification systems
 */

import { Router } from 'express';
import {
  db,
  taxonomies,
  taxonomyTerms,
  itemTaxonomies,
  eq,
  and,
  asc,
  inArray,
  logger,
  isValidHexColor,
} from '@webedt/shared';
import type {
  Taxonomy,
  TaxonomyTerm,
  ItemTaxonomy,
} from '@webedt/shared';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

// Helper to generate URL-friendly slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Valid status values
const VALID_STATUSES = ['active', 'archived'] as const;

// Helper to validate status field
function isValidStatus(status: string): boolean {
  return VALID_STATUSES.includes(status as typeof VALID_STATUSES[number]);
}

// ============================================================================
// TAXONOMY CRUD (Admin only)
// ============================================================================

/**
 * @openapi
 * /api/taxonomies:
 *   get:
 *     tags: [Taxonomies]
 *     summary: List taxonomies
 *     description: Get all taxonomies ordered by sort order
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Taxonomies retrieved successfully
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const allTaxonomies = await db
      .select()
      .from(taxonomies)
      .orderBy(asc(taxonomies.sortOrder), asc(taxonomies.name));

    res.json({ success: true, data: allTaxonomies });
  } catch (error) {
    logger.error('Error fetching taxonomies', error as Error, { component: 'taxonomies', operation: 'list' });
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomies' });
  }
});

/**
 * @openapi
 * /api/taxonomies/by-slug/{slug}:
 *   get:
 *     tags: [Taxonomies]
 *     summary: Get taxonomy by slug
 *     description: Retrieve taxonomy with all terms by slug
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Taxonomy retrieved successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// NOTE: This route MUST be defined BEFORE /:id to avoid being caught by the parameterized route
router.get('/by-slug/:slug', requireAuth, async (req, res) => {
  try {
    const { slug } = req.params;

    const [taxonomy] = await db
      .select()
      .from(taxonomies)
      .where(eq(taxonomies.slug, slug))
      .limit(1);

    if (!taxonomy) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    // Get all terms for this taxonomy
    const terms = await db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.taxonomyId, taxonomy.id))
      .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name));

    res.json({ success: true, data: { ...taxonomy, terms } });
  } catch (error) {
    logger.error('Error fetching taxonomy by slug', error as Error, { component: 'taxonomies', operation: 'getBySlug' });
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomy' });
  }
});

/**
 * @openapi
 * /api/taxonomies/{id}:
 *   get:
 *     tags: [Taxonomies]
 *     summary: Get taxonomy details
 *     description: Retrieve taxonomy with all terms by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Taxonomy retrieved successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [taxonomy] = await db
      .select()
      .from(taxonomies)
      .where(eq(taxonomies.id, id))
      .limit(1);

    if (!taxonomy) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    // Get all terms for this taxonomy
    const terms = await db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.taxonomyId, id))
      .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name));

    res.json({ success: true, data: { ...taxonomy, terms } });
  } catch (error) {
    logger.error('Error fetching taxonomy', error as Error, { component: 'taxonomies', operation: 'getById' });
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomy' });
  }
});

/**
 * @openapi
 * /api/taxonomies:
 *   post:
 *     tags: [Taxonomies]
 *     summary: Create taxonomy
 *     description: Create new taxonomy (admin only)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - displayName
 *             properties:
 *               name:
 *                 type: string
 *               displayName:
 *                 type: string
 *               description:
 *                 type: string
 *               allowMultiple:
 *                 type: boolean
 *               isRequired:
 *                 type: boolean
 *               itemTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Taxonomy created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, displayName, description, allowMultiple, isRequired, itemTypes, sortOrder } = req.body;

    if (!name || !displayName) {
      res.status(400).json({ success: false, error: 'Name and displayName are required' });
      return;
    }

    const slug = generateSlug(name);

    // Check if slug already exists
    const [existing] = await db
      .select()
      .from(taxonomies)
      .where(eq(taxonomies.slug, slug))
      .limit(1);

    if (existing) {
      res.status(400).json({ success: false, error: 'A taxonomy with this name already exists' });
      return;
    }

    const [newTaxonomy] = await db
      .insert(taxonomies)
      .values({
        id: crypto.randomUUID(),
        name,
        displayName,
        description: description || null,
        slug,
        allowMultiple: allowMultiple ?? true,
        isRequired: isRequired ?? false,
        itemTypes: itemTypes || [],
        sortOrder: sortOrder || 0,
        status: 'active',
      })
      .returning();

    res.json({ success: true, data: newTaxonomy });
  } catch (error) {
    logger.error('Error creating taxonomy', error as Error, { component: 'taxonomies', operation: 'create' });
    res.status(500).json({ success: false, error: 'Failed to create taxonomy' });
  }
});

/**
 * @openapi
 * /api/taxonomies/{id}:
 *   patch:
 *     tags: [Taxonomies]
 *     summary: Update taxonomy
 *     description: Update taxonomy properties (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Taxonomy updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, displayName, description, allowMultiple, isRequired, itemTypes, sortOrder, status } = req.body;

    // Validate status if provided
    if (status !== undefined && !isValidStatus(status)) {
      res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const updateData: Partial<Taxonomy> = { updatedAt: new Date() };

    if (name !== undefined) {
      updateData.name = name;
      updateData.slug = generateSlug(name);
    }
    if (displayName !== undefined) updateData.displayName = displayName;
    if (description !== undefined) updateData.description = description;
    if (allowMultiple !== undefined) updateData.allowMultiple = allowMultiple;
    if (isRequired !== undefined) updateData.isRequired = isRequired;
    if (itemTypes !== undefined) updateData.itemTypes = itemTypes;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (status !== undefined) updateData.status = status;

    const [updated] = await db
      .update(taxonomies)
      .set(updateData)
      .where(eq(taxonomies.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating taxonomy', error as Error, { component: 'taxonomies', operation: 'update' });
    res.status(500).json({ success: false, error: 'Failed to update taxonomy' });
  }
});

/**
 * @openapi
 * /api/taxonomies/{id}:
 *   delete:
 *     tags: [Taxonomies]
 *     summary: Delete taxonomy
 *     description: Delete taxonomy and cascade to terms (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Taxonomy deleted successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const [deleted] = await db
      .delete(taxonomies)
      .where(eq(taxonomies.id, id))
      .returning({ id: taxonomies.id });

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    logger.error('Error deleting taxonomy', error as Error, { component: 'taxonomies', operation: 'delete' });
    res.status(500).json({ success: false, error: 'Failed to delete taxonomy' });
  }
});

// ============================================================================
// TAXONOMY TERMS CRUD (Admin only)
// ============================================================================

// NOTE: Static routes (/terms/:termId) MUST be defined BEFORE parameterized routes (/:taxonomyId/terms)
// to avoid being incorrectly matched

/**
 * @openapi
 * /api/taxonomies/terms/{termId}:
 *   get:
 *     tags: [Taxonomies]
 *     summary: Get term details
 *     description: Retrieve taxonomy term by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term retrieved successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/terms/:termId', requireAuth, async (req, res) => {
  try {
    const { termId } = req.params;

    const [term] = await db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.id, termId))
      .limit(1);

    if (!term) {
      res.status(404).json({ success: false, error: 'Term not found' });
      return;
    }

    res.json({ success: true, data: term });
  } catch (error) {
    logger.error('Error fetching term', error as Error, { component: 'taxonomies', operation: 'getTerm' });
    res.status(500).json({ success: false, error: 'Failed to fetch term' });
  }
});

/**
 * @openapi
 * /api/taxonomies/terms/{termId}:
 *   patch:
 *     tags: [Taxonomies]
 *     summary: Update term
 *     description: Update taxonomy term (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Term updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.patch('/terms/:termId', requireAdmin, async (req, res) => {
  try {
    const { termId } = req.params;
    const { name, description, parentId, color, icon, metadata, sortOrder, status } = req.body;

    // Validate status if provided
    if (status !== undefined && !isValidStatus(status)) {
      res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    // Validate color if provided
    if (color !== undefined && color !== null && color !== '' && !isValidHexColor(color)) {
      res.status(400).json({ success: false, error: 'Invalid color format. Must be a hex color (e.g., #FF5733)' });
      return;
    }

    const updateData: Partial<TaxonomyTerm> = { updatedAt: new Date() };

    if (name !== undefined) {
      updateData.name = name;
      updateData.slug = generateSlug(name);
    }
    if (description !== undefined) updateData.description = description;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (color !== undefined) updateData.color = color || null;
    if (icon !== undefined) updateData.icon = icon;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (status !== undefined) updateData.status = status;

    const [updated] = await db
      .update(taxonomyTerms)
      .set(updateData)
      .where(eq(taxonomyTerms.id, termId))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, error: 'Term not found' });
      return;
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating term', error as Error, { component: 'taxonomies', operation: 'updateTerm' });
    res.status(500).json({ success: false, error: 'Failed to update term' });
  }
});

/**
 * @openapi
 * /api/taxonomies/terms/{termId}:
 *   delete:
 *     tags: [Taxonomies]
 *     summary: Delete term
 *     description: Delete taxonomy term (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term deleted successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/terms/:termId', requireAdmin, async (req, res) => {
  try {
    const { termId } = req.params;

    const [deleted] = await db
      .delete(taxonomyTerms)
      .where(eq(taxonomyTerms.id, termId))
      .returning({ id: taxonomyTerms.id });

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Term not found' });
      return;
    }

    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    logger.error('Error deleting term', error as Error, { component: 'taxonomies', operation: 'deleteTerm' });
    res.status(500).json({ success: false, error: 'Failed to delete term' });
  }
});

/**
 * @openapi
 * /api/taxonomies/{taxonomyId}/terms:
 *   get:
 *     tags: [Taxonomies]
 *     summary: List terms
 *     description: Get all terms for a taxonomy
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taxonomyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Terms retrieved successfully
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:taxonomyId/terms', requireAuth, async (req, res) => {
  try {
    const { taxonomyId } = req.params;

    const terms = await db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.taxonomyId, taxonomyId))
      .orderBy(asc(taxonomyTerms.sortOrder), asc(taxonomyTerms.name));

    res.json({ success: true, data: terms });
  } catch (error) {
    logger.error('Error fetching taxonomy terms', error as Error, { component: 'taxonomies', operation: 'getTerms' });
    res.status(500).json({ success: false, error: 'Failed to fetch terms' });
  }
});

/**
 * @openapi
 * /api/taxonomies/{taxonomyId}/terms:
 *   post:
 *     tags: [Taxonomies]
 *     summary: Create term
 *     description: Add new term to taxonomy (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: taxonomyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               parentId:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *               metadata:
 *                 type: object
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Term created successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         description: Taxonomy not found
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:taxonomyId/terms', requireAdmin, async (req, res) => {
  try {
    const { taxonomyId } = req.params;
    const { name, description, parentId, color, icon, metadata, sortOrder } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'Name is required' });
      return;
    }

    // Validate color if provided
    if (color && !isValidHexColor(color)) {
      res.status(400).json({ success: false, error: 'Invalid color format. Must be a hex color (e.g., #FF5733)' });
      return;
    }

    // Verify taxonomy exists
    const [taxonomy] = await db
      .select()
      .from(taxonomies)
      .where(eq(taxonomies.id, taxonomyId))
      .limit(1);

    if (!taxonomy) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    const slug = generateSlug(name);

    // Check if slug already exists within this taxonomy
    const [existing] = await db
      .select()
      .from(taxonomyTerms)
      .where(and(eq(taxonomyTerms.taxonomyId, taxonomyId), eq(taxonomyTerms.slug, slug)))
      .limit(1);

    if (existing) {
      res.status(400).json({ success: false, error: 'A term with this name already exists in this taxonomy' });
      return;
    }

    const [newTerm] = await db
      .insert(taxonomyTerms)
      .values({
        id: crypto.randomUUID(),
        taxonomyId,
        name,
        slug,
        description: description || null,
        parentId: parentId || null,
        color: color || null,
        icon: icon || null,
        metadata: metadata || null,
        sortOrder: sortOrder || 0,
        status: 'active',
      })
      .returning();

    res.json({ success: true, data: newTerm });
  } catch (error) {
    logger.error('Error creating term', error as Error, { component: 'taxonomies', operation: 'createTerm' });
    res.status(500).json({ success: false, error: 'Failed to create term' });
  }
});

// ============================================================================
// ITEM TAXONOMY ASSIGNMENTS (Auth required, Admin for write)
// ============================================================================

// NOTE: Static routes (/items/by-term/:termId) MUST be defined BEFORE parameterized routes (/items/:itemType/:itemId)
// to avoid being incorrectly matched

/**
 * @openapi
 * /api/taxonomies/items/by-term/{termId}:
 *   get:
 *     tags: [Taxonomies]
 *     summary: Get items by term
 *     description: Find all items tagged with a specific term
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: itemType
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Items retrieved successfully
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/items/by-term/:termId', requireAuth, async (req, res) => {
  try {
    const { termId } = req.params;
    const { itemType } = req.query;

    let query = db
      .select()
      .from(itemTaxonomies)
      .where(eq(itemTaxonomies.termId, termId));

    if (itemType) {
      query = db
        .select()
        .from(itemTaxonomies)
        .where(and(eq(itemTaxonomies.termId, termId), eq(itemTaxonomies.itemType, itemType as string)));
    }

    const items = await query;

    res.json({ success: true, data: items });
  } catch (error) {
    logger.error('Error fetching items by term', error as Error, { component: 'taxonomies', operation: 'getItemsByTerm' });
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
});

/**
 * @openapi
 * /api/taxonomies/items/{itemType}/{itemId}:
 *   get:
 *     tags: [Taxonomies]
 *     summary: Get item taxonomies
 *     description: Get all taxonomy terms assigned to an item
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Item taxonomies retrieved successfully
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/items/:itemType/:itemId', requireAuth, async (req, res) => {
  try {
    const { itemType, itemId } = req.params;

    // Get all term assignments for this item with term and taxonomy details
    const assignments = await db
      .select({
        assignment: itemTaxonomies,
        term: taxonomyTerms,
        taxonomy: taxonomies,
      })
      .from(itemTaxonomies)
      .innerJoin(taxonomyTerms, eq(itemTaxonomies.termId, taxonomyTerms.id))
      .innerJoin(taxonomies, eq(taxonomyTerms.taxonomyId, taxonomies.id))
      .where(and(eq(itemTaxonomies.itemType, itemType), eq(itemTaxonomies.itemId, itemId)));

    // Group by taxonomy
    const grouped: Record<string, { taxonomy: Taxonomy; terms: TaxonomyTerm[] }> = {};
    for (const row of assignments) {
      if (!grouped[row.taxonomy.id]) {
        grouped[row.taxonomy.id] = { taxonomy: row.taxonomy, terms: [] };
      }
      grouped[row.taxonomy.id].terms.push(row.term);
    }

    res.json({ success: true, data: Object.values(grouped) });
  } catch (error) {
    logger.error('Error fetching item taxonomies', error as Error, { component: 'taxonomies', operation: 'getItemTaxonomies' });
    res.status(500).json({ success: false, error: 'Failed to fetch item taxonomies' });
  }
});

/**
 * @openapi
 * /api/taxonomies/items/{itemType}/{itemId}/terms/{termId}:
 *   post:
 *     tags: [Taxonomies]
 *     summary: Assign term to item
 *     description: Tag an item with a taxonomy term (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term assigned successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/items/:itemType/:itemId/terms/:termId', requireAdmin, async (req, res) => {
  try {
    const { itemType, itemId, termId } = req.params;

    // Verify term exists and get its taxonomy
    const [term] = await db
      .select()
      .from(taxonomyTerms)
      .where(eq(taxonomyTerms.id, termId))
      .limit(1);

    if (!term) {
      res.status(404).json({ success: false, error: 'Term not found' });
      return;
    }

    // Get taxonomy to check allowMultiple
    const [taxonomy] = await db
      .select()
      .from(taxonomies)
      .where(eq(taxonomies.id, term.taxonomyId))
      .limit(1);

    if (!taxonomy) {
      res.status(404).json({ success: false, error: 'Taxonomy not found' });
      return;
    }

    // Check if taxonomy applies to this item type
    if (taxonomy.itemTypes && taxonomy.itemTypes.length > 0 && !taxonomy.itemTypes.includes(itemType)) {
      res.status(400).json({ success: false, error: `This taxonomy cannot be applied to ${itemType} items` });
      return;
    }

    // If not allowMultiple, remove existing assignments for this taxonomy using a single query
    if (!taxonomy.allowMultiple) {
      // Get all term IDs from this taxonomy
      const taxonomyTermIds = await db
        .select({ id: taxonomyTerms.id })
        .from(taxonomyTerms)
        .where(eq(taxonomyTerms.taxonomyId, taxonomy.id));

      const termIdsToRemove = taxonomyTermIds.map((t) => t.id);

      // Remove existing assignments in a single query using inArray
      if (termIdsToRemove.length > 0) {
        await db
          .delete(itemTaxonomies)
          .where(
            and(
              inArray(itemTaxonomies.termId, termIdsToRemove),
              eq(itemTaxonomies.itemType, itemType),
              eq(itemTaxonomies.itemId, itemId)
            )
          );
      }
    }

    // Check if assignment already exists
    const [existing] = await db
      .select()
      .from(itemTaxonomies)
      .where(
        and(
          eq(itemTaxonomies.termId, termId),
          eq(itemTaxonomies.itemType, itemType),
          eq(itemTaxonomies.itemId, itemId)
        )
      )
      .limit(1);

    if (existing) {
      res.json({ success: true, data: existing, message: 'Term already assigned' });
      return;
    }

    const [assignment] = await db
      .insert(itemTaxonomies)
      .values({
        id: crypto.randomUUID(),
        termId,
        itemType,
        itemId,
      })
      .returning();

    res.json({ success: true, data: assignment });
  } catch (error) {
    logger.error('Error assigning term to item', error as Error, { component: 'taxonomies', operation: 'assignTerm' });
    res.status(500).json({ success: false, error: 'Failed to assign term' });
  }
});

/**
 * @openapi
 * /api/taxonomies/items/{itemType}/{itemId}/terms/{termId}:
 *   delete:
 *     tags: [Taxonomies]
 *     summary: Remove term from item
 *     description: Remove taxonomy term from item (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term removed successfully
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/items/:itemType/:itemId/terms/:termId', requireAdmin, async (req, res) => {
  try {
    const { itemType, itemId, termId } = req.params;

    const [deleted] = await db
      .delete(itemTaxonomies)
      .where(
        and(
          eq(itemTaxonomies.termId, termId),
          eq(itemTaxonomies.itemType, itemType),
          eq(itemTaxonomies.itemId, itemId)
        )
      )
      .returning({ id: itemTaxonomies.id });

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Assignment not found' });
      return;
    }

    res.json({ success: true, data: { id: deleted.id } });
  } catch (error) {
    logger.error('Error removing term from item', error as Error, { component: 'taxonomies', operation: 'removeTerm' });
    res.status(500).json({ success: false, error: 'Failed to remove term' });
  }
});

/**
 * @openapi
 * /api/taxonomies/items/{itemType}/{itemId}:
 *   put:
 *     tags: [Taxonomies]
 *     summary: Bulk update item terms
 *     description: Replace all terms for an item (admin only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: itemType
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - termIds
 *             properties:
 *               termIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Terms updated successfully
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.put('/items/:itemType/:itemId', requireAdmin, async (req, res) => {
  try {
    const { itemType, itemId } = req.params;
    const { termIds } = req.body; // Array of term IDs to assign

    if (!Array.isArray(termIds)) {
      res.status(400).json({ success: false, error: 'termIds must be an array' });
      return;
    }

    // Validate that all termIds exist before making changes
    if (termIds.length > 0) {
      const existingTerms = await db
        .select({ id: taxonomyTerms.id })
        .from(taxonomyTerms)
        .where(inArray(taxonomyTerms.id, termIds));

      const existingIds = new Set(existingTerms.map((t) => t.id));
      const invalidIds = termIds.filter((id) => !existingIds.has(id));

      if (invalidIds.length > 0) {
        res.status(400).json({ success: false, error: `Invalid term IDs: ${invalidIds.join(', ')}` });
        return;
      }
    }

    // Remove all existing assignments for this item
    await db
      .delete(itemTaxonomies)
      .where(and(eq(itemTaxonomies.itemType, itemType), eq(itemTaxonomies.itemId, itemId)));

    // Add new assignments
    const assignments: ItemTaxonomy[] = [];
    for (const termId of termIds) {
      const [assignment] = await db
        .insert(itemTaxonomies)
        .values({
          id: crypto.randomUUID(),
          termId,
          itemType,
          itemId,
        })
        .returning();
      assignments.push(assignment);
    }

    res.json({ success: true, data: assignments });
  } catch (error) {
    logger.error('Error bulk updating item terms', error as Error, { component: 'taxonomies', operation: 'bulkUpdateTerms' });
    res.status(500).json({ success: false, error: 'Failed to update item terms' });
  }
});

export default router;
