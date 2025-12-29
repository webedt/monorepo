/**
 * User Routes Index
 *
 * Main router that combines all user-related route modules:
 * - claude.ts: Claude authentication (set, delete, refresh, credentials)
 * - providers.ts: Other AI providers (Codex, Gemini)
 * - preferences.ts: User settings and preferences
 * - spending.ts: Spending limits configuration
 *
 * @openapi
 * tags:
 *   - name: User
 *     description: User profile and settings management
 */

import { Router } from 'express';
import claudeRoutes from './claude.js';
import providersRoutes from './providers.js';
import preferencesRoutes from './preferences.js';
import spendingRoutes from './spending.js';

const router = Router();

// Mount sub-routers
// All routes are mounted at root level since endpoints have distinct names

// Claude auth routes (/claude-auth, /claude-auth/refresh, /claude-auth/credentials)
router.use('/', claudeRoutes);

// Other AI provider routes (/codex-auth, /gemini-auth)
router.use('/', providersRoutes);

// User preferences routes (/preferred-provider, /display-name, etc.)
router.use('/', preferencesRoutes);

// Spending limits routes (/spending-limits, /spending-limits/reset)
router.use('/', spendingRoutes);

export default router;
