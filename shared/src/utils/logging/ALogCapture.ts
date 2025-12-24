import { AService } from '../../services/abstracts/AService.js';
import type { ILogCapture } from './logCapture.doc.js';
import type { CapturedLog } from './logCapture.doc.js';
import type { LogFilter } from './logCapture.doc.js';
import type { LogCaptureStatus } from './logCapture.doc.js';

export type { CapturedLog, LogFilter, LogCaptureStatus } from './logCapture.doc.js';

export abstract class ALogCapture extends AService implements ILogCapture {
  override readonly order: number = -90;

  abstract capture(
    level: CapturedLog['level'],
    message: string,
    context?: Record<string, unknown>,
    error?: Error | unknown
  ): void;

  abstract getLogs(filter?: LogFilter): {
    logs: CapturedLog[];
    total: number;
    filtered: number;
  };

  abstract clear(): void;

  abstract setMaxLogs(max: number): void;

  abstract setEnabled(enabled: boolean): void;

  abstract getStatus(): LogCaptureStatus;
}
