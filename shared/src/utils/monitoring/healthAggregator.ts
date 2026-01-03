/**
 * Health Aggregator Service
 *
 * Provides unified visibility into external service health status by aggregating
 * health checks for database, GitHub API, Claude API, and other dependencies.
 * Includes historical metrics, failure rates, latency tracking, and alerting thresholds.
 */

import { healthMonitor } from './healthMonitor.js';
import { circuitBreakerRegistry } from '../resilience/circuitBreaker.js';
import { getExternalApiCircuitBreakerStatus, areExternalApisAvailable } from '../resilience/externalApiResilience.js';
import { logger } from '../logging/logger.js';
import { metrics } from './metrics.js';

import type { CircuitBreakerStats } from '../resilience/ACircuitBreaker.js';
import type { HealthCheckResult } from './AHealthMonitor.js';

// =============================================================================
// Types and Interfaces
// =============================================================================

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface HealthThreshold {
  warningLatencyMs: number;
  criticalLatencyMs: number;
  warningFailureRate: number;
  criticalFailureRate: number;
}

export interface ServiceHealthMetric {
  timestamp: Date;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface ServiceHealthHistory {
  serviceName: string;
  metrics: ServiceHealthMetric[];
  averageLatencyMs: number;
  failureRate: number;
  lastCheck: Date | null;
  windowMs: number;
}

export interface ServiceHealthStatus {
  name: string;
  displayName: string;
  status: ServiceStatus;
  latencyMs: number | null;
  lastCheck: Date | null;
  circuitBreaker: {
    state: string;
    available: boolean;
    stats: CircuitBreakerStats | null;
  } | null;
  history: ServiceHealthHistory | null;
  alert: AlertInfo | null;
}

export interface AlertInfo {
  severity: AlertSeverity;
  message: string;
  triggeredAt: Date;
  threshold: string;
}

export interface AggregatedHealthStatus {
  overallStatus: ServiceStatus;
  services: ServiceHealthStatus[];
  alerts: AlertInfo[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
    total: number;
  };
  metrics: {
    uptime: number;
    totalRequests: number;
    errorRate: number;
    avgResponseTime: number;
  };
  timestamp: string;
}

// =============================================================================
// Default Thresholds
// =============================================================================

const DEFAULT_THRESHOLDS: Record<string, HealthThreshold> = {
  database: {
    warningLatencyMs: 100,
    criticalLatencyMs: 500,
    warningFailureRate: 0.01, // 1%
    criticalFailureRate: 0.05, // 5%
  },
  github: {
    warningLatencyMs: 1000,
    criticalLatencyMs: 5000,
    warningFailureRate: 0.05, // 5%
    criticalFailureRate: 0.15, // 15%
  },
  'claude-remote': {
    warningLatencyMs: 2000,
    criticalLatencyMs: 10000,
    warningFailureRate: 0.05, // 5%
    criticalFailureRate: 0.15, // 15%
  },
  'image-gen:openrouter': {
    warningLatencyMs: 5000,
    criticalLatencyMs: 30000,
    warningFailureRate: 0.10, // 10%
    criticalFailureRate: 0.25, // 25%
  },
  'image-gen:cometapi': {
    warningLatencyMs: 5000,
    criticalLatencyMs: 30000,
    warningFailureRate: 0.10, // 10%
    criticalFailureRate: 0.25, // 25%
  },
  'image-gen:google': {
    warningLatencyMs: 5000,
    criticalLatencyMs: 30000,
    warningFailureRate: 0.10, // 10%
    criticalFailureRate: 0.25, // 25%
  },
};

// =============================================================================
// Health Aggregator Class
// =============================================================================

class HealthAggregator {
  private historyMap: Map<string, ServiceHealthMetric[]> = new Map();
  private thresholds: Map<string, HealthThreshold> = new Map();
  private historyWindowMs: number = 5 * 60 * 1000; // 5 minutes
  private maxHistoryEntries: number = 100;

  constructor() {
    // Initialize default thresholds
    for (const [service, threshold] of Object.entries(DEFAULT_THRESHOLDS)) {
      this.thresholds.set(service, threshold);
    }
  }

  /**
   * Record a health check result for historical tracking.
   */
  recordMetric(serviceName: string, latencyMs: number, success: boolean, error?: string): void {
    const metrics = this.historyMap.get(serviceName) || [];
    const now = new Date();

    metrics.push({
      timestamp: now,
      latencyMs,
      success,
      error,
    });

    // Trim old entries
    const cutoff = now.getTime() - this.historyWindowMs;
    const trimmed = metrics.filter(m => m.timestamp.getTime() > cutoff);

    // Limit entries
    if (trimmed.length > this.maxHistoryEntries) {
      trimmed.splice(0, trimmed.length - this.maxHistoryEntries);
    }

    this.historyMap.set(serviceName, trimmed);
  }

  /**
   * Get historical metrics for a service.
   */
  getHistory(serviceName: string): ServiceHealthHistory | null {
    const metrics = this.historyMap.get(serviceName);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    const totalLatency = metrics.reduce((sum, m) => sum + m.latencyMs, 0);
    const failures = metrics.filter(m => !m.success).length;

    return {
      serviceName,
      metrics: [...metrics],
      averageLatencyMs: Math.round(totalLatency / metrics.length),
      failureRate: failures / metrics.length,
      lastCheck: metrics[metrics.length - 1]?.timestamp || null,
      windowMs: this.historyWindowMs,
    };
  }

  /**
   * Set custom threshold for a service.
   */
  setThreshold(serviceName: string, threshold: HealthThreshold): void {
    this.thresholds.set(serviceName, threshold);
  }

  /**
   * Get threshold for a service.
   */
  getThreshold(serviceName: string): HealthThreshold | null {
    return this.thresholds.get(serviceName) || null;
  }

  /**
   * Check if a service is in an alert state based on thresholds.
   */
  private checkAlert(
    serviceName: string,
    latencyMs: number | null,
    failureRate: number
  ): AlertInfo | null {
    const threshold = this.thresholds.get(serviceName);
    if (!threshold) {
      return null;
    }

    // Check critical thresholds first
    if (failureRate >= threshold.criticalFailureRate) {
      return {
        severity: 'critical',
        message: `${serviceName} failure rate (${(failureRate * 100).toFixed(1)}%) exceeds critical threshold (${(threshold.criticalFailureRate * 100).toFixed(1)}%)`,
        triggeredAt: new Date(),
        threshold: `failureRate >= ${(threshold.criticalFailureRate * 100).toFixed(1)}%`,
      };
    }

    if (latencyMs !== null && latencyMs >= threshold.criticalLatencyMs) {
      return {
        severity: 'critical',
        message: `${serviceName} latency (${latencyMs}ms) exceeds critical threshold (${threshold.criticalLatencyMs}ms)`,
        triggeredAt: new Date(),
        threshold: `latencyMs >= ${threshold.criticalLatencyMs}ms`,
      };
    }

    // Check warning thresholds
    if (failureRate >= threshold.warningFailureRate) {
      return {
        severity: 'warning',
        message: `${serviceName} failure rate (${(failureRate * 100).toFixed(1)}%) exceeds warning threshold (${(threshold.warningFailureRate * 100).toFixed(1)}%)`,
        triggeredAt: new Date(),
        threshold: `failureRate >= ${(threshold.warningFailureRate * 100).toFixed(1)}%`,
      };
    }

    if (latencyMs !== null && latencyMs >= threshold.warningLatencyMs) {
      return {
        severity: 'warning',
        message: `${serviceName} latency (${latencyMs}ms) exceeds warning threshold (${threshold.warningLatencyMs}ms)`,
        triggeredAt: new Date(),
        threshold: `latencyMs >= ${threshold.warningLatencyMs}ms`,
      };
    }

    return null;
  }

  /**
   * Determine status based on circuit breaker state and health check.
   */
  private determineStatus(
    circuitState: string | null,
    healthResult: HealthCheckResult | undefined,
    available: boolean
  ): ServiceStatus {
    if (circuitState === 'open' || !available) {
      return 'unhealthy';
    }

    if (circuitState === 'half_open') {
      return 'degraded';
    }

    if (healthResult) {
      return healthResult.status;
    }

    return 'unknown';
  }

  /**
   * Get display name for a service.
   */
  private getDisplayName(serviceName: string): string {
    const displayNames: Record<string, string> = {
      database: 'PostgreSQL Database',
      github: 'GitHub API',
      'claude-remote': 'Claude API',
      'image-gen:openrouter': 'OpenRouter (Image Gen)',
      'image-gen:cometapi': 'CometAPI (Image Gen)',
      'image-gen:google': 'Google (Image Gen)',
    };
    return displayNames[serviceName] || serviceName;
  }

  /**
   * Get aggregated health status for all external services.
   */
  async getAggregatedHealth(): Promise<AggregatedHealthStatus> {
    const services: ServiceHealthStatus[] = [];
    const alerts: AlertInfo[] = [];

    // Get database health
    const dbResult = healthMonitor.getLastResult('database');
    const dbHistory = this.getHistory('database');
    const dbLatency = dbResult?.latencyMs ?? dbHistory?.averageLatencyMs ?? null;
    const dbFailureRate = dbHistory?.failureRate ?? 0;
    const dbStatus = dbResult?.status ?? 'unknown';
    const dbAlert = this.checkAlert('database', dbLatency, dbFailureRate);

    if (dbAlert) alerts.push(dbAlert);

    services.push({
      name: 'database',
      displayName: this.getDisplayName('database'),
      status: dbStatus,
      latencyMs: dbLatency,
      lastCheck: dbResult?.lastCheck ?? null,
      circuitBreaker: null,
      history: dbHistory,
      alert: dbAlert,
    });

    // Get external API status
    const externalApiStatus = getExternalApiCircuitBreakerStatus();
    const externalApiAvailable = areExternalApisAvailable();

    // GitHub
    const githubHistory = this.getHistory('github');
    const githubLatency = githubHistory?.averageLatencyMs ?? null;
    const githubFailureRate = githubHistory?.failureRate ?? 0;
    const githubStatus = this.determineStatus(
      externalApiStatus.github.state,
      undefined,
      externalApiAvailable.github
    );
    const githubAlert = this.checkAlert('github', githubLatency, githubFailureRate);

    if (githubAlert) alerts.push(githubAlert);

    // Check for circuit breaker state alerts
    if (externalApiStatus.github.state === 'open') {
      alerts.push({
        severity: 'critical',
        message: 'GitHub API circuit breaker is OPEN - requests are being rejected',
        triggeredAt: new Date(),
        threshold: 'circuit_breaker_open',
      });
    }

    services.push({
      name: 'github',
      displayName: this.getDisplayName('github'),
      status: githubStatus,
      latencyMs: githubLatency,
      lastCheck: githubHistory?.lastCheck ?? null,
      circuitBreaker: {
        state: externalApiStatus.github.state,
        available: externalApiAvailable.github,
        stats: externalApiStatus.github.stats,
      },
      history: githubHistory,
      alert: githubAlert,
    });

    // Claude Remote
    const claudeHistory = this.getHistory('claude-remote');
    const claudeLatency = claudeHistory?.averageLatencyMs ?? null;
    const claudeFailureRate = claudeHistory?.failureRate ?? 0;
    const claudeStatus = this.determineStatus(
      externalApiStatus.claudeRemote.state,
      undefined,
      externalApiAvailable.claudeRemote
    );
    const claudeAlert = this.checkAlert('claude-remote', claudeLatency, claudeFailureRate);

    if (claudeAlert) alerts.push(claudeAlert);

    if (externalApiStatus.claudeRemote.state === 'open') {
      alerts.push({
        severity: 'critical',
        message: 'Claude API circuit breaker is OPEN - requests are being rejected',
        triggeredAt: new Date(),
        threshold: 'circuit_breaker_open',
      });
    }

    services.push({
      name: 'claude-remote',
      displayName: this.getDisplayName('claude-remote'),
      status: claudeStatus,
      latencyMs: claudeLatency,
      lastCheck: claudeHistory?.lastCheck ?? null,
      circuitBreaker: {
        state: externalApiStatus.claudeRemote.state,
        available: externalApiAvailable.claudeRemote,
        stats: externalApiStatus.claudeRemote.stats,
      },
      history: claudeHistory,
      alert: claudeAlert,
    });

    // Image generation providers
    for (const provider of ['openrouter', 'cometapi', 'google'] as const) {
      const serviceName = `image-gen:${provider}`;
      const history = this.getHistory(serviceName);
      const latency = history?.averageLatencyMs ?? null;
      const failureRate = history?.failureRate ?? 0;
      const providerStatus = externalApiStatus.imageGen[provider];
      const providerAvailable = externalApiAvailable.imageGen[provider];

      const status = this.determineStatus(
        providerStatus.state,
        undefined,
        providerAvailable
      );

      const alert = this.checkAlert(serviceName, latency, failureRate);
      if (alert) alerts.push(alert);

      if (providerStatus.state === 'open') {
        alerts.push({
          severity: 'warning',
          message: `Image gen provider ${provider} circuit breaker is OPEN`,
          triggeredAt: new Date(),
          threshold: 'circuit_breaker_open',
        });
      }

      services.push({
        name: serviceName,
        displayName: this.getDisplayName(serviceName),
        status,
        latencyMs: latency,
        lastCheck: history?.lastCheck ?? null,
        circuitBreaker: {
          state: providerStatus.state,
          available: providerAvailable,
          stats: providerStatus.stats,
        },
        history: history,
        alert: alert,
      });
    }

    // Calculate summary
    const summary = {
      healthy: services.filter(s => s.status === 'healthy').length,
      degraded: services.filter(s => s.status === 'degraded').length,
      unhealthy: services.filter(s => s.status === 'unhealthy').length,
      unknown: services.filter(s => s.status === 'unknown').length,
      total: services.length,
    };

    // Determine overall status
    let overallStatus: ServiceStatus = 'healthy';
    if (summary.unhealthy > 0) {
      // If critical services (database, claude) are unhealthy, overall is unhealthy
      const criticalUnhealthy = services.filter(
        s => (s.name === 'database' || s.name === 'claude-remote') && s.status === 'unhealthy'
      );
      overallStatus = criticalUnhealthy.length > 0 ? 'unhealthy' : 'degraded';
    } else if (summary.degraded > 0) {
      overallStatus = 'degraded';
    } else if (summary.unknown === summary.total) {
      overallStatus = 'unknown';
    }

    // Get application metrics
    const appMetrics = metrics.getSummary();

    return {
      overallStatus,
      services,
      alerts: alerts.sort((a, b) => {
        // Sort by severity (critical first) then by time
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.triggeredAt.getTime() - a.triggeredAt.getTime();
      }),
      summary,
      metrics: appMetrics,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Set the history window duration.
   */
  setHistoryWindow(windowMs: number): void {
    this.historyWindowMs = windowMs;
  }

  /**
   * Clear all historical metrics.
   */
  clearHistory(): void {
    this.historyMap.clear();
    logger.info('Health aggregator history cleared', { component: 'HealthAggregator' });
  }

  /**
   * Get all current thresholds.
   */
  getAllThresholds(): Record<string, HealthThreshold> {
    const result: Record<string, HealthThreshold> = {};
    for (const [name, threshold] of this.thresholds) {
      result[name] = { ...threshold };
    }
    return result;
  }
}

// Export singleton instance
export const healthAggregator = new HealthAggregator();
