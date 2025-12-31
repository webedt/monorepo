/**
 * Audit Service - Immutable audit trail for admin operations
 *
 * Provides write-only interface for security-sensitive operations.
 * Logs are immutable once written and cannot be modified or deleted.
 */

import { randomUUID } from 'crypto';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { db, adminAuditLogs, users, eq, desc, and, gte, lte, inArray, sql } from '../db/index.js';

import type { AdminAuditLog, NewAdminAuditLog, AuditAction, AuditEntityType } from '../db/schema.js';
import type * as schema from '../db/schema.js';

import { logger } from '../utils/index.js';

export interface AuditLogParams {
  adminId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  metadata?: {
    reason?: string;
    affectedCount?: number;
    requestId?: string;
    userAgent?: string;
    [key: string]: unknown;
  };
  ipAddress?: string;
}

export interface AuditLogListParams {
  adminId?: string;
  action?: AuditAction | AuditAction[];
  entityType?: AuditEntityType;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogWithAdmin extends AdminAuditLog {
  admin?: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

export interface AuditLogListResult {
  logs: AuditLogWithAdmin[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Create an immutable audit log entry.
 * This is a write-only operation - logs cannot be modified or deleted.
 */
export async function createAuditLog(
  params: AuditLogParams,
  database: NodePgDatabase<typeof schema> = db
): Promise<AdminAuditLog> {
  const id = randomUUID();

  const logEntry: NewAdminAuditLog = {
    id,
    adminId: params.adminId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    previousState: params.previousState ?? null,
    newState: params.newState ?? null,
    metadata: params.metadata ?? null,
    ipAddress: params.ipAddress ?? null,
  };

  const [created] = await database
    .insert(adminAuditLogs)
    .values(logEntry)
    .returning();

  logger.info(`Audit log created: ${params.action} on ${params.entityType}`, {
    component: 'AuditService',
    auditLogId: id,
    adminId: params.adminId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
  });

  return created;
}

/**
 * List audit logs with filtering and pagination.
 * Returns logs with admin user information joined.
 */
export async function listAuditLogs(
  params: AuditLogListParams = {},
  database: NodePgDatabase<typeof schema> = db
): Promise<AuditLogListResult> {
  const {
    adminId,
    action,
    entityType,
    entityId,
    startDate,
    endDate,
    limit = 50,
    offset = 0,
  } = params;

  // Build conditions array
  const conditions: ReturnType<typeof eq>[] = [];

  if (adminId) {
    conditions.push(eq(adminAuditLogs.adminId, adminId));
  }

  if (action) {
    if (Array.isArray(action)) {
      conditions.push(inArray(adminAuditLogs.action, action));
    } else {
      conditions.push(eq(adminAuditLogs.action, action));
    }
  }

  if (entityType) {
    conditions.push(eq(adminAuditLogs.entityType, entityType));
  }

  if (entityId) {
    conditions.push(eq(adminAuditLogs.entityId, entityId));
  }

  if (startDate) {
    conditions.push(gte(adminAuditLogs.createdAt, startDate));
  }

  if (endDate) {
    conditions.push(lte(adminAuditLogs.createdAt, endDate));
  }

  // Query with joins
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await database
    .select({
      log: adminAuditLogs,
      admin: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      },
    })
    .from(adminAuditLogs)
    .leftJoin(users, eq(adminAuditLogs.adminId, users.id))
    .where(whereClause)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [countResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(adminAuditLogs)
    .where(whereClause);

  const total = Number(countResult?.count ?? 0);

  // Transform results
  const logs: AuditLogWithAdmin[] = items.map((item) => ({
    ...item.log,
    admin: item.admin
      ? {
          id: item.admin.id,
          email: item.admin.email,
          displayName: item.admin.displayName,
        }
      : undefined,
  }));

  return {
    logs,
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}

/**
 * Get a single audit log by ID with admin information.
 */
export async function getAuditLog(
  id: string,
  database: NodePgDatabase<typeof schema> = db
): Promise<AuditLogWithAdmin | null> {
  const [item] = await database
    .select({
      log: adminAuditLogs,
      admin: {
        id: users.id,
        email: users.email,
        displayName: users.displayName,
      },
    })
    .from(adminAuditLogs)
    .leftJoin(users, eq(adminAuditLogs.adminId, users.id))
    .where(eq(adminAuditLogs.id, id))
    .limit(1);

  if (!item) {
    return null;
  }

  return {
    ...item.log,
    admin: item.admin
      ? {
          id: item.admin.id,
          email: item.admin.email,
          displayName: item.admin.displayName,
        }
      : undefined,
  };
}

/**
 * Get audit logs for a specific entity.
 * Useful for viewing the complete history of changes to an entity.
 */
export async function getEntityAuditHistory(
  entityType: AuditEntityType,
  entityId: string,
  database: NodePgDatabase<typeof schema> = db
): Promise<AuditLogWithAdmin[]> {
  const result = await listAuditLogs(
    {
      entityType,
      entityId,
      limit: 100,
    },
    database
  );

  return result.logs;
}

/**
 * Get recent audit activity for an admin user.
 * Useful for reviewing admin's recent actions.
 */
export async function getAdminAuditActivity(
  adminId: string,
  limit = 50,
  database: NodePgDatabase<typeof schema> = db
): Promise<AuditLogWithAdmin[]> {
  const result = await listAuditLogs(
    {
      adminId,
      limit,
    },
    database
  );

  return result.logs;
}

/**
 * Get audit statistics for dashboard.
 */
export async function getAuditStats(
  database: NodePgDatabase<typeof schema> = db
): Promise<{
  totalLogs: number;
  logsByAction: Record<string, number>;
  logsByEntityType: Record<string, number>;
  recentActivityCount: number;
}> {
  // Get total count
  const [totalResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(adminAuditLogs);

  // Get counts by action
  const actionCounts = await database
    .select({
      action: adminAuditLogs.action,
      count: sql<number>`count(*)`,
    })
    .from(adminAuditLogs)
    .groupBy(adminAuditLogs.action);

  // Get counts by entity type
  const entityTypeCounts = await database
    .select({
      entityType: adminAuditLogs.entityType,
      count: sql<number>`count(*)`,
    })
    .from(adminAuditLogs)
    .groupBy(adminAuditLogs.entityType);

  // Get recent activity (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentResult] = await database
    .select({ count: sql<number>`count(*)` })
    .from(adminAuditLogs)
    .where(gte(adminAuditLogs.createdAt, oneDayAgo));

  // Transform to records
  const logsByAction: Record<string, number> = {};
  for (const row of actionCounts) {
    logsByAction[row.action] = Number(row.count);
  }

  const logsByEntityType: Record<string, number> = {};
  for (const row of entityTypeCounts) {
    logsByEntityType[row.entityType] = Number(row.count);
  }

  return {
    totalLogs: Number(totalResult?.count ?? 0),
    logsByAction,
    logsByEntityType,
    recentActivityCount: Number(recentResult?.count ?? 0),
  };
}

/**
 * Helper to extract IP address from Express request.
 * Handles common proxy headers.
 */
export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string | undefined {
  // Check for forwarded headers (common with proxies/load balancers)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip?.trim();
  }

  // Check for real IP header (Nginx)
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }

  // Fall back to request IP
  return req.ip || req.socket?.remoteAddress;
}
