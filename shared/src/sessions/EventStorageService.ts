import { db, events, eq } from '../db/index.js';
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
      await db.insert(events).values({
        chatSessionId,
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
    const eventUuid = eventData.uuid as string | undefined;

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
    const existingEvents = await db
      .select({ eventData: events.eventData })
      .from(events)
      .where(eq(events.chatSessionId, chatSessionId));

    const uuids = new Set<string>();
    for (const e of existingEvents) {
      const uuid = (e.eventData as Record<string, unknown>)?.uuid as string | undefined;
      if (uuid) uuids.add(uuid);
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
