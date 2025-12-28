/**
 * URL Fetcher
 * Utility for fetching content from external URLs with security checks
 */

import type { UrlImportOptions, UrlImportResult, UrlValidationResult } from './types.js';
import {
  ALLOWED_PROTOCOLS,
  DEFAULT_MAX_SIZE,
  DEFAULT_TIMEOUT,
  BINARY_CONTENT_TYPES,
} from './types.js';

/**
 * Extract filename from URL or Content-Disposition header
 */
function extractFilename(url: string, contentDisposition?: string | null): string {
  // Try Content-Disposition header first
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch?.[1]) {
      return filenameMatch[1].replace(/['"]/g, '');
    }
  }

  // Extract from URL path
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // Remove query string if present in segment
      return lastSegment.split('?')[0];
    }
  } catch {
    // Invalid URL, return default
  }

  return 'imported-file';
}

/**
 * Check if content type indicates binary content
 */
function isBinaryContentType(contentType: string): boolean {
  const lowerType = contentType.toLowerCase();
  return BINARY_CONTENT_TYPES.some(prefix => lowerType.startsWith(prefix));
}

/**
 * Check if a hostname is a private/local address (SSRF protection)
 */
function isPrivateOrLocalAddress(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // IPv4 localhost and special addresses
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.localhost')
  ) {
    return true;
  }

  // IPv6 localhost
  if (lower === '::1' || lower === '[::1]' || lower === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // IPv4 private ranges
  // 10.0.0.0/8
  if (/^10\./.test(lower)) {
    return true;
  }
  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  const match172 = lower.match(/^172\.(\d+)\./);
  if (match172) {
    const second = parseInt(match172[1], 10);
    if (second >= 16 && second <= 31) {
      return true;
    }
  }
  // 192.168.0.0/16
  if (/^192\.168\./.test(lower)) {
    return true;
  }
  // 169.254.0.0/16 (link-local)
  if (/^169\.254\./.test(lower)) {
    return true;
  }

  return false;
}

/**
 * Validate a URL without fetching its content
 */
export async function validateUrl(url: string): Promise<UrlValidationResult> {
  try {
    // Parse and validate URL
    const urlObj = new URL(url);

    // Check protocol
    if (!ALLOWED_PROTOCOLS.includes(urlObj.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${urlObj.protocol}. Only HTTP and HTTPS are allowed.`,
      };
    }

    // Prevent SSRF attacks - block private IP ranges
    if (isPrivateOrLocalAddress(urlObj.hostname)) {
      return {
        valid: false,
        error: 'Private or local addresses are not allowed.',
      };
    }

    // Make a HEAD request to check accessibility
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'WebEDT-URL-Import/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          valid: false,
          error: `URL returned status ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentLength = response.headers.get('content-length');
      const contentDisposition = response.headers.get('content-disposition');

      return {
        valid: true,
        suggestedFilename: extractFilename(url, contentDisposition),
        contentType,
        contentLength: contentLength ? parseInt(contentLength, 10) : undefined,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { valid: false, error: 'Request timed out' };
      }
      throw error;
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid URL',
    };
  }
}

/**
 * Quick URL validation (no HEAD request) - just checks URL format and hostname
 */
function quickValidateUrl(url: string): { valid: boolean; error?: string } {
  try {
    const urlObj = new URL(url);

    if (!ALLOWED_PROTOCOLS.includes(urlObj.protocol)) {
      return {
        valid: false,
        error: `Invalid protocol: ${urlObj.protocol}. Only HTTP and HTTPS are allowed.`,
      };
    }

    if (isPrivateOrLocalAddress(urlObj.hostname)) {
      return {
        valid: false,
        error: 'Private or local addresses are not allowed.',
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Fetch content from a URL
 */
export async function fetchFromUrl(options: UrlImportOptions): Promise<UrlImportResult> {
  const { url, timeout = DEFAULT_TIMEOUT, maxSize = DEFAULT_MAX_SIZE, skipValidation = false } = options;

  try {
    if (skipValidation) {
      // Quick validation without HEAD request (when validateUrl was already called)
      const quickCheck = quickValidateUrl(url);
      if (!quickCheck.valid) {
        return { success: false, error: quickCheck.error };
      }
    } else {
      // Full validation with HEAD request
      const validation = await validateUrl(url);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Check content length if available
      if (validation.contentLength && validation.contentLength > maxSize) {
        return {
          success: false,
          error: `File too large: ${Math.round(validation.contentLength / 1024 / 1024)}MB exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`,
        };
      }
    }

    // Fetch the content
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'WebEDT-URL-Import/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to fetch: ${response.status} ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const contentDisposition = response.headers.get('content-disposition');
      const isBinary = isBinaryContentType(contentType);

      // Read response as appropriate type
      let content: string;
      let size: number;

      if (isBinary) {
        const buffer = await response.arrayBuffer();
        size = buffer.byteLength;

        if (size > maxSize) {
          return {
            success: false,
            error: `File too large: ${Math.round(size / 1024 / 1024)}MB exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`,
          };
        }

        // Convert to base64 - use Buffer in Node.js for efficiency
        if (typeof Buffer !== 'undefined') {
          content = Buffer.from(buffer).toString('base64');
        } else {
          // Fallback for browser environments (chunked to avoid call stack issues)
          const bytes = new Uint8Array(buffer);
          const chunks: string[] = [];
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            chunks.push(String.fromCharCode(...chunk));
          }
          content = btoa(chunks.join(''));
        }
      } else {
        content = await response.text();
        size = new TextEncoder().encode(content).length;

        if (size > maxSize) {
          return {
            success: false,
            error: `File too large: ${Math.round(size / 1024 / 1024)}MB exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`,
          };
        }
      }

      return {
        success: true,
        content,
        contentType,
        size,
        suggestedFilename: extractFilename(url, contentDisposition),
        isBinary,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timed out' };
      }
      throw error;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch URL',
    };
  }
}
