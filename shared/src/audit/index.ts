/**
 * Audit Module
 *
 * Provides immutable audit trail for admin operations.
 * Used to track security-sensitive actions for compliance and accountability.
 */

export {
  createAuditLog,
  listAuditLogs,
  getAuditLog,
  getEntityAuditHistory,
  getAdminAuditActivity,
  getAuditStats,
  getClientIp,
} from './auditService.js';

export type {
  AuditLogParams,
  AuditLogListParams,
  AuditLogWithAdmin,
  AuditLogListResult,
} from './auditService.js';
