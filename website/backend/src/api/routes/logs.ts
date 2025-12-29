/**
 * Logs endpoint for debugging
 * Exposes captured server logs via API
 *
 * NOTE: This endpoint should be disabled in production
 */

import { Router } from 'express';
import {
  logCapture,
  logger,
  sendSuccess,
  sendInternalError,
} from '@webedt/shared';

const router = Router();

/**
 * GET /api/logs
 * Returns captured server logs with optional filtering
 *
 * Query parameters:
 * - level: Filter by log level (debug, info, warn, error)
 * - component: Filter by component name
 * - sessionId: Filter by session ID
 * - since: Filter logs after this ISO timestamp
 * - limit: Maximum number of logs to return (default: 100, max: 1000)
 *
 * Response:
 * - success: boolean
 * - data: { logs: CapturedLog[], total: number, filtered: number, status: { enabled, count, maxLogs } }
 */
router.get('/logs', (req, res) => {
  try {
    const { level, component, sessionId, since, limit } = req.query;

    const result = logCapture.getLogs({
      level: level as string | undefined,
      component: component as string | undefined,
      sessionId: sessionId as string | undefined,
      since: since as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });

    const status = logCapture.getStatus();

    sendSuccess(res, {
      ...result,
      status,
    });
  } catch (error) {
    logger.error('Error fetching logs:', error);
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to fetch logs');
  }
});

/**
 * DELETE /api/logs
 * Clears all captured logs
 */
router.delete('/logs', (req, res) => {
  try {
    logCapture.clear();
    logger.info('Logs cleared via API');

    sendSuccess(res, {
      message: 'Logs cleared successfully',
    });
  } catch (error) {
    logger.error('Error clearing logs:', error);
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to clear logs');
  }
});

/**
 * GET /api/logs/status
 * Returns log capture status
 */
router.get('/logs/status', (req, res) => {
  try {
    const status = logCapture.getStatus();

    sendSuccess(res, status);
  } catch (error) {
    sendInternalError(res, error instanceof Error ? error.message : 'Failed to get log status');
  }
});

export default router;
