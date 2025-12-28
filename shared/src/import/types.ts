/**
 * URL Import Types
 * Type definitions for importing files from external URLs
 */

export interface UrlImportOptions {
  /** URL to fetch content from */
  url: string;
  /** Optional timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Maximum file size in bytes (default: 10MB) */
  maxSize?: number;
}

export interface UrlImportResult {
  /** Successfully fetched content */
  success: boolean;
  /** File content (text or base64 for binary) */
  content?: string;
  /** Content type from response */
  contentType?: string;
  /** File size in bytes */
  size?: number;
  /** Suggested filename from URL or Content-Disposition */
  suggestedFilename?: string;
  /** Whether content is binary (base64 encoded) */
  isBinary?: boolean;
  /** Error message if failed */
  error?: string;
}

export interface UrlValidationResult {
  /** Whether the URL is valid and accessible */
  valid: boolean;
  /** Suggested filename */
  suggestedFilename?: string;
  /** Content type */
  contentType?: string;
  /** Content length if available */
  contentLength?: number;
  /** Error message if invalid */
  error?: string;
}

/** Allowed URL protocols */
export const ALLOWED_PROTOCOLS = ['https:', 'http:'];

/** Default maximum file size (10MB) */
export const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

/** Default timeout (30 seconds) */
export const DEFAULT_TIMEOUT = 30000;

/** Binary content types that should be base64 encoded */
export const BINARY_CONTENT_TYPES = [
  'image/',
  'audio/',
  'video/',
  'application/octet-stream',
  'application/zip',
  'application/gzip',
  'application/pdf',
  'application/wasm',
];
