/**
 * Logging utilities for WebEDT services
 * @module utils/logging
 */

// Abstract classes and types
export { ALogger, type LogContext } from './ALogger.js';
export { ALogCapture, type CapturedLog, type LogFilter, type LogCaptureStatus } from './ALogCapture.js';

// Implementations
export { logger, verboseLogger, type VerboseContext } from './logger.js';
export { logCapture } from './logCapture.js';

// Correlation context for request tracing
export {
  getCorrelationContext,
  getCorrelationId,
  runWithCorrelation,
  runWithCorrelationContext,
  updateCorrelationContext,
  withCorrelationContext,
  type CorrelationContext,
} from './correlationContext.js';
