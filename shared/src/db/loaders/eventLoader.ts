/**
 * Event Entity Loader
 *
 * Provides batch loading capabilities for session events and summaries,
 * preventing N+1 query problems when fetching event data across sessions.
 */

import { inArray, eq, sql, desc, asc } from 'drizzle-orm';
import { db, events } from '../index.js';
import { DataLoader } from '../dataLoader.js';

import type { Event } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * Event summary for a session
 */
export interface EventSummary {
  sessionId: string;
  totalEvents: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
}

/**
 * Event type count
 */
export interface EventTypeCount {
  type: string;
  count: number;
}

/**
 * Create a DataLoader for batch loading event summaries by session ID
 * Returns aggregated event information for each session
 *
 * @example
 * const eventSummaryLoader = createEventSummaryLoader();
 * const [summary1, summary2] = await Promise.all([
 *   eventSummaryLoader.load('session-1'),
 *   eventSummaryLoader.load('session-2'),
 * ]);
 */
export function createEventSummaryLoader(options?: DataLoaderOptions): DataLoader<string, EventSummary> {
  return new DataLoader<string, EventSummary>(
    async (sessionIds: string[]) => {
      // Get event counts and timestamps per session
      const summaries = await db
        .select({
          sessionId: events.chatSessionId,
          totalEvents: sql<number>`COUNT(*)::int`,
          firstEventAt: sql<Date | null>`MIN(${events.timestamp})`,
          lastEventAt: sql<Date | null>`MAX(${events.timestamp})`,
        })
        .from(events)
        .where(inArray(events.chatSessionId, sessionIds))
        .groupBy(events.chatSessionId);

      // Build result map
      const summaryMap = new Map(summaries.map(s => [s.sessionId, s]));

      const map = new Map<string, EventSummary>();
      for (const sessionId of sessionIds) {
        const summary = summaryMap.get(sessionId);

        map.set(sessionId, {
          sessionId,
          totalEvents: summary?.totalEvents ?? 0,
          firstEventAt: summary?.firstEventAt ?? null,
          lastEventAt: summary?.lastEventAt ?? null,
        });
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading event counts by session ID
 */
export function createEventCountLoader(options?: DataLoaderOptions): DataLoader<string, number> {
  return new DataLoader<string, number>(
    async (sessionIds: string[]) => {
      const counts = await db
        .select({
          sessionId: events.chatSessionId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(events)
        .where(inArray(events.chatSessionId, sessionIds))
        .groupBy(events.chatSessionId);

      const countMap = new Map(counts.map(c => [c.sessionId, c.count]));

      const map = new Map<string, number>();
      for (const sessionId of sessionIds) {
        map.set(sessionId, countMap.get(sessionId) ?? 0);
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading latest events per session
 * Returns the most recent N events for each session
 *
 * @param limit Maximum number of events per session (default: 10)
 */
export function createLatestEventsLoader(
  limit: number = 10,
  options?: DataLoaderOptions
): DataLoader<string, Event[]> {
  return new DataLoader<string, Event[]>(
    async (sessionIds: string[]) => {
      // Use a window function to get top N events per session
      const latestEvents = await db
        .select({
          id: events.id,
          chatSessionId: events.chatSessionId,
          uuid: events.uuid,
          eventData: events.eventData,
          timestamp: events.timestamp,
          deletedAt: events.deletedAt,
          rowNum: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${events.chatSessionId} ORDER BY ${events.timestamp} DESC)`,
        })
        .from(events)
        .where(inArray(events.chatSessionId, sessionIds));

      // Filter to only include events within the limit
      const filteredEvents = latestEvents.filter(e => e.rowNum <= limit);

      // Group by sessionId
      const map = new Map<string, Event[]>();
      for (const sessionId of sessionIds) {
        map.set(sessionId, []);
      }
      for (const event of filteredEvents) {
        const list = map.get(event.chatSessionId);
        if (list) {
          list.push({
            id: event.id,
            chatSessionId: event.chatSessionId,
            uuid: event.uuid,
            eventData: event.eventData,
            timestamp: event.timestamp,
            deletedAt: event.deletedAt,
          });
        }
      }

      // Sort each list by timestamp desc
      for (const list of map.values()) {
        list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      }

      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading events by type per session
 * Returns events matching a JSON eventData.type field for each session
 * Note: Events store their type in the eventData JSON field
 *
 * @param eventType The type of events to load (matched against eventData->>'type')
 */
export function createEventsByTypeLoader(
  eventType: string,
  options?: DataLoaderOptions
): DataLoader<string, Event[]> {
  return new DataLoader<string, Event[]>(
    async (sessionIds: string[]) => {
      // Query events where eventData->>'type' matches the requested type
      const results = await db
        .select()
        .from(events)
        .where(
          sql`${events.chatSessionId} = ANY(${sessionIds})
              AND ${events.eventData}->>'type' = ${eventType}`
        )
        .orderBy(asc(events.timestamp));

      // Group by sessionId
      const map = new Map<string, Event[]>();
      for (const sessionId of sessionIds) {
        map.set(sessionId, []);
      }
      for (const event of results) {
        const list = map.get(event.chatSessionId);
        if (list) {
          list.push(event);
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading tool use events per session
 * Convenience method for getting tool_use type events
 */
export function createToolUseEventsLoader(options?: DataLoaderOptions): DataLoader<string, Event[]> {
  return createEventsByTypeLoader('tool_use', options);
}

/**
 * Create a DataLoader for batch loading error events per session
 * Convenience method for getting error type events
 */
export function createErrorEventsLoader(options?: DataLoaderOptions): DataLoader<string, Event[]> {
  return createEventsByTypeLoader('error', options);
}

/**
 * Create a DataLoader for batch loading assistant message events per session
 * Convenience method for getting assistant type events
 */
export function createAssistantEventsLoader(options?: DataLoaderOptions): DataLoader<string, Event[]> {
  return createEventsByTypeLoader('assistant', options);
}
