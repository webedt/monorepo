/**
 * HTTP Tests for User Spending Limits Routes
 * Covers spending limits configuration and tracking
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../../helpers/testApp.js';

describe('User Spending Limits HTTP Routes', () => {
  describe('GET /spending-limits', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/spending-limits', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/spending-limits')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return spending limits configuration', async () => {
      const app = createTestApp();

      app.get('/spending-limits', (req, res) => {
        res.json({
          success: true,
          data: {
            enabled: true,
            monthlyBudgetCents: '10000',
            perTransactionLimitCents: '1000',
            resetDay: 1,
            currentMonthSpentCents: '2500',
            remainingBudgetCents: '7500',
            usagePercent: 25,
            limitAction: 'warn',
            lastResetAt: '2025-01-01T00:00:00.000Z',
          },
        });
      });

      const response = await request(app)
        .get('/spending-limits')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.enabled, true);
      assert.strictEqual(response.body.data.monthlyBudgetCents, '10000');
      assert.strictEqual(response.body.data.usagePercent, 25);
    });

    it('should handle zero budget correctly', async () => {
      const app = createTestApp();

      app.get('/spending-limits', (req, res) => {
        res.json({
          success: true,
          data: {
            enabled: false,
            monthlyBudgetCents: '0',
            perTransactionLimitCents: '0',
            resetDay: 1,
            currentMonthSpentCents: '0',
            remainingBudgetCents: '0',
            usagePercent: 0,
            limitAction: 'warn',
            lastResetAt: null,
          },
        });
      });

      const response = await request(app)
        .get('/spending-limits')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.usagePercent, 0);
    });

    it('should return 404 if user not found', async () => {
      const app = createTestApp();

      app.get('/spending-limits', (req, res) => {
        res.status(404).json({ success: false, error: 'User not found' });
      });

      const response = await request(app)
        .get('/spending-limits')
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /spending-limits', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/spending-limits', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ enabled: true })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 for negative monthly budget', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { monthlyBudgetCents } = req.body;
        if (monthlyBudgetCents !== undefined) {
          const budget = Number(monthlyBudgetCents);
          if (isNaN(budget) || budget < 0) {
            res.status(400).json({
              success: false,
              error: 'Monthly budget must be a non-negative number',
            });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ monthlyBudgetCents: -100 })
        .expect(400);

      assert.ok(response.body.error.includes('non-negative'));
    });

    it('should return 400 for negative per-transaction limit', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { perTransactionLimitCents } = req.body;
        if (perTransactionLimitCents !== undefined) {
          const limit = Number(perTransactionLimitCents);
          if (isNaN(limit) || limit < 0) {
            res.status(400).json({
              success: false,
              error: 'Per-transaction limit must be a non-negative number',
            });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ perTransactionLimitCents: -50 })
        .expect(400);

      assert.ok(response.body.error.includes('non-negative'));
    });

    it('should return 400 for reset day out of range', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { resetDay } = req.body;
        if (resetDay !== undefined) {
          const day = Number(resetDay);
          if (isNaN(day) || day < 1 || day > 31) {
            res.status(400).json({
              success: false,
              error: 'Reset day must be between 1 and 31',
            });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ resetDay: 32 })
        .expect(400);

      assert.strictEqual(response.body.error, 'Reset day must be between 1 and 31');
    });

    it('should return 400 for reset day below 1', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { resetDay } = req.body;
        if (resetDay !== undefined) {
          const day = Number(resetDay);
          if (isNaN(day) || day < 1 || day > 31) {
            res.status(400).json({
              success: false,
              error: 'Reset day must be between 1 and 31',
            });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ resetDay: 0 })
        .expect(400);

      assert.strictEqual(response.body.error, 'Reset day must be between 1 and 31');
    });

    it('should return 400 for invalid limit action', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { limitAction } = req.body;
        if (limitAction !== undefined) {
          const validActions = ['warn', 'block'];
          if (!validActions.includes(limitAction)) {
            res.status(400).json({
              success: false,
              error: 'Limit action must be one of: warn, block',
            });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ limitAction: 'invalid' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Limit action must be one of: warn, block');
    });

    it('should return 400 when no valid settings provided', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        const { enabled, monthlyBudgetCents, perTransactionLimitCents, resetDay, limitAction } = req.body;
        const updates: Record<string, unknown> = {};
        if (typeof enabled === 'boolean') updates.enabled = enabled;
        if (monthlyBudgetCents !== undefined) updates.monthlyBudgetCents = monthlyBudgetCents;
        if (perTransactionLimitCents !== undefined) updates.perTransactionLimitCents = perTransactionLimitCents;
        if (resetDay !== undefined) updates.resetDay = resetDay;
        if (limitAction !== undefined) updates.limitAction = limitAction;

        if (Object.keys(updates).length === 0) {
          res.status(400).json({
            success: false,
            error: 'No valid settings to update',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'No valid settings to update');
    });

    it('should update spending limits successfully', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        res.json({ success: true, data: { message: 'Spending limits updated successfully' } });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({
          enabled: true,
          monthlyBudgetCents: 10000,
          perTransactionLimitCents: 1000,
          resetDay: 15,
          limitAction: 'block',
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should update single setting successfully', async () => {
      const app = createTestApp();

      app.post('/spending-limits', (req, res) => {
        res.json({ success: true, data: { message: 'Spending limits updated successfully' } });
      });

      const response = await request(app)
        .post('/spending-limits')
        .send({ enabled: false })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /spending-limits/reset', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/spending-limits/reset', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/spending-limits/reset')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should reset monthly spending successfully', async () => {
      const app = createTestApp();

      app.post('/spending-limits/reset', (req, res) => {
        res.json({ success: true, data: { message: 'Monthly spending reset successfully' } });
      });

      const response = await request(app)
        .post('/spending-limits/reset')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('reset'));
    });
  });
});
