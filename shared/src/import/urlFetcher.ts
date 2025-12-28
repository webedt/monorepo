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
    const hostname = urlObj.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.endsWith('.local')
    ) {
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
 * Fetch content from a URL
 */
export async function fetchFromUrl(options: UrlImportOptions): Promise<UrlImportResult> {
  const { url, timeout = DEFAULT_TIMEOUT, maxSize = DEFAULT_MAX_SIZE } = options;

  try {
    // Validate URL first
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

        // Convert to base64
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        content = btoa(binary);
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
