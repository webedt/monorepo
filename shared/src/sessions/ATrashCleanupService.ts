import { AService } from '../services/abstracts/AService.js';

export interface TrashCleanupResult {
  sessionsDeleted: number;
  eventsDeleted: number;
  messagesDeleted: number;
  errors: string[];
}

export interface TrashCleanupSession {
  id: string;
  userId: string;
  deletedAt: Date;
  remoteSessionId?: string | null;
}

export abstract class ATrashCleanupService extends AService {
  readonly order = 20;

  abstract cleanupExpiredTrash(
    retentionDays: number
  ): Promise<TrashCleanupResult>;

  abstract getExpiredTrashSessions(
    retentionDays: number
  ): Promise<TrashCleanupSession[]>;

  abstract deleteSessionPermanently(
    sessionId: string
  ): Promise<{ success: boolean; message: string }>;

  abstract startScheduledCleanup(): void;

  abstract stopScheduledCleanup(): void;
}
