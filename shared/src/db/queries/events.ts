/**
 * Event Query Helpers
 *
 * Composable query utilities for session events.
 * Reduces duplication in session/resume routes.
 */

import { eq, and, desc, asc, sql, gte, lte, isNull, isNotNull, gt } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, events, chatSessions } from '../index.js';
import type { Event, ChatSession } from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  combineConditions,
  excludeDeleted,
  onlyDeleted,
  buildTimeRangeConditions,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Event with parsed data for display
 */
export interface ParsedEvent {
  id: number;
  chatSessionId: string;
  uuid: string | null;
  eventData: unknown;
  eventType?: string;
  timestamp: Date;
  deletedAt: Date | null;
}

/**
 * Event filter options
 */
export interface EventFilterOptions {
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by event type (extracted from eventData.type) */
  eventType?: string | string[];
  /** Include soft-deleted events */
  includeDeleted?: boolean;
  /** Only include soft-deleted events */
  onlyDeleted?: boolean;
  /** Filter by time range */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  /** Filter events after a specific event ID (for pagination/resumption) */
  afterId?: number;
  /** Filter events with specific UUID */
  uuid?: string;
}

/**
 * Event replay options for SSE streaming
 */
export interface EventReplayOptions {
  /** Last event ID received by client (for resumption) */
  lastEventId?: number;
  /** Maximum number of events to fetch */
  limit?: number;
  /** Include deleted events in replay */
  includeDeleted?: boolean;
}

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build WHERE conditions for event queries
 */
export function buildEventConditions(
  options: EventFilterOptions
): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.sessionId) {
    conditions.push(eq(events.chatSessionId, options.sessionId));
  }

  if (options.eventType) {
    if (Array.isArray(options.eventType)) {
      const typesJson = JSON.stringify(options.eventType);
      conditions.push(sql`${events.eventData}->>'type' = ANY(${typesJson}::text[])`);
    } else {
      conditions.push(sql`${events.eventData}->>'type' = ${options.eventType}`);
    }
  }

  if (options.uuid) {
    conditions.push(eq(events.uuid, options.uuid));
  }

  if (options.afterId !== undefined) {
    conditions.push(gt(events.id, options.afterId));
  }

  if (options.timeRange) {
    const timeConditions = buildTimeRangeConditions(events.timestamp, options.timeRange);
    conditions.push(...timeConditions);
  }

  // Handle soft-delete filtering
  if (options.onlyDeleted) {
    conditions.push(onlyDeleted(events.deletedAt));
  } else if (!options.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  return combineConditions(...conditions);
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find an event by ID
 */
export async function findEventById(
  id: number,
  options?: { includeDeleted?: boolean }
): Promise<Event | null> {
  const conditions: SQL[] = [eq(events.id, id)];

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const [event] = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .limit(1);

  return event ?? null;
}

/**
 * Find an event by UUID within a session (for deduplication)
 */
export async function findEventByUuid(
  sessionId: string,
  uuid: string
): Promise<Event | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.chatSessionId, sessionId),
        eq(events.uuid, uuid)
      )
    )
    .limit(1);

  return event ?? null;
}

/**
 * Get the last event for a session
 */
export async function getLastEvent(
  sessionId: string,
  options?: { includeDeleted?: boolean }
): Promise<Event | null> {
  const conditions: SQL[] = [eq(events.chatSessionId, sessionId)];

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const [event] = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.id))
    .limit(1);

  return event ?? null;
}

/**
 * Get the last event ID for a session (for SSE Last-Event-ID)
 */
export async function getLastEventId(
  sessionId: string,
  options?: { includeDeleted?: boolean }
): Promise<number | null> {
  const event = await getLastEvent(sessionId, options);
  return event?.id ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List events with filtering and pagination
 */
export async function listEvents(
  options: EventFilterOptions & { pagination?: PaginationOptions }
): Promise<PaginatedResult<Event>> {
  const { pagination, ...filterOptions } = options;
  const { limit, offset } = getPaginationParams(pagination);

  const conditions = buildEventConditions(filterOptions);

  const data = await db
    .select()
    .from(events)
    .where(conditions)
    .orderBy(asc(events.id))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(conditions);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List events for a session (most common use case)
 */
export async function listSessionEvents(
  sessionId: string,
  options?: Omit<EventFilterOptions, 'sessionId'> & { pagination?: PaginationOptions }
): Promise<PaginatedResult<Event>> {
  return listEvents({ ...options, sessionId });
}

/**
 * Get events for SSE replay (ordered by ID, after lastEventId)
 */
export async function getEventsForReplay(
  sessionId: string,
  options?: EventReplayOptions
): Promise<Event[]> {
  const conditions: SQL[] = [eq(events.chatSessionId, sessionId)];

  if (options?.lastEventId !== undefined) {
    conditions.push(gt(events.id, options.lastEventId));
  }

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.id))
    .limit(options?.limit ?? 1000);
}

// =============================================================================
// COUNT QUERIES
// =============================================================================

/**
 * Count events for a session
 */
export async function countSessionEvents(
  sessionId: string,
  options?: Pick<EventFilterOptions, 'includeDeleted' | 'eventType'>
): Promise<number> {
  const conditions = buildEventConditions({
    sessionId,
    ...options,
  });

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(conditions);

  return result?.count ?? 0;
}

/**
 * Count events by type for a session (for analytics)
 */
export async function countEventsByType(
  sessionId: string,
  options?: Pick<EventFilterOptions, 'includeDeleted'>
): Promise<Record<string, number>> {
  const conditions: SQL[] = [eq(events.chatSessionId, sessionId)];

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const results = await db
    .select({
      eventType: sql<string>`${events.eventData}->>'type'`,
      count: sql<number>`count(*)::int`,
    })
    .from(events)
    .where(and(...conditions))
    .groupBy(sql`${events.eventData}->>'type'`);

  return Object.fromEntries(results.map(r => [r.eventType ?? 'unknown', r.count]));
}

// =============================================================================
// EXISTENCE CHECKS
// =============================================================================

/**
 * Check if an event with a given UUID exists in a session
 */
export async function eventUuidExists(
  sessionId: string,
  uuid: string
): Promise<boolean> {
  const event = await findEventByUuid(sessionId, uuid);
  return !!event;
}

/**
 * Check if a session has any events
 */
export async function sessionHasEvents(
  sessionId: string,
  options?: Pick<EventFilterOptions, 'includeDeleted'>
): Promise<boolean> {
  const count = await countSessionEvents(sessionId, options);
  return count > 0;
}

// =============================================================================
// SESSION VALIDATION
// =============================================================================

/**
 * Verify a session exists and optionally check ownership
 */
export async function verifySession(
  sessionId: string,
  options?: { userId?: string; includeDeleted?: boolean }
): Promise<{
  exists: boolean;
  owned: boolean;
  session: ChatSession | null;
}> {
  const conditions: SQL[] = [eq(chatSessions.id, sessionId)];

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(chatSessions.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .limit(1);

  if (!session) {
    return { exists: false, owned: false, session: null };
  }

  const owned = options?.userId ? session.userId === options.userId : true;

  return { exists: true, owned, session };
}

/**
 * Verify session exists and user owns it (common pattern)
 */
export async function verifyUserSession(
  sessionId: string,
  userId: string,
  options?: { includeDeleted?: boolean }
): Promise<{ valid: boolean; reason?: 'not_found' | 'not_owner'; session?: ChatSession }> {
  const result = await verifySession(sessionId, { userId, ...options });

  if (!result.exists) {
    return { valid: false, reason: 'not_found' };
  }

  if (!result.owned) {
    return { valid: false, reason: 'not_owner' };
  }

  return { valid: true, session: result.session! };
}

// =============================================================================
// BULK OPERATIONS HELPERS
// =============================================================================

/**
 * Get event IDs for a session (useful for bulk operations)
 */
export async function getSessionEventIds(
  sessionId: string,
  options?: Pick<EventFilterOptions, 'includeDeleted' | 'afterId'>
): Promise<number[]> {
  const conditions: SQL[] = [eq(events.chatSessionId, sessionId)];

  if (options?.afterId !== undefined) {
    conditions.push(gt(events.id, options.afterId));
  }

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const results = await db
    .select({ id: events.id })
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.id));

  return results.map(r => r.id);
}

/**
 * Get the timestamp range of events in a session
 */
export async function getSessionEventTimeRange(
  sessionId: string,
  options?: Pick<EventFilterOptions, 'includeDeleted'>
): Promise<{ first: Date | null; last: Date | null }> {
  const conditions: SQL[] = [eq(events.chatSessionId, sessionId)];

  if (!options?.includeDeleted) {
    const excludeDeletedCondition = excludeDeleted(events.deletedAt);
    if (excludeDeletedCondition) {
      conditions.push(excludeDeletedCondition);
    }
  }

  const [result] = await db
    .select({
      first: sql<Date | null>`MIN(${events.timestamp})`,
      last: sql<Date | null>`MAX(${events.timestamp})`,
    })
    .from(events)
    .where(and(...conditions));

  return {
    first: result?.first ?? null,
    last: result?.last ?? null,
  };
}
