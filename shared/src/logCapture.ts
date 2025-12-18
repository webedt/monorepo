/**
 * In-memory log capture for debugging
 * Captures logs in a circular buffer for retrieval via API
 */

export interface CapturedLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface LogFilter {
  level?: string;
  component?: string;
  sessionId?: string;
  since?: string;
  limit?: number;
}

class LogCapture {
  private logs: CapturedLog[] = [];
  private maxLogs: number = 5000;
  private enabled: boolean = true;

  /**
   * Capture a log entry
   */
  capture(
    level: CapturedLog['level'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown
  ): void {
    if (!this.enabled) return;

    const entry: CapturedLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
    };

    if (error) {
      if (error instanceof Error) {
        entry.error = {
          message: error.message,
          stack: error.stack,
        };
      } else {
        entry.error = {
          message: String(error),
        };
      }
    }

    this.logs.push(entry);

    // Circular buffer - remove oldest logs if over limit
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  /**
   * Get logs with optional filtering
   */
  getLogs(filter?: LogFilter): { logs: CapturedLog[]; total: number; filtered: number } {
    const total = this.logs.length;
    let filtered = this.logs;

    if (filter) {
      if (filter.level) {
        filtered = filtered.filter(log => log.level === filter.level);
      }

      if (filter.component) {
        filtered = filtered.filter(
          log => log.context?.component === filter.component
        );
      }

      if (filter.sessionId) {
        filtered = filtered.filter(
          log => log.context?.sessionId === filter.sessionId
        );
      }

      if (filter.since) {
        const sinceDate = new Date(filter.since);
        filtered = filtered.filter(
          log => new Date(log.timestamp) >= sinceDate
        );
      }

      // Apply limit (default to 100, max 1000)
      const limit = Math.min(filter.limit || 100, 1000);
      filtered = filtered.slice(-limit);
    } else {
      // Default: return last 100 logs
      filtered = filtered.slice(-100);
    }

    return {
      logs: filtered,
      total,
      filtered: filtered.length,
    };
  }

  /**
   * Clear all captured logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Set maximum number of logs to retain
   */
  setMaxLogs(max: number): void {
    this.maxLogs = max;
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  /**
   * Enable or disable log capture
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Get capture status
   */
  getStatus(): { enabled: boolean; count: number; maxLogs: number } {
    return {
      enabled: this.enabled,
      count: this.logs.length,
      maxLogs: this.maxLogs,
    };
  }
}

// Singleton instance
export const logCapture = new LogCapture();
