/**
 * Alerting System for Critical Failures
 *
 * Provides configurable alerting hooks for monitoring system health.
 * Supports:
 * - Multiple alert severity levels
 * - Customizable thresholds
 * - Multiple notification channels (webhook, console, file)
 * - Rate limiting to prevent alert storms
 * - Alert aggregation and deduplication
 */

import { logger } from '../utils/logger.js';
import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/** Alert severity levels */
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Alert status */
export type AlertStatus = 'active' | 'resolved' | 'acknowledged';

/** Alert threshold configuration */
export interface AlertThreshold {
  /** Metric name to monitor */
  metricName: string;
  /** Threshold value */
  threshold: number;
  /** Comparison operator */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  /** Alert severity when triggered */
  severity: AlertSeverity;
  /** Minimum interval between alerts in milliseconds */
  cooldownMs: number;
  /** Description of the alert condition */
  description: string;
}

/** Alert hook function signature */
export type AlertHook = (alert: Alert) => Promise<void> | void;

/** Alert configuration */
export interface AlertConfig {
  /** Enable alerting system */
  enabled: boolean;
  /** Webhook URL for sending alerts */
  webhookUrl?: string;
  /** File path for writing alerts */
  alertLogPath?: string;
  /** Default cooldown between repeated alerts (ms) */
  defaultCooldownMs: number;
  /** Maximum alerts per minute (rate limiting) */
  maxAlertsPerMinute: number;
  /** Enable console output for alerts */
  consoleOutput: boolean;
  /** Minimum severity for webhook notifications */
  webhookMinSeverity: AlertSeverity;
  /** Include stack traces in alerts */
  includeStackTrace: boolean;
  /** Enable alert aggregation for similar alerts */
  aggregateAlerts: boolean;
  /** Aggregation window in milliseconds */
  aggregationWindowMs: number;
}

/** Alert data structure */
export interface Alert {
  /** Unique alert ID */
  id: string;
  /** Alert severity */
  severity: AlertSeverity;
  /** Alert status */
  status: AlertStatus;
  /** Alert title */
  title: string;
  /** Detailed message */
  message: string;
  /** Metric that triggered the alert (if applicable) */
  metricName?: string;
  /** Current metric value */
  metricValue?: number;
  /** Threshold that was exceeded */
  threshold?: number;
  /** Component that generated the alert */
  component: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Number of occurrences (for aggregated alerts) */
  occurrenceCount: number;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Error stack trace if applicable */
  stackTrace?: string;
  /** Suggested recovery actions */
  recoveryActions?: string[];
}

/** Default configuration values */
const DEFAULT_ALERT_CONFIG: AlertConfig = {
  enabled: true,
  defaultCooldownMs: 60000, // 1 minute
  maxAlertsPerMinute: 30,
  consoleOutput: true,
  webhookMinSeverity: 'error',
  includeStackTrace: true,
  aggregateAlerts: true,
  aggregationWindowMs: 300000, // 5 minutes
};

/** Predefined alert thresholds */
export const DEFAULT_THRESHOLDS: AlertThreshold[] = [
  {
    metricName: 'error_rate',
    threshold: 0.1, // 10% error rate
    operator: 'gt',
    severity: 'warning',
    cooldownMs: 300000,
    description: 'Error rate exceeded 10%',
  },
  {
    metricName: 'error_rate',
    threshold: 0.25, // 25% error rate
    operator: 'gt',
    severity: 'error',
    cooldownMs: 300000,
    description: 'Error rate exceeded 25%',
  },
  {
    metricName: 'error_rate',
    threshold: 0.5, // 50% error rate
    operator: 'gt',
    severity: 'critical',
    cooldownMs: 60000,
    description: 'Critical error rate exceeded 50%',
  },
  {
    metricName: 'circuit_breaker_open',
    threshold: 1,
    operator: 'eq',
    severity: 'warning',
    cooldownMs: 60000,
    description: 'Circuit breaker opened',
  },
  {
    metricName: 'consecutive_failures',
    threshold: 5,
    operator: 'gte',
    severity: 'error',
    cooldownMs: 120000,
    description: 'Multiple consecutive task failures',
  },
  {
    metricName: 'memory_usage_percent',
    threshold: 90,
    operator: 'gt',
    severity: 'warning',
    cooldownMs: 300000,
    description: 'Memory usage above 90%',
  },
  {
    metricName: 'queue_utilization',
    threshold: 95,
    operator: 'gt',
    severity: 'warning',
    cooldownMs: 120000,
    description: 'Task queue nearly full',
  },
];

/**
 * Alerting system for critical failures
 */
export class AlertingSystem {
  private config: AlertConfig;
  private thresholds: AlertThreshold[] = [];
  private hooks: AlertHook[] = [];
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private lastAlertTimes: Map<string, Date> = new Map();
  private alertCounts: { timestamp: number; count: number }[] = [];
  private maxHistorySize: number = 1000;

  constructor(config: Partial<AlertConfig> = {}) {
    this.config = { ...DEFAULT_ALERT_CONFIG, ...config };
    this.thresholds = [...DEFAULT_THRESHOLDS];

    // Ensure alert log directory exists
    if (this.config.alertLogPath) {
      const dir = dirname(this.config.alertLogPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Add a custom alert threshold
   */
  addThreshold(threshold: AlertThreshold): void {
    this.thresholds.push(threshold);
    logger.debug('Added alert threshold', {
      metricName: threshold.metricName,
      threshold: threshold.threshold,
      severity: threshold.severity,
    });
  }

  /**
   * Remove a threshold by metric name
   */
  removeThreshold(metricName: string): void {
    this.thresholds = this.thresholds.filter(t => t.metricName !== metricName);
  }

  /**
   * Register an alert hook
   */
  registerHook(hook: AlertHook): void {
    this.hooks.push(hook);
    logger.debug('Registered alert hook');
  }

  /**
   * Check metric value against thresholds
   */
  checkMetric(metricName: string, value: number, context?: Record<string, unknown>): Alert | null {
    if (!this.config.enabled) return null;

    const matchingThresholds = this.thresholds.filter(t => t.metricName === metricName);

    for (const threshold of matchingThresholds) {
      const triggered = this.evaluateThreshold(value, threshold);

      if (triggered) {
        // Check cooldown
        const lastAlert = this.lastAlertTimes.get(`${metricName}_${threshold.severity}`);
        if (lastAlert && Date.now() - lastAlert.getTime() < threshold.cooldownMs) {
          continue; // Still in cooldown
        }

        // Check rate limit
        if (!this.checkRateLimit()) {
          logger.warn('Alert rate limit exceeded, suppressing alert', {
            metricName,
            severity: threshold.severity,
          });
          continue;
        }

        const alert = this.createAlert({
          severity: threshold.severity,
          title: threshold.description,
          message: `${threshold.description}: ${metricName} = ${value} (threshold: ${threshold.operator} ${threshold.threshold})`,
          metricName,
          metricValue: value,
          threshold: threshold.threshold,
          component: 'metrics',
          context,
        });

        return alert;
      }
    }

    return null;
  }

  /**
   * Create and fire an alert
   */
  createAlert(params: {
    severity: AlertSeverity;
    title: string;
    message: string;
    component: string;
    metricName?: string;
    metricValue?: number;
    threshold?: number;
    correlationId?: string;
    context?: Record<string, unknown>;
    error?: Error;
    recoveryActions?: string[];
  }): Alert {
    const alertId = this.generateAlertId(params.component, params.title);

    // Check for existing alert (aggregation)
    if (this.config.aggregateAlerts) {
      const existing = this.activeAlerts.get(alertId);
      if (existing && Date.now() - existing.createdAt.getTime() < this.config.aggregationWindowMs) {
        existing.occurrenceCount++;
        existing.updatedAt = new Date();
        existing.metricValue = params.metricValue ?? existing.metricValue;
        return existing;
      }
    }

    const alert: Alert = {
      id: alertId,
      severity: params.severity,
      status: 'active',
      title: params.title,
      message: params.message,
      metricName: params.metricName,
      metricValue: params.metricValue,
      threshold: params.threshold,
      component: params.component,
      correlationId: params.correlationId,
      createdAt: new Date(),
      updatedAt: new Date(),
      occurrenceCount: 1,
      context: params.context,
      stackTrace: params.error && this.config.includeStackTrace ? params.error.stack : undefined,
      recoveryActions: params.recoveryActions,
    };

    this.activeAlerts.set(alertId, alert);
    this.alertHistory.push(alert);
    this.lastAlertTimes.set(`${params.metricName}_${params.severity}`, new Date());
    this.recordAlertForRateLimit();

    // Trim history
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }

    // Fire alert handlers
    this.fireAlert(alert);

    return alert;
  }

  /**
   * Create a critical failure alert
   */
  alertCriticalFailure(
    component: string,
    message: string,
    error?: Error,
    context?: Record<string, unknown>
  ): Alert {
    return this.createAlert({
      severity: 'critical',
      title: `Critical Failure in ${component}`,
      message,
      component,
      context,
      error,
      recoveryActions: [
        'Check system logs for details',
        'Review recent configuration changes',
        'Consider pausing autonomous operations',
      ],
    });
  }

  /**
   * Create a service degradation alert
   */
  alertServiceDegraded(
    serviceName: string,
    reason: string,
    context?: Record<string, unknown>
  ): Alert {
    return this.createAlert({
      severity: 'warning',
      title: `Service Degraded: ${serviceName}`,
      message: `${serviceName} is operating in degraded mode: ${reason}`,
      component: serviceName,
      context,
      recoveryActions: [
        'Monitor service health',
        'Check external dependencies',
        'Review circuit breaker status',
      ],
    });
  }

  /**
   * Create a high error rate alert
   */
  alertHighErrorRate(
    errorRate: number,
    component: string,
    context?: Record<string, unknown>
  ): Alert {
    const severity: AlertSeverity = errorRate > 0.5 ? 'critical' : errorRate > 0.25 ? 'error' : 'warning';

    return this.createAlert({
      severity,
      title: `High Error Rate in ${component}`,
      message: `Error rate at ${(errorRate * 100).toFixed(1)}%`,
      component,
      metricName: 'error_rate',
      metricValue: errorRate,
      context,
      recoveryActions: [
        'Review recent errors in logs',
        'Check external service availability',
        'Consider reducing workload',
      ],
    });
  }

  /**
   * Resolve an active alert
   */
  resolveAlert(alertId: string, resolution?: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.status = 'resolved';
      alert.updatedAt = new Date();
      if (resolution) {
        alert.context = { ...alert.context, resolution };
      }

      this.activeAlerts.delete(alertId);
      logger.info('Alert resolved', {
        alertId,
        title: alert.title,
        duration: Date.now() - alert.createdAt.getTime(),
      });
    }
  }

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert(alertId: string, acknowledgedBy?: string): void {
    const alert = this.activeAlerts.get(alertId);
    if (alert) {
      alert.status = 'acknowledged';
      alert.updatedAt = new Date();
      alert.context = { ...alert.context, acknowledgedBy };

      logger.info('Alert acknowledged', {
        alertId,
        title: alert.title,
        acknowledgedBy,
      });
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get active alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity): Alert[] {
    return this.getActiveAlerts().filter(a => a.severity === severity);
  }

  /**
   * Get alert history
   */
  getAlertHistory(options?: {
    since?: Date;
    severity?: AlertSeverity;
    component?: string;
    limit?: number;
  }): Alert[] {
    let filtered = this.alertHistory;

    if (options?.since) {
      filtered = filtered.filter(a => a.createdAt >= options.since!);
    }
    if (options?.severity) {
      filtered = filtered.filter(a => a.severity === options.severity);
    }
    if (options?.component) {
      filtered = filtered.filter(a => a.component === options.component);
    }
    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    activeCount: number;
    activeBySeverity: Record<AlertSeverity, number>;
    totalHistoryCount: number;
    alertsLastHour: number;
    alertsLast24Hours: number;
  } {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    const activeBySeverity: Record<AlertSeverity, number> = {
      info: 0,
      warning: 0,
      error: 0,
      critical: 0,
    };

    for (const alert of this.activeAlerts.values()) {
      activeBySeverity[alert.severity]++;
    }

    return {
      activeCount: this.activeAlerts.size,
      activeBySeverity,
      totalHistoryCount: this.alertHistory.length,
      alertsLastHour: this.alertHistory.filter(a => a.createdAt.getTime() > oneHourAgo).length,
      alertsLast24Hours: this.alertHistory.filter(a => a.createdAt.getTime() > oneDayAgo).length,
    };
  }

  /**
   * Clear all active alerts
   */
  clearAllAlerts(): void {
    this.activeAlerts.clear();
    logger.info('All active alerts cleared');
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AlertConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Alert configuration updated', config);
  }

  /**
   * Get current configuration
   */
  getConfig(): AlertConfig {
    return { ...this.config };
  }

  /**
   * Evaluate a threshold condition
   */
  private evaluateThreshold(value: number, threshold: AlertThreshold): boolean {
    switch (threshold.operator) {
      case 'gt': return value > threshold.threshold;
      case 'gte': return value >= threshold.threshold;
      case 'lt': return value < threshold.threshold;
      case 'lte': return value <= threshold.threshold;
      case 'eq': return value === threshold.threshold;
      case 'neq': return value !== threshold.threshold;
      default: return false;
    }
  }

  /**
   * Generate alert ID for deduplication
   */
  private generateAlertId(component: string, title: string): string {
    return `${component}_${title}_${Date.now()}`.replace(/\s+/g, '_').toLowerCase();
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean old entries
    this.alertCounts = this.alertCounts.filter(c => c.timestamp > oneMinuteAgo);

    // Count alerts in last minute
    const recentCount = this.alertCounts.reduce((sum, c) => sum + c.count, 0);

    return recentCount < this.config.maxAlertsPerMinute;
  }

  /**
   * Record alert for rate limiting
   */
  private recordAlertForRateLimit(): void {
    this.alertCounts.push({ timestamp: Date.now(), count: 1 });
  }

  /**
   * Fire alert to all handlers
   */
  private async fireAlert(alert: Alert): Promise<void> {
    // Console output
    if (this.config.consoleOutput) {
      this.logAlertToConsole(alert);
    }

    // Write to file
    if (this.config.alertLogPath) {
      this.writeAlertToFile(alert);
    }

    // Send webhook (for error/critical)
    if (this.config.webhookUrl && this.shouldSendWebhook(alert.severity)) {
      await this.sendWebhook(alert);
    }

    // Call custom hooks
    for (const hook of this.hooks) {
      try {
        await hook(alert);
      } catch (error) {
        logger.error('Alert hook failed', {
          error: error instanceof Error ? error.message : String(error),
          alertId: alert.id,
        });
      }
    }
  }

  /**
   * Log alert to console with appropriate level
   */
  private logAlertToConsole(alert: Alert): void {
    const logData = {
      alertId: alert.id,
      title: alert.title,
      component: alert.component,
      metricName: alert.metricName,
      metricValue: alert.metricValue,
      threshold: alert.threshold,
      occurrences: alert.occurrenceCount,
      correlationId: alert.correlationId,
    };

    switch (alert.severity) {
      case 'critical':
        logger.error(`🚨 CRITICAL ALERT: ${alert.message}`, logData);
        break;
      case 'error':
        logger.error(`🔴 ERROR ALERT: ${alert.message}`, logData);
        break;
      case 'warning':
        logger.warn(`⚠️ WARNING ALERT: ${alert.message}`, logData);
        break;
      case 'info':
        logger.info(`ℹ️ INFO ALERT: ${alert.message}`, logData);
        break;
    }
  }

  /**
   * Write alert to log file
   */
  private writeAlertToFile(alert: Alert): void {
    if (!this.config.alertLogPath) return;

    const logEntry = JSON.stringify({
      ...alert,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    }) + '\n';

    try {
      appendFileSync(this.config.alertLogPath, logEntry);
    } catch (error) {
      logger.error('Failed to write alert to file', {
        error: error instanceof Error ? error.message : String(error),
        path: this.config.alertLogPath,
      });
    }
  }

  /**
   * Check if webhook should be sent for this severity
   */
  private shouldSendWebhook(severity: AlertSeverity): boolean {
    const severityOrder: AlertSeverity[] = ['info', 'warning', 'error', 'critical'];
    const minIndex = severityOrder.indexOf(this.config.webhookMinSeverity);
    const currentIndex = severityOrder.indexOf(severity);
    return currentIndex >= minIndex;
  }

  /**
   * Send alert to webhook
   */
  private async sendWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;

    try {
      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'autonomous-dev-alert',
          alert: {
            ...alert,
            createdAt: alert.createdAt.toISOString(),
            updatedAt: alert.updatedAt.toISOString(),
          },
        }),
      });

      if (!response.ok) {
        logger.warn('Webhook response not OK', {
          status: response.status,
          alertId: alert.id,
        });
      }
    } catch (error) {
      logger.error('Failed to send alert webhook', {
        error: error instanceof Error ? error.message : String(error),
        alertId: alert.id,
        webhookUrl: this.config.webhookUrl,
      });
    }
  }
}

// Singleton instance
let alertingSystemInstance: AlertingSystem | null = null;

/**
 * Get or create the global alerting system instance
 */
export function getAlertingSystem(config?: Partial<AlertConfig>): AlertingSystem {
  if (!alertingSystemInstance) {
    alertingSystemInstance = new AlertingSystem(config);
  }
  return alertingSystemInstance;
}

/**
 * Reset the global alerting system instance
 */
export function resetAlertingSystem(): void {
  if (alertingSystemInstance) {
    alertingSystemInstance.clearAllAlerts();
  }
  alertingSystemInstance = null;
}
