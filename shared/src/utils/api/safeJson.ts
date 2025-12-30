/**
 * Safe JSON Utilities
 * Safe JSON parsing and stringification with error handling
 * @module utils/api/safeJson
 */

/**
 * Result type for safe JSON parsing
 */
export type SafeJsonResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Safely parse JSON string without throwing
 * @param jsonString - The JSON string to parse
 * @param defaultValue - Optional default value if parsing fails
 * @returns Parsed value or default, with success indicator
 */
export function safeJsonParse<T = unknown>(
  jsonString: string
): SafeJsonResult<T>;
export function safeJsonParse<T = unknown>(
  jsonString: string,
  defaultValue: T
): T;
export function safeJsonParse<T = unknown>(
  jsonString: string,
  defaultValue?: T
): SafeJsonResult<T> | T {
  try {
    const data = JSON.parse(jsonString) as T;
    if (defaultValue !== undefined) {
      return data;
    }
    return { success: true, data };
  } catch (error) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }
}

/**
 * Safely stringify value to JSON without throwing
 * @param value - The value to stringify
 * @param defaultValue - Optional default value if stringification fails
 * @returns JSON string or default
 */
export function safeJsonStringify(
  value: unknown
): SafeJsonResult<string>;
export function safeJsonStringify(
  value: unknown,
  defaultValue: string
): string;
export function safeJsonStringify(
  value: unknown,
  defaultValue?: string
): SafeJsonResult<string> | string {
  try {
    const data = JSON.stringify(value);
    if (defaultValue !== undefined) {
      return data;
    }
    return { success: true, data };
  } catch (error) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Stringify failed',
    };
  }
}

/**
 * Safely decode Base64 string and parse as JSON
 * @param base64String - The Base64 encoded JSON string
 * @returns Parsed value with success indicator
 */
export function safeBase64JsonParse<T = unknown>(
  base64String: string
): SafeJsonResult<T>;
export function safeBase64JsonParse<T = unknown>(
  base64String: string,
  defaultValue: T
): T;
export function safeBase64JsonParse<T = unknown>(
  base64String: string,
  defaultValue?: T
): SafeJsonResult<T> | T {
  try {
    const decoded = Buffer.from(base64String, 'base64').toString('utf-8');
    return safeJsonParse(decoded, defaultValue as T);
  } catch (error) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid Base64 or JSON',
    };
  }
}

/**
 * Type guard to check if value is a valid JSON object (not array, not null)
 * @param value - Value to check
 * @returns True if value is a plain object
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to check if value is a valid JSON array
 * @param value - Value to check
 * @returns True if value is an array
 */
export function isJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
