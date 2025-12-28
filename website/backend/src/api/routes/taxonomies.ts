/**
 * Taxonomy routes for admin-configurable categories, tags, and genres
 * Provides CRUD operations for taxonomies, terms, and item assignments
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
  desc,
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

// ============================================================================
// TAXONOMY CRUD (Admin only)
// ============================================================================

// GET /api/taxonomies - List all taxonomies
router.get('/', requireAuth, async (req, res) => {
  try {
    const allTaxonomies = await db
      .select()
      .from(taxonomies)
      .orderBy(asc(taxonomies.sortOrder), asc(taxonomies.name));

    res.json({ success: true, data: allTaxonomies });
  } catch (error) {
    console.error('Error fetching taxonomies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomies' });
  }
});

// GET /api/taxonomies/:id - Get taxonomy details with terms
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
    console.error('Error fetching taxonomy:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomy' });
  }
});

// GET /api/taxonomies/by-slug/:slug - Get taxonomy by slug
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
    console.error('Error fetching taxonomy by slug:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch taxonomy' });
  }
});

// POST /api/taxonomies - Create new taxonomy
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
    console.error('Error creating taxonomy:', error);
    res.status(500).json({ success: false, error: 'Failed to create taxonomy' });
  }
});

// PATCH /api/taxonomies/:id - Update taxonomy
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, displayName, description, allowMultiple, isRequired, itemTypes, sortOrder, status } = req.body;

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
    console.error('Error updating taxonomy:', error);
    res.status(500).json({ success: false, error: 'Failed to update taxonomy' });
  }
});

// DELETE /api/taxonomies/:id - Delete taxonomy (cascades to terms and item assignments)
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
    console.error('Error deleting taxonomy:', error);
    res.status(500).json({ success: false, error: 'Failed to delete taxonomy' });
  }
});

// ============================================================================
// TAXONOMY TERMS CRUD (Admin only)
// ============================================================================

// GET /api/taxonomies/:taxonomyId/terms - List terms for a taxonomy
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
    console.error('Error fetching taxonomy terms:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch terms' });
  }
});

// POST /api/taxonomies/:taxonomyId/terms - Create new term
router.post('/:taxonomyId/terms', requireAdmin, async (req, res) => {
  try {
    const { taxonomyId } = req.params;
    const { name, description, parentId, color, icon, metadata, sortOrder } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'Name is required' });
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
    console.error('Error creating term:', error);
    res.status(500).json({ success: false, error: 'Failed to create term' });
  }
});

// GET /api/taxonomies/terms/:termId - Get term details
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
    console.error('Error fetching term:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch term' });
  }
});

// PATCH /api/taxonomies/terms/:termId - Update term
router.patch('/terms/:termId', requireAdmin, async (req, res) => {
  try {
    const { termId } = req.params;
    const { name, description, parentId, color, icon, metadata, sortOrder, status } = req.body;

    const updateData: Partial<TaxonomyTerm> = { updatedAt: new Date() };

    if (name !== undefined) {
      updateData.name = name;
      updateData.slug = generateSlug(name);
    }
    if (description !== undefined) updateData.description = description;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (color !== undefined) updateData.color = color;
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
    console.error('Error updating term:', error);
    res.status(500).json({ success: false, error: 'Failed to update term' });
  }
});

// DELETE /api/taxonomies/terms/:termId - Delete term
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
    console.error('Error deleting term:', error);
    res.status(500).json({ success: false, error: 'Failed to delete term' });
  }
});

// ============================================================================
// ITEM TAXONOMY ASSIGNMENTS (Auth required, Admin for write)
// ============================================================================

// GET /api/taxonomies/items/:itemType/:itemId - Get terms assigned to an item
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
    console.error('Error fetching item taxonomies:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch item taxonomies' });
  }
});

// POST /api/taxonomies/items/:itemType/:itemId/terms/:termId - Assign term to item
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

    // If not allowMultiple, remove existing assignments for this taxonomy
    if (!taxonomy.allowMultiple) {
      // Get all term IDs from this taxonomy
      const taxonomyTermIds = await db
        .select({ id: taxonomyTerms.id })
        .from(taxonomyTerms)
        .where(eq(taxonomyTerms.taxonomyId, taxonomy.id));

      const termIds = taxonomyTermIds.map((t) => t.id);

      // Remove existing assignments
      for (const tid of termIds) {
        await db
          .delete(itemTaxonomies)
          .where(
            and(
              eq(itemTaxonomies.termId, tid),
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
    console.error('Error assigning term to item:', error);
    res.status(500).json({ success: false, error: 'Failed to assign term' });
  }
});

// DELETE /api/taxonomies/items/:itemType/:itemId/terms/:termId - Remove term from item
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
    console.error('Error removing term from item:', error);
    res.status(500).json({ success: false, error: 'Failed to remove term' });
  }
});

// PUT /api/taxonomies/items/:itemType/:itemId - Bulk update terms for an item
router.put('/items/:itemType/:itemId', requireAdmin, async (req, res) => {
  try {
    const { itemType, itemId } = req.params;
    const { termIds } = req.body; // Array of term IDs to assign

    if (!Array.isArray(termIds)) {
      res.status(400).json({ success: false, error: 'termIds must be an array' });
      return;
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
    console.error('Error bulk updating item terms:', error);
    res.status(500).json({ success: false, error: 'Failed to update item terms' });
  }
});

// GET /api/taxonomies/items/by-term/:termId - Get all items with a specific term
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
    console.error('Error fetching items by term:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch items' });
  }
});

export default router;
