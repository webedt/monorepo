import { AService } from '../services/abstracts/AService.js';

import type { ShareTokenAccessLog } from '../db/schema.js';

export type ShareTokenAccessType = 'view' | 'events' | 'stream';
export type ShareTokenFailureReason = 'expired' | 'invalid' | 'rate_limited' | 'not_found';

export interface LogAccessParams {
  sessionId: string;
  shareToken: string;
  accessType: ShareTokenAccessType;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  failureReason?: ShareTokenFailureReason;
}

export interface AccessLogQueryParams {
  sessionId?: string;
  shareToken?: string;
  startDate?: Date;
  endDate?: Date;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export interface AccessLogStats {
  totalAccesses: number;
  successfulAccesses: number;
  failedAccesses: number;
  uniqueIps: number;
  accessesByType: Record<ShareTokenAccessType, number>;
  failuresByReason: Record<ShareTokenFailureReason, number>;
}

export abstract class AShareTokenAccessLogService extends AService {
  readonly order = 0;

  abstract logAccess(
    params: LogAccessParams
  ): Promise<ShareTokenAccessLog>;

  abstract getAccessLogs(
    params: AccessLogQueryParams
  ): Promise<{ logs: ShareTokenAccessLog[]; total: number }>;

  abstract getAccessStats(
    sessionId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AccessLogStats>;

  abstract cleanupOldLogs(
    olderThanDays: number
  ): Promise<number>;
}
