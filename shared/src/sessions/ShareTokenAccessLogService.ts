import { randomUUID } from 'crypto';
import { eq, and, gte, lte, sql, desc, count } from 'drizzle-orm';
import { db, shareTokenAccessLog } from '../db/index.js';
import { hashIpAddress } from '../utils/validators/index.js';
import { logger } from '../utils/logging/index.js';
import { AShareTokenAccessLogService } from './AShareTokenAccessLogService.js';

import type { ShareTokenAccessLog } from '../db/schema.js';
import type {
  LogAccessParams,
  AccessLogQueryParams,
  AccessLogStats,
  ShareTokenAccessType,
  ShareTokenFailureReason,
} from './AShareTokenAccessLogService.js';

export class ShareTokenAccessLogService extends AShareTokenAccessLogService {
  async logAccess(params: LogAccessParams): Promise<ShareTokenAccessLog> {
    const {
      sessionId,
      shareToken,
      accessType,
      ipAddress,
      userAgent,
      success,
      failureReason,
    } = params;

    // Hash IP address for privacy
    const hashedIp = ipAddress ? hashIpAddress(ipAddress) : null;

    // Truncate user agent to reasonable length
    const truncatedUserAgent = userAgent?.substring(0, 500) ?? null;

    try {
      const [logEntry] = await db
        .insert(shareTokenAccessLog)
        .values({
          id: randomUUID(),
          sessionId,
          shareToken,
          accessType,
          ipAddress: hashedIp,
          userAgent: truncatedUserAgent,
          success,
          failureReason: failureReason ?? null,
        })
        .returning();

      logger.debug('Share token access logged', {
        component: 'ShareTokenAccessLog',
        sessionId,
        accessType,
        success,
        failureReason,
      });

      return logEntry;
    } catch (error) {
      // Log error but don't throw - access logging should not block requests
      logger.error('Failed to log share token access', error as Error, {
        component: 'ShareTokenAccessLog',
        sessionId,
        accessType,
      });

      // Return a synthetic log entry so callers don't fail
      return {
        id: randomUUID(),
        sessionId,
        shareToken,
        accessType,
        ipAddress: hashedIp,
        userAgent: truncatedUserAgent,
        country: null,
        success,
        failureReason: failureReason ?? null,
        createdAt: new Date(),
      };
    }
  }

  async getAccessLogs(
    params: AccessLogQueryParams
  ): Promise<{ logs: ShareTokenAccessLog[]; total: number }> {
    const {
      sessionId,
      shareToken,
      startDate,
      endDate,
      success,
      limit = 50,
      offset = 0,
    } = params;

    // Build where conditions
    const conditions = [];
    if (sessionId) {
      conditions.push(eq(shareTokenAccessLog.sessionId, sessionId));
    }
    if (shareToken) {
      conditions.push(eq(shareTokenAccessLog.shareToken, shareToken));
    }
    if (startDate) {
      conditions.push(gte(shareTokenAccessLog.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(shareTokenAccessLog.createdAt, endDate));
    }
    if (success !== undefined) {
      conditions.push(eq(shareTokenAccessLog.success, success));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const [{ value: total }] = await db
      .select({ value: count() })
      .from(shareTokenAccessLog)
      .where(whereClause);

    // Get paginated logs
    const logs = await db
      .select()
      .from(shareTokenAccessLog)
      .where(whereClause)
      .orderBy(desc(shareTokenAccessLog.createdAt))
      .limit(limit)
      .offset(offset);

    return { logs, total };
  }

  async getAccessStats(
    sessionId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<AccessLogStats> {
    const conditions = [eq(shareTokenAccessLog.sessionId, sessionId)];
    if (startDate) {
      conditions.push(gte(shareTokenAccessLog.createdAt, startDate));
    }
    if (endDate) {
      conditions.push(lte(shareTokenAccessLog.createdAt, endDate));
    }

    const whereClause = and(...conditions);

    // Use SQL aggregations for efficiency instead of loading all logs into memory
    // Get basic counts
    const [basicStats] = await db
      .select({
        totalAccesses: count(),
        successfulAccesses: sql<number>`cast(sum(case when ${shareTokenAccessLog.success} = true then 1 else 0 end) as int)`,
        failedAccesses: sql<number>`cast(sum(case when ${shareTokenAccessLog.success} = false then 1 else 0 end) as int)`,
        uniqueIps: sql<number>`cast(count(distinct ${shareTokenAccessLog.ipAddress}) as int)`,
      })
      .from(shareTokenAccessLog)
      .where(whereClause);

    // Get counts by access type
    const accessTypeCounts = await db
      .select({
        accessType: shareTokenAccessLog.accessType,
        count: count(),
      })
      .from(shareTokenAccessLog)
      .where(whereClause)
      .groupBy(shareTokenAccessLog.accessType);

    // Get counts by failure reason (only for failed accesses)
    const failedConditions = [...conditions, eq(shareTokenAccessLog.success, false)];
    const failureReasonCounts = await db
      .select({
        failureReason: shareTokenAccessLog.failureReason,
        count: count(),
      })
      .from(shareTokenAccessLog)
      .where(and(...failedConditions))
      .groupBy(shareTokenAccessLog.failureReason);

    // Build result object
    const stats: AccessLogStats = {
      totalAccesses: basicStats.totalAccesses ?? 0,
      successfulAccesses: basicStats.successfulAccesses ?? 0,
      failedAccesses: basicStats.failedAccesses ?? 0,
      uniqueIps: basicStats.uniqueIps ?? 0,
      accessesByType: {
        view: 0,
        events: 0,
        stream: 0,
      },
      failuresByReason: {
        expired: 0,
        invalid: 0,
        rate_limited: 0,
        not_found: 0,
      },
    };

    // Populate access type counts
    for (const row of accessTypeCounts) {
      const accessType = row.accessType as ShareTokenAccessType;
      if (accessType in stats.accessesByType) {
        stats.accessesByType[accessType] = row.count;
      }
    }

    // Populate failure reason counts
    for (const row of failureReasonCounts) {
      if (row.failureReason) {
        const reason = row.failureReason as ShareTokenFailureReason;
        if (reason in stats.failuresByReason) {
          stats.failuresByReason[reason] = row.count;
        }
      }
    }

    return stats;
  }

  async cleanupOldLogs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    try {
      const result = await db
        .delete(shareTokenAccessLog)
        .where(lte(shareTokenAccessLog.createdAt, cutoffDate));

      const deletedCount = (result as { rowCount?: number }).rowCount ?? 0;

      logger.info('Cleaned up old share token access logs', {
        component: 'ShareTokenAccessLog',
        olderThanDays,
        deletedCount,
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old access logs', error as Error, {
        component: 'ShareTokenAccessLog',
        olderThanDays,
      });
      return 0;
    }
  }
}

export const shareTokenAccessLogService = new ShareTokenAccessLogService();
