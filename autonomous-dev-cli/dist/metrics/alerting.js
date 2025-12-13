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
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
/** Default configuration values */
const DEFAULT_ALERT_CONFIG = {
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
export const DEFAULT_THRESHOLDS = [
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
    config;
    thresholds = [];
    hooks = [];
    activeAlerts = new Map();
    alertHistory = [];
    lastAlertTimes = new Map();
    alertCounts = [];
    maxHistorySize = 1000;
    constructor(config = {}) {
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
    addThreshold(threshold) {
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
    removeThreshold(metricName) {
        this.thresholds = this.thresholds.filter(t => t.metricName !== metricName);
    }
    /**
     * Register an alert hook
     */
    registerHook(hook) {
        this.hooks.push(hook);
        logger.debug('Registered alert hook');
    }
    /**
     * Check metric value against thresholds
     */
    checkMetric(metricName, value, context) {
        if (!this.config.enabled)
            return null;
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
    createAlert(params) {
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
        const alert = {
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
    alertCriticalFailure(component, message, error, context) {
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
    alertServiceDegraded(serviceName, reason, context) {
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
    alertHighErrorRate(errorRate, component, context) {
        const severity = errorRate > 0.5 ? 'critical' : errorRate > 0.25 ? 'error' : 'warning';
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
    resolveAlert(alertId, resolution) {
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
    acknowledgeAlert(alertId, acknowledgedBy) {
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
    getActiveAlerts() {
        return Array.from(this.activeAlerts.values());
    }
    /**
     * Get active alerts by severity
     */
    getAlertsBySeverity(severity) {
        return this.getActiveAlerts().filter(a => a.severity === severity);
    }
    /**
     * Get alert history
     */
    getAlertHistory(options) {
        let filtered = this.alertHistory;
        if (options?.since) {
            filtered = filtered.filter(a => a.createdAt >= options.since);
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
    getStats() {
        const now = Date.now();
        const oneHourAgo = now - 3600000;
        const oneDayAgo = now - 86400000;
        const activeBySeverity = {
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
    clearAllAlerts() {
        this.activeAlerts.clear();
        logger.info('All active alerts cleared');
    }
    /**
     * Update configuration
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
        logger.info('Alert configuration updated', config);
    }
    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Evaluate a threshold condition
     */
    evaluateThreshold(value, threshold) {
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
    generateAlertId(component, title) {
        return `${component}_${title}_${Date.now()}`.replace(/\s+/g, '_').toLowerCase();
    }
    /**
     * Check rate limit
     */
    checkRateLimit() {
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
    recordAlertForRateLimit() {
        this.alertCounts.push({ timestamp: Date.now(), count: 1 });
    }
    /**
     * Fire alert to all handlers
     */
    async fireAlert(alert) {
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
            }
            catch (error) {
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
    logAlertToConsole(alert) {
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
    writeAlertToFile(alert) {
        if (!this.config.alertLogPath)
            return;
        const logEntry = JSON.stringify({
            ...alert,
            createdAt: alert.createdAt.toISOString(),
            updatedAt: alert.updatedAt.toISOString(),
        }) + '\n';
        try {
            appendFileSync(this.config.alertLogPath, logEntry);
        }
        catch (error) {
            logger.error('Failed to write alert to file', {
                error: error instanceof Error ? error.message : String(error),
                path: this.config.alertLogPath,
            });
        }
    }
    /**
     * Check if webhook should be sent for this severity
     */
    shouldSendWebhook(severity) {
        const severityOrder = ['info', 'warning', 'error', 'critical'];
        const minIndex = severityOrder.indexOf(this.config.webhookMinSeverity);
        const currentIndex = severityOrder.indexOf(severity);
        return currentIndex >= minIndex;
    }
    /**
     * Send alert to webhook
     */
    async sendWebhook(alert) {
        if (!this.config.webhookUrl)
            return;
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
        }
        catch (error) {
            logger.error('Failed to send alert webhook', {
                error: error instanceof Error ? error.message : String(error),
                alertId: alert.id,
                webhookUrl: this.config.webhookUrl,
            });
        }
    }
}
// Singleton instance
let alertingSystemInstance = null;
/**
 * Get or create the global alerting system instance
 */
export function getAlertingSystem(config) {
    if (!alertingSystemInstance) {
        alertingSystemInstance = new AlertingSystem(config);
    }
    return alertingSystemInstance;
}
/**
 * Reset the global alerting system instance
 */
export function resetAlertingSystem() {
    if (alertingSystemInstance) {
        alertingSystemInstance.clearAllAlerts();
    }
    alertingSystemInstance = null;
}
//# sourceMappingURL=alerting.js.map