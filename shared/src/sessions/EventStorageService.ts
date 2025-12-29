import { db, events, eq } from '../db/index.js';
import { extractEventUuid } from '../utils/helpers/eventHelper.js';
import { logger } from '../utils/logging/logger.js';

import { AEventStorageService } from './AEventStorageService.js';

import type { StoreEventResult } from './AEventStorageService.js';

export class EventStorageService extends AEventStorageService {
  async storeEvent(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    timestamp?: Date
  ): Promise<StoreEventResult> {
    try {
      const uuid = extractEventUuid(eventData);
      await db.insert(events).values({
        chatSessionId,
        uuid,
        eventData,
        timestamp: timestamp || new Date(),
      });
      return { stored: true, duplicate: false };
    } catch (error) {
      logger.warn('Failed to store event', {
        component: 'EventStorageService',
        error,
        chatSessionId,
        eventType: eventData.type,
      });
      return { stored: false, duplicate: false };
    }
  }

  async storeEventWithDedup(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    storedUuids: Set<string>,
    timestamp?: Date
  ): Promise<StoreEventResult> {
    const eventUuid = extractEventUuid(eventData);

    if (eventUuid && storedUuids.has(eventUuid)) {
      logger.debug('Skipping duplicate event', {
        component: 'EventStorageService',
        chatSessionId,
        eventUuid,
        eventType: eventData.type,
      });
      return { stored: false, duplicate: true };
    }

    const result = await this.storeEvent(chatSessionId, eventData, timestamp);

    if (result.stored && eventUuid) {
      storedUuids.add(eventUuid);
    }

    return result;
  }

  async batchStoreEvents(
    chatSessionId: string,
    eventDataList: Array<Record<string, unknown>>
  ): Promise<{ stored: number; duplicates: number }> {
    const existingUuids = await this.getExistingEventUuids(chatSessionId);
    let stored = 0;
    let duplicates = 0;

    for (const eventData of eventDataList) {
      const result = await this.storeEventWithDedup(
        chatSessionId,
        eventData,
        existingUuids,
        eventData.timestamp ? new Date(eventData.timestamp as string) : undefined
      );
      if (result.stored) stored++;
      if (result.duplicate) duplicates++;
    }

    return { stored, duplicates };
  }

  async getExistingEventUuids(chatSessionId: string): Promise<Set<string>> {
    // Query the indexed uuid column directly for efficient deduplication
    const existingEvents = await db
      .select({ uuid: events.uuid })
      .from(events)
      .where(eq(events.chatSessionId, chatSessionId));

    const uuids = new Set<string>();
    for (const e of existingEvents) {
      if (e.uuid) uuids.add(e.uuid);
    }
    return uuids;
  }

  createInputPreviewEvent(
    content: string,
    maxPreviewLength: number = 200
  ): Record<string, unknown> {
    return {
      type: 'input_preview',
      message: `Request received: ${content.length > maxPreviewLength ? content.substring(0, maxPreviewLength) + '...' : content}`,
      source: 'user',
      timestamp: new Date().toISOString(),
      data: {
        preview: content,
        truncated: content.length > maxPreviewLength,
        originalLength: content.length,
      },
    };
  }
}

export const eventStorageService = new EventStorageService();
