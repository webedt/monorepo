import { AService } from '../services/abstracts/AService.js';
import type { ISessionEventBroadcaster } from './sessionEventBroadcaster.doc.js';
import type { BroadcastEvent } from './sessionEventBroadcaster.doc.js';
import type { SessionEvent } from './sessionEventBroadcaster.doc.js';

export type { BroadcastEvent, SessionEvent } from './sessionEventBroadcaster.doc.js';

export abstract class ASessionEventBroadcaster extends AService implements ISessionEventBroadcaster {
  abstract startSession(sessionId: string): void;

  abstract endSession(sessionId: string): void;

  abstract isSessionActive(sessionId: string): boolean;

  abstract subscribe(
    sessionId: string,
    subscriberId: string,
    callback: (event: SessionEvent) => void
  ): () => void;

  abstract broadcast(sessionId: string, eventType: string, data: unknown): void;

  abstract getActiveSessionCount(): number;

  abstract getSubscriberCount(sessionId: string): number;
}
