import { AService } from '../services/abstracts/AService.js';

export interface SoftDeleteResult {
  sessionId: string;
  success: boolean;
  messagesDeleted: number;
  eventsDeleted: number;
  error?: string;
}

export interface RestoreResult {
  sessionId: string;
  success: boolean;
  messagesRestored: number;
  eventsRestored: number;
  error?: string;
}

export interface BulkSoftDeleteResult {
  successCount: number;
  failureCount: number;
  results: SoftDeleteResult[];
}

export interface BulkRestoreResult {
  successCount: number;
  failureCount: number;
  results: RestoreResult[];
}

export abstract class ASessionSoftDeleteService extends AService {
  readonly order = 15;

  abstract softDeleteSession(
    sessionId: string
  ): Promise<SoftDeleteResult>;

  abstract softDeleteSessions(
    sessionIds: string[]
  ): Promise<BulkSoftDeleteResult>;

  abstract restoreSession(
    sessionId: string
  ): Promise<RestoreResult>;

  abstract restoreSessions(
    sessionIds: string[]
  ): Promise<BulkRestoreResult>;
}
