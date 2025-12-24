import { ALogCapture } from './ALogCapture.js';
import type { CapturedLog } from './ALogCapture.js';
import type { LogFilter } from './ALogCapture.js';
import type { LogCaptureStatus } from './ALogCapture.js';

export type { CapturedLog, LogFilter, LogCaptureStatus } from './ALogCapture.js';

class LogCapture extends ALogCapture {
  private logs: CapturedLog[] = [];
  private maxLogs: number = 5000;
  private enabled: boolean = true;

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

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  getLogs(filter?: LogFilter): {
    logs: CapturedLog[];
    total: number;
    filtered: number;
  } {
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

      const limit = Math.min(filter.limit || 100, 1000);
      filtered = filtered.slice(-limit);
    } else {
      filtered = filtered.slice(-100);
    }

    return {
      logs: filtered,
      total,
      filtered: filtered.length,
    };
  }

  clear(): void {
    this.logs = [];
  }

  setMaxLogs(max: number): void {
    this.maxLogs = max;
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getStatus(): LogCaptureStatus {
    return {
      enabled: this.enabled,
      count: this.logs.length,
      maxLogs: this.maxLogs,
    };
  }
}

export const logCapture: ALogCapture = new LogCapture();
