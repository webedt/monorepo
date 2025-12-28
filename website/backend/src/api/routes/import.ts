/**
 * Import Routes
 * Handles importing files from external URLs into workspaces
 */

import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fetchFromUrl, validateUrl, WORKSPACE_DIR, db, chatSessions, eq, and } from '@webedt/shared';
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
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    const result = await validateUrl(url);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('URL validation error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Validation failed',
    });
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
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const { url, sessionPath, targetPath } = req.body;

    if (!url || typeof url !== 'string') {
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    if (!sessionPath || typeof sessionPath !== 'string') {
      res.status(400).json({ success: false, error: 'Session path is required' });
      return;
    }

    // Validate session path format (owner__repo__branch)
    const sessionPathParts = sessionPath.split('__');
    if (sessionPathParts.length !== 3) {
      res.status(400).json({ success: false, error: 'Invalid session path format' });
      return;
    }

    // Verify user has access to this session
    const hasAccess = await verifySessionAccess(userId, sessionPath);
    if (!hasAccess) {
      res.status(403).json({ success: false, error: 'Access denied to this session' });
      return;
    }

    // Fetch content from URL (skip HEAD validation since frontend already validated)
    const fetchResult = await fetchFromUrl({ url, skipValidation: true });

    if (!fetchResult.success || !fetchResult.content) {
      res.status(400).json({
        success: false,
        error: fetchResult.error || 'Failed to fetch content from URL',
      });
      return;
    }

    // Determine target file path
    const filePath = targetPath || fetchResult.suggestedFilename || 'imported-file';

    // Build workspace directory and safely resolve full path
    const workspaceDir = path.join(WORKSPACE_DIR, `session-${sessionPath}`, 'workspace');
    const fullPath = safeResolvePath(workspaceDir, filePath);

    if (!fullPath) {
      res.status(400).json({ success: false, error: 'Invalid file path' });
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

    res.json({
      success: true,
      data: {
        filePath,
        contentType: fetchResult.contentType,
        size: fetchResult.size,
        isBinary: fetchResult.isBinary,
      },
    });
  } catch (error) {
    console.error('URL import error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Import failed',
    });
  }
});

export default router;
