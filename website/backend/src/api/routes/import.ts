/**
 * Import Routes
 * Handles importing files from external URLs into workspaces
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import {
  fetchFromUrl,
  validateUrl,
  WORKSPACE_DIR,
  db,
  chatSessions,
  eq,
  and,
  sendSuccess,
  sendError,
  sendInternalError,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * Verify that the user has access to the specified session path
 */
async function verifySessionAccess(userId: string, sessionPath: string): Promise<boolean> {
  const session = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(
      eq(chatSessions.userId, userId),
      eq(chatSessions.sessionPath, sessionPath)
    ))
    .limit(1);

  return session.length > 0;
}

/**
 * Safely resolve a file path within a directory, preventing path traversal
 */
function safeResolvePath(baseDir: string, filePath: string): string | null {
  // Normalize and resolve the path
  const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolvedPath = path.resolve(baseDir, normalizedPath);

  // Ensure the resolved path is within the base directory
  if (!resolvedPath.startsWith(baseDir + path.sep) && resolvedPath !== baseDir) {
    return null;
  }

  return resolvedPath;
}

/**
 * Validate a URL before importing
 * POST /api/import/validate
 */
router.post('/validate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      sendError(res, 'URL is required', 400);
      return;
    }

    const result = await validateUrl(url);

    sendSuccess(res, result);
  } catch (error) {
    console.error('URL validation error:', error);
    sendInternalError(res, error instanceof Error ? error.message : 'Validation failed');
  }
});

/**
 * Import a file from URL into workspace
 * POST /api/import/url
 */
router.post('/url', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      sendError(res, 'Authentication required', 401);
      return;
    }

    const { url, sessionPath, targetPath } = req.body;

    if (!url || typeof url !== 'string') {
      sendError(res, 'URL is required', 400);
      return;
    }

    if (!sessionPath || typeof sessionPath !== 'string') {
      sendError(res, 'Session path is required', 400);
      return;
    }

    // Validate session path format (owner__repo__branch)
    const sessionPathParts = sessionPath.split('__');
    if (sessionPathParts.length !== 3) {
      sendError(res, 'Invalid session path format', 400);
      return;
    }

    // Verify user has access to this session
    const hasAccess = await verifySessionAccess(userId, sessionPath);
    if (!hasAccess) {
      sendError(res, 'Access denied to this session', 403);
      return;
    }

    // Fetch content from URL (skip HEAD validation since frontend already validated)
    const fetchResult = await fetchFromUrl({ url, skipValidation: true });

    if (!fetchResult.success || !fetchResult.content) {
      sendError(res, fetchResult.error || 'Failed to fetch content from URL', 400);
      return;
    }

    // Determine target file path
    const filePath = targetPath || fetchResult.suggestedFilename || 'imported-file';

    // Build workspace directory and safely resolve full path
    const workspaceDir = path.join(WORKSPACE_DIR, `session-${sessionPath}`, 'workspace');
    const fullPath = safeResolvePath(workspaceDir, filePath);

    if (!fullPath) {
      sendError(res, 'Invalid file path', 400);
      return;
    }

    // Ensure the target directory exists
    const targetDir = path.dirname(fullPath);
    await fs.mkdir(targetDir, { recursive: true });

    // Write the file
    if (fetchResult.isBinary && fetchResult.content) {
      // Decode base64 and write as binary
      const buffer = Buffer.from(fetchResult.content, 'base64');
      await fs.writeFile(fullPath, buffer);
    } else {
      // Write as text
      await fs.writeFile(fullPath, fetchResult.content, 'utf-8');
    }

    sendSuccess(res, {
      filePath,
      contentType: fetchResult.contentType,
      size: fetchResult.size,
      isBinary: fetchResult.isBinary,
    });
  } catch (error) {
    console.error('URL import error:', error);
    sendInternalError(res, error instanceof Error ? error.message : 'Import failed');
  }
});

export default router;
