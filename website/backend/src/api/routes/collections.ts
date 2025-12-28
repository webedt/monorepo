/**
 * Collections Routes
 * Handles user-created organizational folders for sessions
 */

import { Router, Request, Response } from 'express';
import { db, collections, sessionCollections, chatSessions, eq, and, desc, asc, sql } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Validation constants
const VALID_ICONS = ['folder', 'star', 'code', 'bookmark', 'archive'] as const;
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// Validation helpers
function isValidHexColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR_REGEX.test(color);
}

function isValidIcon(icon: unknown): icon is string {
  return typeof icon === 'string' && VALID_ICONS.includes(icon as (typeof VALID_ICONS)[number]);
}

// ===========================================================================
// IMPORTANT: Routes with specific paths must be defined BEFORE parameterized
// routes like /:id to prevent the parameter from matching literal path segments
// ===========================================================================

// Get collections for a specific session
// NOTE: Must be before /:id to prevent 'session' from being matched as an id
router.get('/session/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionId } = req.params;

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, authReq.user!.id)));

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Get collections this session belongs to
    const sessionCols = await db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        color: collections.color,
        icon: collections.icon,
        sortOrder: collections.sortOrder,
        isDefault: collections.isDefault,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        addedAt: sessionCollections.addedAt,
      })
      .from(sessionCollections)
      .innerJoin(collections, eq(sessionCollections.collectionId, collections.id))
      .where(eq(sessionCollections.sessionId, sessionId))
      .orderBy(asc(collections.sortOrder), asc(collections.name));

    res.json({
      success: true,
      data: {
        collections: sessionCols,
        total: sessionCols.length,
      },
    });
  } catch (error) {
    logger.error('Get session collections error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to fetch session collections' });
  }
});

// Bulk add session to multiple collections
// NOTE: Must be before /:id to prevent 'session' from being matched as an id
router.post('/session/:sessionId/bulk', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionId } = req.params;
    const { collectionIds } = req.body;

    if (!Array.isArray(collectionIds) || collectionIds.length === 0) {
      res.status(400).json({ success: false, error: 'collectionIds array is required' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, authReq.user!.id)));

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Verify all collections belong to user
    const userCollections = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.userId, authReq.user!.id));

    const userCollectionIds = new Set(userCollections.map((c) => c.id));
    const validCollectionIds = collectionIds.filter((id: string) => userCollectionIds.has(id));

    if (validCollectionIds.length === 0) {
      res.status(400).json({ success: false, error: 'No valid collections found' });
      return;
    }

    // Get existing memberships to avoid duplicates
    const existingMemberships = await db
      .select({ collectionId: sessionCollections.collectionId })
      .from(sessionCollections)
      .where(eq(sessionCollections.sessionId, sessionId));

    const existingCollectionIds = new Set(existingMemberships.map((m) => m.collectionId));
    const newCollectionIds = validCollectionIds.filter((id: string) => !existingCollectionIds.has(id));

    if (newCollectionIds.length === 0) {
      res.json({ success: true, data: { added: 0 }, message: 'Session already in all specified collections' });
      return;
    }

    // Add to new collections
    await db.insert(sessionCollections).values(
      newCollectionIds.map((collectionId: string) => ({
        id: uuidv4(),
        sessionId,
        collectionId,
      }))
    );

    logger.info(`Bulk added session ${sessionId} to ${newCollectionIds.length} collections`, {
      component: 'Collections',
      sessionId,
      collectionIds: newCollectionIds,
      userId: authReq.user!.id,
    });

    res.json({ success: true, data: { added: newCollectionIds.length } });
  } catch (error) {
    logger.error('Bulk add session to collections error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to add session to collections' });
  }
});

// Reorder collections
// NOTE: Must be before /:id to prevent 'reorder' from being matched as an id
router.post('/reorder', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { orderedIds } = req.body;

    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ success: false, error: 'orderedIds array is required' });
      return;
    }

    // Verify all collections belong to user
    const userCollections = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.userId, authReq.user!.id));

    const userCollectionIds = new Set(userCollections.map((c) => c.id));

    // Update sort order for each collection
    await Promise.all(
      orderedIds.map(async (id: string, index: number) => {
        if (userCollectionIds.has(id)) {
          await db
            .update(collections)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(eq(collections.id, id));
        }
      })
    );

    logger.info(`Reordered collections`, {
      component: 'Collections',
      userId: authReq.user!.id,
      count: orderedIds.length,
    });

    res.json({ success: true, message: 'Collections reordered' });
  } catch (error) {
    logger.error('Reorder collections error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to reorder collections' });
  }
});

// ===========================================================================
// Standard CRUD routes with parameterized paths
// ===========================================================================

// Get all collections for the current user
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Get collections with session counts using a subquery to avoid N+1 queries
    const userCollections = await db
      .select({
        id: collections.id,
        userId: collections.userId,
        name: collections.name,
        description: collections.description,
        color: collections.color,
        icon: collections.icon,
        sortOrder: collections.sortOrder,
        isDefault: collections.isDefault,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        sessionCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${sessionCollections}
          WHERE ${sessionCollections.collectionId} = ${collections.id}
        )`,
      })
      .from(collections)
      .where(eq(collections.userId, authReq.user!.id))
      .orderBy(asc(collections.sortOrder), asc(collections.name));

    res.json({
      success: true,
      data: {
        collections: userCollections,
        total: userCollections.length,
      },
    });
  } catch (error) {
    logger.error('Get collections error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to fetch collections' });
  }
});

// Get a single collection by ID
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    res.json({ success: true, data: { collection } });
  } catch (error) {
    logger.error('Get collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to fetch collection' });
  }
});

// Create a new collection
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { name, description, color, icon, isDefault } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Collection name is required' });
      return;
    }

    // Validate color format if provided
    if (color !== undefined && color !== null && !isValidHexColor(color)) {
      res.status(400).json({ success: false, error: 'Invalid color format. Must be a hex color like #RRGGBB' });
      return;
    }

    // Validate icon if provided
    if (icon !== undefined && icon !== null && !isValidIcon(icon)) {
      res.status(400).json({
        success: false,
        error: `Invalid icon. Must be one of: ${VALID_ICONS.join(', ')}`,
      });
      return;
    }

    // Check if collection with same name exists for this user
    const [existing] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.userId, authReq.user!.id), eq(collections.name, name.trim())));

    if (existing) {
      res.status(400).json({ success: false, error: 'A collection with this name already exists' });
      return;
    }

    // Get max sort order for user's collections
    const [maxOrder] = await db
      .select({ maxSort: collections.sortOrder })
      .from(collections)
      .where(eq(collections.userId, authReq.user!.id))
      .orderBy(desc(collections.sortOrder))
      .limit(1);

    const newSortOrder = (maxOrder?.maxSort ?? -1) + 1;

    // If setting as default, unset any existing default
    if (isDefault) {
      await db
        .update(collections)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(collections.userId, authReq.user!.id), eq(collections.isDefault, true)));
    }

    const [collection] = await db
      .insert(collections)
      .values({
        id: uuidv4(),
        userId: authReq.user!.id,
        name: name.trim(),
        description: description?.trim() || null,
        color: color || null,
        icon: icon || null,
        sortOrder: newSortOrder,
        isDefault: isDefault || false,
      })
      .returning();

    logger.info(`Created collection ${collection.id}`, {
      component: 'Collections',
      collectionId: collection.id,
      userId: authReq.user!.id,
    });

    res.status(201).json({ success: true, data: { collection } });
  } catch (error) {
    logger.error('Create collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to create collection' });
  }
});

// Update a collection
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { name, description, color, icon, sortOrder, isDefault } = req.body;

    // Validate color format if provided
    if (color !== undefined && color !== null && !isValidHexColor(color)) {
      res.status(400).json({ success: false, error: 'Invalid color format. Must be a hex color like #RRGGBB' });
      return;
    }

    // Validate icon if provided
    if (icon !== undefined && icon !== null && !isValidIcon(icon)) {
      res.status(400).json({
        success: false,
        error: `Invalid icon. Must be one of: ${VALID_ICONS.join(', ')}`,
      });
      return;
    }

    // Verify ownership
    const [existing] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Check for name conflict if name is being changed
    if (name && name.trim() !== existing.name) {
      const [duplicate] = await db
        .select()
        .from(collections)
        .where(and(eq(collections.userId, authReq.user!.id), eq(collections.name, name.trim())));

      if (duplicate) {
        res.status(400).json({ success: false, error: 'A collection with this name already exists' });
        return;
      }
    }

    // If setting as default, unset any existing default
    if (isDefault && !existing.isDefault) {
      await db
        .update(collections)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(collections.userId, authReq.user!.id), eq(collections.isDefault, true)));
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (color !== undefined) updateData.color = color || null;
    if (icon !== undefined) updateData.icon = icon || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    const [collection] = await db
      .update(collections)
      .set(updateData)
      .where(eq(collections.id, id))
      .returning();

    logger.info(`Updated collection ${id}`, {
      component: 'Collections',
      collectionId: id,
      userId: authReq.user!.id,
    });

    res.json({ success: true, data: { collection } });
  } catch (error) {
    logger.error('Update collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to update collection' });
  }
});

// Delete a collection
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [existing] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!existing) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Delete collection (cascade will remove session_collections entries)
    await db.delete(collections).where(eq(collections.id, id));

    logger.info(`Deleted collection ${id}`, {
      component: 'Collections',
      collectionId: id,
      userId: authReq.user!.id,
    });

    res.json({ success: true, message: 'Collection deleted' });
  } catch (error) {
    logger.error('Delete collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to delete collection' });
  }
});

// Get sessions in a collection
router.get('/:id/sessions', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Verify ownership
    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Get sessions in this collection
    const sessions = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        sessionPath: chatSessions.sessionPath,
        repositoryOwner: chatSessions.repositoryOwner,
        repositoryName: chatSessions.repositoryName,
        repositoryUrl: chatSessions.repositoryUrl,
        userRequest: chatSessions.userRequest,
        status: chatSessions.status,
        baseBranch: chatSessions.baseBranch,
        branch: chatSessions.branch,
        provider: chatSessions.provider,
        autoCommit: chatSessions.autoCommit,
        locked: chatSessions.locked,
        createdAt: chatSessions.createdAt,
        completedAt: chatSessions.completedAt,
        deletedAt: chatSessions.deletedAt,
        addedAt: sessionCollections.addedAt,
      })
      .from(sessionCollections)
      .innerJoin(chatSessions, eq(sessionCollections.sessionId, chatSessions.id))
      .where(eq(sessionCollections.collectionId, id))
      .orderBy(desc(sessionCollections.addedAt));

    res.json({
      success: true,
      data: {
        collection,
        sessions,
        total: sessions.length,
      },
    });
  } catch (error) {
    logger.error('Get collection sessions error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to fetch collection sessions' });
  }
});

// Add a session to a collection
router.post('/:id/sessions/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id, sessionId } = req.params;

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Verify session ownership
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, authReq.user!.id)));

    if (!session) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    // Check if session is already in collection
    const [existing] = await db
      .select()
      .from(sessionCollections)
      .where(and(eq(sessionCollections.sessionId, sessionId), eq(sessionCollections.collectionId, id)));

    if (existing) {
      res.status(400).json({ success: false, error: 'Session is already in this collection' });
      return;
    }

    // Add session to collection
    const [membership] = await db
      .insert(sessionCollections)
      .values({
        id: uuidv4(),
        sessionId,
        collectionId: id,
      })
      .returning();

    logger.info(`Added session ${sessionId} to collection ${id}`, {
      component: 'Collections',
      collectionId: id,
      sessionId,
      userId: authReq.user!.id,
    });

    res.status(201).json({ success: true, data: { membership } });
  } catch (error) {
    logger.error('Add session to collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to add session to collection' });
  }
});

// Remove a session from a collection
router.delete('/:id/sessions/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { id, sessionId } = req.params;

    // Verify collection ownership
    const [collection] = await db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authReq.user!.id)));

    if (!collection) {
      res.status(404).json({ success: false, error: 'Collection not found' });
      return;
    }

    // Remove session from collection
    await db
      .delete(sessionCollections)
      .where(and(eq(sessionCollections.sessionId, sessionId), eq(sessionCollections.collectionId, id)));

    logger.info(`Removed session ${sessionId} from collection ${id}`, {
      component: 'Collections',
      collectionId: id,
      sessionId,
      userId: authReq.user!.id,
    });

    res.json({ success: true, message: 'Session removed from collection' });
  } catch (error) {
    logger.error('Remove session from collection error', error as Error, { component: 'Collections' });
    res.status(500).json({ success: false, error: 'Failed to remove session from collection' });
  }
});

export default router;
