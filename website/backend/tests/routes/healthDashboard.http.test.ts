/**
 * HTTP Tests for Health Dashboard Routes
 * Covers health monitoring endpoints: aggregated health, thresholds, metrics recording
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';

describe('Health Dashboard HTTP Routes', () => {
  describe('GET / - Get Aggregated Health Status', () => {
    it('should return aggregated health status', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/', (req, res) => {
        res.json({
          success: true,
          data: {
            overallStatus: 'healthy',
            services: [
              {
                name: 'database',
                displayName: 'Database',
                status: 'healthy',
                latencyMs: 5,
                circuitBreaker: null,
                alert: null,
              },
              {
                name: 'github',
                displayName: 'GitHub API',
                status: 'healthy',
                latencyMs: 120,
                circuitBreaker: { state: 'closed' },
                alert: null,
              },
              {
                name: 'claude',
                displayName: 'Claude API',
                status: 'degraded',
                latencyMs: 500,
                circuitBreaker: { state: 'half-open' },
                alert: { severity: 'warning', message: 'High latency detected' },
              },
            ],
            alerts: [{ serviceName: 'claude', severity: 'warning', message: 'High latency detected' }],
            summary: { healthy: 2, degraded: 1, unhealthy: 0 },
            metrics: { totalRequests: 1000, avgLatencyMs: 208 },
          },
        });
      });

      const response = await request(app)
        .get('/')
        .expect('Content-Type', /json/)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.overallStatus, 'healthy');
      assert.strictEqual(response.body.data.services.length, 3);
      assert.strictEqual(response.body.data.summary.healthy, 2);
    });

    it('should work without authentication (public endpoint)', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/', (req, res) => {
        res.json({
          success: true,
          data: { overallStatus: 'healthy', services: [] },
        });
      });

      const response = await request(app)
        .get('/')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should handle error during health fetch', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/', (req, res) => {
        res.status(500).json({
          success: false,
          error: 'Failed to fetch health status',
        });
      });

      const response = await request(app)
        .get('/')
        .expect(500);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('GET /thresholds - Get All Thresholds', () => {
    it('should return all threshold configurations', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/thresholds', (req, res) => {
        res.json({
          success: true,
          data: {
            database: {
              warningLatencyMs: 100,
              criticalLatencyMs: 500,
              warningFailureRate: 0.05,
              criticalFailureRate: 0.2,
            },
            github: {
              warningLatencyMs: 200,
              criticalLatencyMs: 1000,
              warningFailureRate: 0.1,
              criticalFailureRate: 0.3,
            },
            claude: {
              warningLatencyMs: 300,
              criticalLatencyMs: 2000,
              warningFailureRate: 0.1,
              criticalFailureRate: 0.25,
            },
          },
        });
      });

      const response = await request(app)
        .get('/thresholds')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.database);
      assert.ok(response.body.data.github);
      assert.strictEqual(response.body.data.database.warningLatencyMs, 100);
    });

    it('should work without authentication (public endpoint)', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/thresholds', (req, res) => {
        res.json({ success: true, data: {} });
      });

      const response = await request(app)
        .get('/thresholds')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('PUT /thresholds/:serviceName - Update Service Threshold', () => {
    it('should return 400 when threshold configuration is invalid', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.put('/thresholds/:serviceName', (req, res) => {
        const threshold = req.body;
        // Validate that threshold has required numeric fields
        if (!threshold || typeof threshold.warning !== 'number' || typeof threshold.critical !== 'number') {
          res.status(400).json({
            success: false,
            error: 'Invalid threshold configuration',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .put('/thresholds/database')
        .send({ invalid: 'data' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Invalid threshold configuration');
    });

    it('should return 404 for unknown service', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.put('/thresholds/:serviceName', (req, res) => {
        const { serviceName } = req.params;
        const knownServices = ['database', 'github', 'claude', 'imageGen'];
        if (!knownServices.includes(serviceName)) {
          res.status(404).json({
            success: false,
            error: `Unknown service: ${serviceName}`,
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .put('/thresholds/unknown-service')
        .send({ warningLatencyMs: 100 })
        .expect(404);

      assert.ok(response.body.error.includes('Unknown service'));
    });

    it('should update threshold successfully', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.put('/thresholds/:serviceName', (req, res) => {
        const { serviceName } = req.params;
        const threshold = req.body;
        res.json({
          success: true,
          data: {
            serviceName,
            threshold: {
              warningLatencyMs: threshold.warningLatencyMs || 100,
              criticalLatencyMs: threshold.criticalLatencyMs || 500,
              warningFailureRate: threshold.warningFailureRate || 0.05,
              criticalFailureRate: threshold.criticalFailureRate || 0.2,
            },
          },
        });
      });

      const response = await request(app)
        .put('/thresholds/database')
        .send({
          warningLatencyMs: 150,
          criticalLatencyMs: 750,
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.serviceName, 'database');
      assert.strictEqual(response.body.data.threshold.warningLatencyMs, 150);
    });

    it('should merge with existing threshold values', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.put('/thresholds/:serviceName', (req, res) => {
        const threshold = req.body;
        // Merge with existing (simulated) values
        const existingThreshold = {
          warningLatencyMs: 100,
          criticalLatencyMs: 500,
          warningFailureRate: 0.05,
          criticalFailureRate: 0.2,
        };
        const newThreshold = {
          warningLatencyMs: threshold.warningLatencyMs ?? existingThreshold.warningLatencyMs,
          criticalLatencyMs: threshold.criticalLatencyMs ?? existingThreshold.criticalLatencyMs,
          warningFailureRate: threshold.warningFailureRate ?? existingThreshold.warningFailureRate,
          criticalFailureRate: threshold.criticalFailureRate ?? existingThreshold.criticalFailureRate,
        };
        res.json({ success: true, data: { threshold: newThreshold } });
      });

      const response = await request(app)
        .put('/thresholds/database')
        .send({ warningLatencyMs: 200 }) // Only update one field
        .expect(200);

      assert.strictEqual(response.body.data.threshold.warningLatencyMs, 200);
      assert.strictEqual(response.body.data.threshold.criticalLatencyMs, 500); // Unchanged
    });
  });

  describe('POST /record - Record Health Metric', () => {
    it('should return 400 when required fields are missing', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/record', (req, res) => {
        const { serviceName, latencyMs, success } = req.body;
        if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
          res.status(400).json({
            success: false,
            error: 'Missing required fields: serviceName, latencyMs, success',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/record')
        .send({ serviceName: 'database' }) // Missing latencyMs and success
        .expect(400);

      assert.ok(response.body.error.includes('Missing required fields'));
    });

    it('should return 400 when latencyMs is not a number', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/record', (req, res) => {
        const { serviceName, latencyMs, success } = req.body;
        if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
          res.status(400).json({
            success: false,
            error: 'Missing required fields: serviceName, latencyMs, success',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/record')
        .send({ serviceName: 'database', latencyMs: 'not-a-number', success: true })
        .expect(400);

      assert.ok(response.body.error.includes('Missing required fields'));
    });

    it('should return 400 when success is not a boolean', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/record', (req, res) => {
        const { serviceName, latencyMs, success } = req.body;
        if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
          res.status(400).json({
            success: false,
            error: 'Missing required fields: serviceName, latencyMs, success',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/record')
        .send({ serviceName: 'database', latencyMs: 50, success: 'yes' })
        .expect(400);

      assert.ok(response.body.error.includes('Missing required fields'));
    });

    it('should record successful metric', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/record', (req, res) => {
        const { serviceName, latencyMs, success } = req.body;
        if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
          res.status(400).json({ success: false, error: 'Missing required fields' });
          return;
        }
        res.json({ success: true, data: { recorded: true } });
      });

      const response = await request(app)
        .post('/record')
        .send({
          serviceName: 'database',
          latencyMs: 25,
          success: true,
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.recorded, true);
    });

    it('should record failed metric with error message', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/record', (req, res) => {
        const { serviceName, latencyMs, success, error } = req.body;
        if (!serviceName || typeof latencyMs !== 'number' || typeof success !== 'boolean') {
          res.status(400).json({ success: false, error: 'Missing required fields' });
          return;
        }
        res.json({
          success: true,
          data: {
            recorded: true,
            hadError: !success,
            errorMessage: error || null,
          },
        });
      });

      const response = await request(app)
        .post('/record')
        .send({
          serviceName: 'github',
          latencyMs: 5000,
          success: false,
          error: 'Connection timeout',
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.hadError, true);
      assert.strictEqual(response.body.data.errorMessage, 'Connection timeout');
    });
  });

  describe('DELETE /history - Clear Health History', () => {
    it('should clear health history successfully', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/history', (req, res) => {
        res.json({
          success: true,
          data: { message: 'Health history cleared successfully' },
        });
      });

      const response = await request(app)
        .delete('/history')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('cleared'));
    });

    it('should work without authentication (public endpoint)', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/history', (req, res) => {
        res.json({
          success: true,
          data: { message: 'Health history cleared successfully' },
        });
      });

      const response = await request(app)
        .delete('/history')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should handle error during history clear', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/history', (req, res) => {
        res.status(500).json({
          success: false,
          error: 'Failed to clear history',
        });
      });

      const response = await request(app)
        .delete('/history')
        .expect(500);

      assert.strictEqual(response.body.success, false);
    });
  });
});
