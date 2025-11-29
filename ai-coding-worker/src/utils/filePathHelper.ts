/**
 * Utility functions for file path manipulation
 */

/**
 * Extract relative path from an absolute file path by removing the session workspace prefix.
 *
 * Example:
 *   absolutePath: /tmp/session-xxx/monorepo/ai-coding-worker/src/index.ts
 *   workspacePath: /tmp/session-xxx/monorepo
 *   result: /ai-coding-worker/src/index.ts
 *
 * @param absolutePath The full absolute file path
 * @param workspacePath The workspace root path to remove
 * @returns The relative path starting with / or the original path if workspace prefix not found
 */
export function extractRelativePath(absolutePath: string, workspacePath: string): string {
  if (!absolutePath || !workspacePath) {
    return absolutePath || '';
  }

  // Normalize paths to handle trailing slashes
  const normalizedAbsolute = absolutePath.replace(/\/+$/, '');
  const normalizedWorkspace = workspacePath.replace(/\/+$/, '');

  // Check if the absolute path starts with the workspace path
  if (normalizedAbsolute.startsWith(normalizedWorkspace)) {
    const relativePath = normalizedAbsolute.substring(normalizedWorkspace.length);
    // Ensure the relative path starts with /
    return relativePath.startsWith('/') ? relativePath : '/' + relativePath;
  }

  // If workspace prefix not found, return the original path
  return absolutePath;
}

/**
 * Get just the filename from a path
 * @param filePath The file path (absolute or relative)
 * @returns The filename
 */
export function getFileName(filePath: string): string {
  if (!filePath) return 'unknown file';
  return filePath.split('/').pop() || filePath;
}

/**
 * Recursively process an object to add relativePath fields where filePath is found.
 * This is used to enrich events with relative paths for display.
 *
 * @param obj The object to process
 * @param workspacePath The workspace path to use for relative path calculation
 * @returns The object with added relativePath fields
 */
export function enrichEventWithRelativePaths(obj: any, workspacePath: string): any {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => enrichEventWithRelativePaths(item, workspacePath));
  }

  // Clone the object to avoid mutation
  const result: any = { ...obj };

  // Process all keys
  for (const key of Object.keys(result)) {
    const value = result[key];

    // If this is a filePath field, add a corresponding relativePath field
    if (key === 'filePath' && typeof value === 'string') {
      result.relativePath = extractRelativePath(value, workspacePath);
    }
    // Also handle file_path (snake_case version used in tool inputs)
    else if (key === 'file_path' && typeof value === 'string') {
      result.relative_path = extractRelativePath(value, workspacePath);
    }

    // Recursively process nested objects
    if (value && typeof value === 'object') {
      result[key] = enrichEventWithRelativePaths(value, workspacePath);
    }
  }

  return result;
}
