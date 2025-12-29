/**
 * Event Helper Utilities
 * Provides consistent event data extraction and manipulation
 */

/**
 * Extracts the UUID from an event data object.
 * Returns null if no UUID is present or if the UUID is not a valid string.
 *
 * @param eventData - The event data object that may contain a uuid field
 * @returns The UUID string or null if not present/invalid
 */
export function extractEventUuid(eventData: Record<string, unknown>): string | null {
  const uuid = eventData?.uuid;

  // Only return if it's a non-empty string
  if (typeof uuid === 'string' && uuid.length > 0) {
    return uuid;
  }

  return null;
}
