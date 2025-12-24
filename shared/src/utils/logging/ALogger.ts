import { AService } from '../../services/abstracts/AService.js';
import type { ILogger } from './logger.doc.js';
import type { LogContext } from './logger.doc.js';

export type { LogContext } from './logger.doc.js';

export abstract class ALogger extends AService implements ILogger {
  override readonly order: number = -100;

  abstract debug(message: string, context?: LogContext): void;

  abstract info(message: string, context?: LogContext): void;

  abstract warn(message: string, context?: LogContext): void;

  abstract error(message: string, error?: Error | unknown, context?: LogContext): void;
}
