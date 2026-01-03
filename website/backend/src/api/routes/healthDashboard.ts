/**
 * Health Dashboard API Routes
 *
 * Provides unified health monitoring endpoints for the admin dashboard.
 * Aggregates health status from database, GitHub, Claude, and other services.
 */

import { Router } from 'express';
import { healthAggregator, logger } from '@webedt/shared';

import type { HealthThreshold } from '@webedt/shared';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: HealthDashboard
 *     description: Unified health monitoring for external services
 */

/**
 * @openapi
 * /health-dashboard:
 *   get:
 *     tags:
 *       - HealthDashboard
 *     summary: Get aggregated health status of all external services
 *     description: |
 *       Returns health status for database, GitHub API, Claude API, and image generation providers.
 *       Includes circuit breaker states, failure rates, latency metrics, and active alerts.
 *     security: []
 *     responses:
 *       200:
 *         description: Aggregated health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     overallStatus:
 *                       type: string
 *                       enum: [healthy, degraded, unhealthy, unknown]
 *                     services:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           displayName:
 *                             type: string
 *                           status:
 *                             type: string
 *                           latencyMs:
 *                             type: number
 *                             nullable: true
 *                           circuitBreaker:
 *                             type: object
 *                             nullable: true
 *                           alert:
 *                             type: object
 *                             nullable: true
 *                     alerts:
 *                       type: array
 *                     summary:
 *                       type: object
 *                     metrics:
 *                       type: object
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', async (req, res) => {
  try {
    const healthStatus = await healthAggregator.getAggregatedHealth();

    res.json({
      success: true,
      data: healthStatus,
    });
  } catch (error) {
    logger.error('Error fetching aggregated health:', error, {
      component: 'HealthDashboard',
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch health status',
    });
  }
});

/**
 * @openapi
 * /health-dashboard/thresholds:
 *   get:
 *     tags:
 *       - HealthDashboard
 *     summary: Get current alerting thresholds for all services
 *     security: []
 *     responses:
 *       200:
 *         description: Threshold configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       warningLatencyMs:
 *                         type: number
 *                       criticalLatencyMs:
 *                         type: number
 *                       warningFailureRate:
 *                         type: number
 *                       criticalFailureRate:
 *                         type: number
 */
router.get('/thresholds', (req, res) => {
  try {
    const thresholds = healthAggregator.getAllThresholds();

    res.json({
      success: true,
      data: thresholds,
    });
  } catch (error) {
    logger.error('Error fetching thresholds:', error, {
      component: 'HealthDashboard',
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch thresholds',
    });
  }
});

/**
 * @openapi
 * /health-dashboard/thresholds/{serviceName}:
 *   put:
 *     tags:
 *       - HealthDashboard
 *     summary: Update alerting thresholds for a specific service
 *     parameters:
 *       - name: serviceName
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
 *             properties:
 *               warningLatencyMs:
 *                 type: number
 *               criticalLatencyMs:
 *                 type: number
 *               warningFailureRate:
 *                 type: number
 *               criticalFailureRate:
 *                 type: number
 *     responses:
 *       200:
 *         description: Threshold updated
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.put('/thresholds/:serviceName', (req, res) => {
  try {
    const { serviceName } = req.params;
    const threshold = req.body as Partial<HealthThreshold>;

    // Validate the threshold values
    if (!threshold || typeof threshold !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid threshold configuration',
      });
      return;
    }

    const existingThreshold = healthAggregator.getThreshold(serviceName);
    if (!existingThreshold) {
      res.status(404).json({
        success: false,
        error: `Unknown service: ${serviceName}`,
      });
      return;
    }

    // Merge with existing threshold
    const newThreshold: HealthThreshold = {
      warningLatencyMs: threshold.warningLatencyMs ?? existingThreshold.warningLatencyMs,
      criticalLatencyMs: threshold.criticalLatencyMs ?? existingThreshold.criticalLatencyMs,
      warningFailureRate: threshold.warningFailureRate ?? existingThreshold.warningFailureRate,
      criticalFailureRate: threshold.criticalFailureRate ?? existingThreshold.criticalFailureRate,
    };

    healthAggregator.setThreshold(serviceName, newThreshold);

    logger.info(`Updated health threshold for ${serviceName}`, {
      component: 'HealthDashboard',
      serviceName,
      threshold: newThreshold,
    });

    res.json({
      success: true,
      data: {
        serviceName,
        threshold: newThreshold,
      },
    });
  } catch (error) {
    logger.error('Error updating threshold:', error, {
      component: 'HealthDashboard',
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update threshold',
    });
  }
});

/**
 * @openapi
 * /health-dashboard/record:
 *   post:
 *     tags:
 *       - HealthDashboard
 *     summary: Record a health metric for a service (internal use)
 *     description: Used internally to record health check results for historical tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - serviceName
 *               - latencyMs
 *               - success
 *             properties:
 *               serviceName:
 *                 type: string
 *               latencyMs:
 *                 type: number
 *               success:
 *                 type: boolean
 *               error:
 *                 type: string
 *     responses:
 *       200:
 *         description: Metric recorded
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 */
router.post('/record', (req, res) => {
  try {
    const { serviceName, latencyMs, success, error } = req.body;

    if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: serviceName, latencyMs, success',
      });
      return;
    }

    healthAggregator.recordMetric(serviceName, latencyMs, success, error);

    res.json({
      success: true,
      data: {
        recorded: true,
      },
    });
  } catch (error) {
    logger.error('Error recording metric:', error, {
      component: 'HealthDashboard',
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record metric',
    });
  }
});

/**
 * @openapi
 * /health-dashboard/history:
 *   delete:
 *     tags:
 *       - HealthDashboard
 *     summary: Clear health history data
 *     security: []
 *     responses:
 *       200:
 *         description: History cleared
 */
router.delete('/history', (req, res) => {
  try {
    healthAggregator.clearHistory();

    logger.info('Health history cleared via API', {
      component: 'HealthDashboard',
    });

    res.json({
      success: true,
      data: {
        message: 'Health history cleared successfully',
      },
    });
  } catch (error) {
    logger.error('Error clearing history:', error, {
      component: 'HealthDashboard',
    });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear history',
    });
  }
});

export default router;
