/**
 * Sessions Routes Index
 *
 * Main router that combines all session-related route modules:
 * - crud.ts: Basic CRUD operations (create, read, update, delete)
 * - sharing.ts: Public session sharing via share tokens
 * - streaming.ts: SSE endpoints for real-time updates
 * - sync.ts: Claude Remote API sync operations
 * - bulk.ts: Batch operations for multiple sessions
 * - send.ts: Follow-up message handling
 *
 * @openapi
 * tags:
 *   - name: Sessions
 *     description: Session management operations
 *   - name: Sessions-Public
 *     description: Public session sharing endpoints (no authentication required)
 */

import { Router } from 'express';
import { requireAuth, requireEditor } from '../../middleware/auth.js';
import crudRoutes from './crud.js';
import sharingRoutes from './sharing.js';
import streamingRoutes from './streaming.js';
import syncRoutes from './sync.js';
import bulkRoutes from './bulk.js';
import sendRoutes from './send.js';

const router = Router();

// Mount sub-routers
// Order matters - more specific routes first

// Sharing routes (includes public /shared/:token endpoints)
// NOTE: sharingRoutes handles its own auth - public endpoints don't require auth
router.use('/', sharingRoutes);

// All other session routes require authentication and editor role
// Sessions are part of the editor suite for code editing and AI interaction
router.use(requireAuth, requireEditor);

// Sync routes
router.use('/', syncRoutes);

// Bulk operations
router.use('/', bulkRoutes);

// Streaming routes (SSE endpoints)
router.use('/', streamingRoutes);

// Send routes (follow-up messages)
router.use('/', sendRoutes);

// CRUD routes (general session operations - mounted last as catch-all)
router.use('/', crudRoutes);

export default router;
