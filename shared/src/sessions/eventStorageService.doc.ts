/**
 * Event Storage Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Event Storage Service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see AEventStorageService for the abstract base class
 * @see EventStorageService for the concrete implementation
 */

import type { StoredEvent } from './AEventStorageService.js';
import type { StoreEventResult } from './AEventStorageService.js';

export type { StoredEvent } from './AEventStorageService.js';
export type { StoreEventResult } from './AEventStorageService.js';

/**
 * Interface for Event Storage Service with full documentation.
 *
 * Provides methods for storing and retrieving session events in the database.
 * Events are the core data structure for tracking session activity, including
 * user messages, assistant responses, tool calls, and execution results.
 *
 * ## Features
 *
 * - Store individual events with optional timestamp
 * - Deduplicate events by UUID to prevent duplicate storage
 * - Batch store multiple events efficiently
 * - Retrieve existing event UUIDs for deduplication
 * - Create preview events for user input display
 *
 * ## Event Deduplication
 *
 * Events from remote sessions include a `uuid` field. The service uses this
 * to prevent storing the same event multiple times, which is important when:
 * - Replaying events during session resume
 * - Handling WebSocket reconnections
 * - Processing retried requests
 *
 * ## Usage
 *
 * ```typescript
 * const storage = serviceProvider.get(AEventStorageService);
 *
 * // Store a single event
 * const result = await storage.storeEvent(chatSessionId, {
 *   type: 'assistant',
 *   uuid: 'event-uuid',
 *   content: 'Hello!',
 * });
 *
 * // Store with deduplication tracking
 * const storedUuids = await storage.getExistingEventUuids(chatSessionId);
 * const deduped = await storage.storeEventWithDedup(
 *   chatSessionId,
 *   eventData,
 *   storedUuids
 * );
 * ```
 */
export interface IEventStorageServiceDocumentation {
  /**
   * Store a single event for a chat session.
   *
   * Persists an event to the database with the current timestamp (or provided timestamp).
   * Does not perform deduplication - use `storeEventWithDedup` if events may be duplicates.
   *
   * @param chatSessionId - The chat session ID to associate the event with
   * @param eventData - The event data object to store (must include `type` field)
   * @param timestamp - Optional timestamp for the event (defaults to current time)
   * @returns Result indicating if the event was stored and if it was a duplicate
   *
   * @example
   * ```typescript
   * const result = await storage.storeEvent(
   *   'session-123',
   *   {
   *     type: 'assistant',
   *     uuid: 'evt-abc',
   *     message: { content: 'I will help you with that.' },
   *   },
   *   new Date()
   * );
   *
   * if (result.stored) {
   *   console.log('Event stored successfully');
   * }
   * ```
   */
  storeEvent(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    timestamp?: Date
  ): Promise<StoreEventResult>;

  /**
   * Store an event with deduplication.
   *
   * Checks if the event's UUID already exists in the provided set before storing.
   * If the event is new, it's stored and the UUID is added to the set.
   *
   * Use this method when processing events that may be received multiple times,
   * such as during session replay or WebSocket reconnection.
   *
   * @param chatSessionId - The chat session ID to associate the event with
   * @param eventData - The event data object (should include `uuid` for deduplication)
   * @param storedUuids - Set of already-stored event UUIDs (mutated to add new UUID)
   * @param timestamp - Optional timestamp for the event (defaults to current time)
   * @returns Result with `stored: true` if new, `duplicate: true` if already exists
   *
   * @example
   * ```typescript
   * // Get existing UUIDs first
   * const storedUuids = await storage.getExistingEventUuids(chatSessionId);
   *
   * // Process stream of events
   * for (const event of incomingEvents) {
   *   const result = await storage.storeEventWithDedup(
   *     chatSessionId,
   *     event,
   *     storedUuids
   *   );
   *
   *   if (result.duplicate) {
   *     console.log(`Skipped duplicate: ${event.uuid}`);
   *   }
   * }
   * ```
   */
  storeEventWithDedup(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    storedUuids: Set<string>,
    timestamp?: Date
  ): Promise<StoreEventResult>;

  /**
   * Store multiple events in a batch.
   *
   * Efficiently stores multiple events in a single database transaction.
   * Automatically handles deduplication based on event UUIDs.
   *
   * Use this for bulk event storage, such as when syncing events from a
   * remote session or importing event history.
   *
   * @param chatSessionId - The chat session ID to associate events with
   * @param events - Array of event data objects to store
   * @returns Object with count of `stored` events and `duplicates` skipped
   *
   * @example
   * ```typescript
   * const events = await remoteClient.getEvents(sessionId);
   *
   * const result = await storage.batchStoreEvents(
   *   chatSessionId,
   *   events.data
   * );
   *
   * console.log(`Stored ${result.stored} events, skipped ${result.duplicates} duplicates`);
   * ```
   */
  batchStoreEvents(
    chatSessionId: string,
    events: Array<Record<string, unknown>>
  ): Promise<{ stored: number; duplicates: number }>;

  /**
   * Get all existing event UUIDs for a session.
   *
   * Returns a Set of UUIDs for events already stored for this session.
   * Use this before processing incoming events to enable deduplication.
   *
   * @param chatSessionId - The chat session ID to get UUIDs for
   * @returns Set of event UUIDs already in the database
   *
   * @example
   * ```typescript
   * // Before starting event stream processing
   * const existingUuids = await storage.getExistingEventUuids(chatSessionId);
   * console.log(`Found ${existingUuids.size} existing events`);
   *
   * // Use with storeEventWithDedup
   * onEvent((event) => {
   *   storage.storeEventWithDedup(chatSessionId, event, existingUuids);
   * });
   * ```
   */
  getExistingEventUuids(chatSessionId: string): Promise<Set<string>>;

  /**
   * Create an input preview event.
   *
   * Generates a synthetic event representing a preview of user input.
   * This is used to show the user's message in the event stream before
   * the full request is processed.
   *
   * @param content - The user's input content
   * @param maxPreviewLength - Maximum length for preview text (default: 100)
   * @returns Event data object with `type: 'input_preview'`
   *
   * @example
   * ```typescript
   * const userInput = 'Add a new feature to handle user authentication...';
   *
   * const previewEvent = storage.createInputPreviewEvent(userInput, 50);
   * // Returns:
   * // {
   * //   type: 'input_preview',
   * //   data: {
   * //     preview: 'Add a new feature to handle user authentica...',
   * //     originalLength: 55,
   * //     truncated: true
   * //   }
   * // }
   *
   * await storage.storeEvent(chatSessionId, previewEvent);
   * ```
   */
  createInputPreviewEvent(
    content: string,
    maxPreviewLength?: number
  ): Record<string, unknown>;
}
