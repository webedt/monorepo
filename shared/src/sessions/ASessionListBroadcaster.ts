import { AService } from '../services/abstracts/AService.js';
import type { ISessionListBroadcasterDocumentation } from './sessionListBroadcaster.doc.js';
import type { SessionListEvent } from './sessionListBroadcaster.doc.js';
import type { SessionUpdateType } from './sessionListBroadcaster.doc.js';
import type { ChatSession } from '../db/schema.js';

export type { SessionUpdateType, SessionListEvent } from './sessionListBroadcaster.doc.js';

export abstract class ASessionListBroadcaster extends AService implements ISessionListBroadcasterDocumentation {
  abstract subscribe(
    userId: string,
    subscriberId: string,
    callback: (event: SessionListEvent) => void
  ): () => void;

  abstract broadcast(
    userId: string,
    type: SessionUpdateType,
    session: Partial<ChatSession> & { id: string }
  ): void;

  abstract notifySessionCreated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  abstract notifySessionUpdated(userId: string, session: Partial<ChatSession> & { id: string }): void;

  abstract notifyStatusChanged(userId: string, session: Partial<ChatSession> & { id: string }): void;

  abstract notifySessionDeleted(userId: string, sessionId: string): void;

  abstract getSubscriberCount(userId: string): number;

  abstract getTotalSubscriberCount(): number;

  abstract shutdown(): void;
}
