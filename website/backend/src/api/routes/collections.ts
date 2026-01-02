/**
 * Collections Routes
 * Handles user-created organizational folders for sessions
 */

import { Router, Request, Response } from 'express';
import {
  db,
  collections,
  sessionCollections,
  chatSessions,
  eq,
  and,
  desc,
  asc,
  sql,
  isNull,
  withTransactionOrThrow,
  logger,
  isValidHexColor,
  isValidIcon,
  VALID_ICONS,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { standardRateLimiter } from '../middleware/rateLimit.js';
import {
  requireCollectionOwnership,
  type AuthorizedRequest,
} from '../middleware/authorization.js';
import type { TransactionContext } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Apply rate limiting to all collection routes
// Rate limit: 100 requests/minute (standardRateLimiter)
router.use(standardRateLimiter);

/**
 * @openapi
 * tags:
 *   - name: Collections
 *     description: User-created organizational folders for sessions
 */

// ===========================================================================
// IMPORTANT: Routes with specific paths must be defined BEFORE parameterized
// routes like /:id to prevent the parameter from matching literal path segments
// ===========================================================================

/**
 * @openapi
 * /collections/session/{sessionId}:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get collections for a session
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Collections retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /collections/session/{sessionId}/bulk:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Bulk add session to collections
 *     parameters:
 *       - name: sessionId
 *         in: path
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
 *               - collectionIds
 *             properties:
 *               collectionIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Sessions added
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

    // Use transaction to ensure all collection memberships are added atomically
    // This prevents partial additions if some inserts fail
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx.insert(sessionCollections).values(
        newCollectionIds.map((collectionId: string) => ({
          id: uuidv4(),
          sessionId,
          collectionId,
        }))
      );
    }, {
      context: { operation: 'bulkAddToCollections', sessionId, collectionCount: newCollectionIds.length },
    });

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

/**
 * @openapi
 * /collections/reorder:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Reorder collections
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderedIds
 *             properties:
 *               orderedIds:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Collections reordered
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

    // Use transaction to ensure all sort order updates are atomic
    // This prevents inconsistent ordering if some updates fail
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      for (let index = 0; index < orderedIds.length; index++) {
        const id = orderedIds[index] as string;
        if (userCollectionIds.has(id)) {
          await tx
            .update(collections)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(eq(collections.id, id));
        }
      }
    }, {
      context: { operation: 'reorderCollections', userId: authReq.user!.id, collectionCount: orderedIds.length },
    });

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

/**
 * @openapi
 * /collections:
 *   get:
 *     tags:
 *       - Collections
 *     summary: List user collections
 *     description: Returns all collections for the current user with session counts.
 *     responses:
 *       200:
 *         description: Collections retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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
          INNER JOIN ${chatSessions} ON ${sessionCollections.sessionId} = ${chatSessions.id}
          WHERE ${sessionCollections.collectionId} = ${collections.id}
            AND ${chatSessions.deletedAt} IS NULL
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

/**
 * @openapi
 * /collections/{id}:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get collection by ID
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Collection retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get a single collection by ID
// Using requireCollectionOwnership middleware for authorization
router.get(
  '/:id',
  requireAuth,
  requireCollectionOwnership(req => req.params.id, { attachToRequest: true }),
  async (req: Request, res: Response) => {
    try {
      // Collection is pre-fetched and attached by authorization middleware
      const authorizedReq = req as AuthorizedRequest;
      const collection = authorizedReq.authorizedResource;

      if (!collection) {
        res.status(500).json({ success: false, error: 'Authorization error' });
        return;
      }

      res.json({ success: true, data: { collection } });
    } catch (error) {
      logger.error('Get collection error', error as Error, { component: 'Collections' });
      res.status(500).json({ success: false, error: 'Failed to fetch collection' });
    }
  }
);

/**
 * @openapi
 * /collections:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Create collection
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
 *               color:
 *                 type: string
 *                 pattern: '^#[0-9A-Fa-f]{6}$'
 *               icon:
 *                 type: string
 *                 enum: [folder, star, code, bookmark, archive]
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Collection created
 *       400:
 *         description: Invalid input or name exists
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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
    const collectionId = uuidv4();

    // Use transaction to ensure default flag changes and collection creation are atomic
    // This prevents having multiple defaults or no default when expected
    const [collection] = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      // If setting as default, unset any existing default
      if (isDefault) {
        await tx
          .update(collections)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(collections.userId, authReq.user!.id), eq(collections.isDefault, true)));
      }

      return tx
        .insert(collections)
        .values({
          id: collectionId,
          userId: authReq.user!.id,
          name: name.trim(),
          description: description?.trim() || null,
          color: color || null,
          icon: icon || null,
          sortOrder: newSortOrder,
          isDefault: isDefault || false,
        })
        .returning();
    }, {
      context: { operation: 'createCollection', collectionId, userId: authReq.user!.id },
    });

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

/**
 * @openapi
 * /collections/{id}:
 *   patch:
 *     tags:
 *       - Collections
 *     summary: Update collection
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *               sortOrder:
 *                 type: integer
 *               isDefault:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Collection updated
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (color !== undefined) updateData.color = color || null;
    if (icon !== undefined) updateData.icon = icon || null;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (isDefault !== undefined) updateData.isDefault = isDefault;

    // Use transaction to ensure default flag changes and collection update are atomic
    // This prevents having multiple defaults or inconsistent state
    const [collection] = await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      // If setting as default, unset any existing default
      if (isDefault && !existing.isDefault) {
        await tx
          .update(collections)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(collections.userId, authReq.user!.id), eq(collections.isDefault, true)));
      }

      return tx
        .update(collections)
        .set(updateData)
        .where(eq(collections.id, id))
        .returning();
    }, {
      context: { operation: 'updateCollection', collectionId: id, userId: authReq.user!.id },
    });

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

/**
 * @openapi
 * /collections/{id}:
 *   delete:
 *     tags:
 *       - Collections
 *     summary: Delete collection
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Collection deleted
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Delete a collection
// Using requireCollectionOwnership middleware for authorization
router.delete(
  '/:id',
  requireAuth,
  requireCollectionOwnership(req => req.params.id),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      const { id } = req.params;

      // Delete collection (cascade will remove session_collections entries)
      // Ownership already verified by middleware
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
  }
);

/**
 * @openapi
 * /collections/{id}/sessions:
 *   get:
 *     tags:
 *       - Collections
 *     summary: Get collection sessions
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Sessions retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get sessions in a collection
// Using requireCollectionOwnership middleware for authorization
router.get(
  '/:id/sessions',
  requireAuth,
  requireCollectionOwnership(req => req.params.id, { attachToRequest: true }),
  async (req: Request, res: Response) => {
    try {
      const authorizedReq = req as AuthorizedRequest;
      const { id } = req.params;
      const collection = authorizedReq.authorizedResource;

      // Get sessions in this collection
      // Ownership already verified by middleware
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
        .where(and(
          eq(sessionCollections.collectionId, id),
          isNull(chatSessions.deletedAt)
        ))
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
  }
);

/**
 * @openapi
 * /collections/{id}/sessions/{sessionId}:
 *   post:
 *     tags:
 *       - Collections
 *     summary: Add session to collection
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Session added
 *       400:
 *         description: Already in collection
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /collections/{id}/sessions/{sessionId}:
 *   delete:
 *     tags:
 *       - Collections
 *     summary: Remove session from collection
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session removed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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
