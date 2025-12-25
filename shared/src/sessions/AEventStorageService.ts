import { AService } from '../services/abstracts/AService.js';

export interface StoredEvent {
  chatSessionId: string;
  eventData: Record<string, unknown>;
  timestamp?: Date;
}

export interface StoreEventResult {
  stored: boolean;
  duplicate: boolean;
}

export abstract class AEventStorageService extends AService {
  readonly order = 0;

  abstract storeEvent(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    timestamp?: Date
  ): Promise<StoreEventResult>;

  abstract storeEventWithDedup(
    chatSessionId: string,
    eventData: Record<string, unknown>,
    storedUuids: Set<string>,
    timestamp?: Date
  ): Promise<StoreEventResult>;

  abstract batchStoreEvents(
    chatSessionId: string,
    events: Array<Record<string, unknown>>
  ): Promise<{ stored: number; duplicates: number }>;

  abstract getExistingEventUuids(chatSessionId: string): Promise<Set<string>>;

  abstract createInputPreviewEvent(
    content: string,
    maxPreviewLength?: number
  ): Record<string, unknown>;
}
