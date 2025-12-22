/**
 * Logging utilities for WebEDT services
 * @module utils/logging
 */

// Interfaces
export type { ILogger, LogContext } from './ILogger.js';
export type { ILogCapture, CapturedLog, LogFilter, LogCaptureStatus } from './ILogCapture.js';

// Implementations
export { logger } from './logger.js';
export { logCapture } from './logCapture.js';
