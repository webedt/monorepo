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
/** Predefined alert thresholds */
export declare const DEFAULT_THRESHOLDS: AlertThreshold[];
/**
 * Alerting system for critical failures
 */
export declare class AlertingSystem {
    private config;
    private thresholds;
    private hooks;
    private activeAlerts;
    private alertHistory;
    private lastAlertTimes;
    private alertCounts;
    private maxHistorySize;
    constructor(config?: Partial<AlertConfig>);
    /**
     * Add a custom alert threshold
     */
    addThreshold(threshold: AlertThreshold): void;
    /**
     * Remove a threshold by metric name
     */
    removeThreshold(metricName: string): void;
    /**
     * Register an alert hook
     */
    registerHook(hook: AlertHook): void;
    /**
     * Check metric value against thresholds
     */
    checkMetric(metricName: string, value: number, context?: Record<string, unknown>): Alert | null;
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
    }): Alert;
    /**
     * Create a critical failure alert
     */
    alertCriticalFailure(component: string, message: string, error?: Error, context?: Record<string, unknown>): Alert;
    /**
     * Create a service degradation alert
     */
    alertServiceDegraded(serviceName: string, reason: string, context?: Record<string, unknown>): Alert;
    /**
     * Create a high error rate alert
     */
    alertHighErrorRate(errorRate: number, component: string, context?: Record<string, unknown>): Alert;
    /**
     * Resolve an active alert
     */
    resolveAlert(alertId: string, resolution?: string): void;
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId: string, acknowledgedBy?: string): void;
    /**
     * Get all active alerts
     */
    getActiveAlerts(): Alert[];
    /**
     * Get active alerts by severity
     */
    getAlertsBySeverity(severity: AlertSeverity): Alert[];
    /**
     * Get alert history
     */
    getAlertHistory(options?: {
        since?: Date;
        severity?: AlertSeverity;
        component?: string;
        limit?: number;
    }): Alert[];
    /**
     * Get alert statistics
     */
    getStats(): {
        activeCount: number;
        activeBySeverity: Record<AlertSeverity, number>;
        totalHistoryCount: number;
        alertsLastHour: number;
        alertsLast24Hours: number;
    };
    /**
     * Clear all active alerts
     */
    clearAllAlerts(): void;
    /**
     * Update configuration
     */
    updateConfig(config: Partial<AlertConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): AlertConfig;
    /**
     * Evaluate a threshold condition
     */
    private evaluateThreshold;
    /**
     * Generate alert ID for deduplication
     */
    private generateAlertId;
    /**
     * Check rate limit
     */
    private checkRateLimit;
    /**
     * Record alert for rate limiting
     */
    private recordAlertForRateLimit;
    /**
     * Fire alert to all handlers
     */
    private fireAlert;
    /**
     * Log alert to console with appropriate level
     */
    private logAlertToConsole;
    /**
     * Write alert to log file
     */
    private writeAlertToFile;
    /**
     * Check if webhook should be sent for this severity
     */
    private shouldSendWebhook;
    /**
     * Send alert to webhook
     */
    private sendWebhook;
}
/**
 * Get or create the global alerting system instance
 */
export declare function getAlertingSystem(config?: Partial<AlertConfig>): AlertingSystem;
/**
 * Reset the global alerting system instance
 */
export declare function resetAlertingSystem(): void;
//# sourceMappingURL=alerting.d.ts.map