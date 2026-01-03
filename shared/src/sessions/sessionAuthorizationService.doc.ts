/**
 * Session Authorization Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Session Authorization Service.
 * The service handles access control, ownership verification, and permission checks
 * for chat sessions.
 *
 * @see ASessionAuthorizationService for the abstract base class
 * @see SessionAuthorizationService for the implementation
 */

import type { ChatSession } from '../db/schema.js';
import type { OrganizationRole } from '../db/schema.js';

/**
 * Result of an authorization check
 */
export interface AuthorizationResult {
  /** Whether the action is authorized */
  authorized: boolean;
  /** Error message if not authorized */
  error?: string;
  /** HTTP status code for the error */
  statusCode?: number;
  /** User's role relative to the session */
  role?: OrganizationRole | 'owner' | 'shared';
}

/**
 * Result of a validation check
 */
export interface ValidationResult {
  /** Whether the validation passed */
  valid: boolean;
  /** List of missing required fields */
  missingFields?: string[];
  /** Error message */
  error?: string;
}

/**
 * Conditions for session cleanup operations
 */
export interface CleanupConditions {
  /** Whether the session's branch can be deleted */
  canDeleteBranch: boolean;
  /** Whether the remote session can be archived */
  canArchiveRemote: boolean;
  /** Git branch information for deletion */
  branchInfo?: {
    owner: string;
    repo: string;
    branch: string;
  };
  /** Remote session ID for archiving */
  remoteSessionId?: string;
}

/**
 * Interface for Session Authorization Service with full documentation.
 *
 * The Session Authorization Service provides centralized access control for
 * chat sessions. It verifies ownership, checks permissions, and determines
 * what actions users can perform on sessions.
 *
 * ## Features
 *
 * - **Ownership Verification**: Check if user owns a session
 * - **Permission Checks**: Verify modify, delete, resume permissions
 * - **Organization Access**: Support for shared organization sessions
 * - **Share Token Validation**: Verify public share links
 * - **Cleanup Authorization**: Determine branch/archive cleanup eligibility
 *
 * ## Access Levels
 *
 * | Role | View | Modify | Delete | Resume |
 * |------|------|--------|--------|--------|
 * | owner | Yes | Yes | Yes | Yes |
 * | admin | Yes | Yes | Yes | Yes |
 * | member | Yes | No | No | No |
 * | shared | Yes | No | No | No |
 *
 * ## Usage
 *
 * ```typescript
 * const authService = getSessionAuthorizationService();
 *
 * // Check if user can delete session
 * const result = await authService.canDeleteSessionAsync(session, userId);
 * if (!result.authorized) {
 *   return res.status(result.statusCode).json({ error: result.error });
 * }
 *
 * // Proceed with deletion
 * await deleteSession(session.id);
 * ```
 */
export interface ISessionAuthorizationServiceDocumentation {
  /**
   * Verify user owns a session.
   *
   * Synchronous ownership check for simple authorization scenarios.
   *
   * @param session - The session to check (null if not found)
   * @param userId - The user ID to verify
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = authService.verifyOwnership(session, userId);
   *
   * if (!result.authorized) {
   *   if (result.statusCode === 404) {
   *     return res.status(404).json({ error: 'Session not found' });
   *   }
   *   return res.status(403).json({ error: result.error });
   * }
   * ```
   */
  verifyOwnership(
    session: ChatSession | null,
    userId: string
  ): AuthorizationResult;

  /**
   * Validate that required fields are present.
   *
   * @param fields - Object containing fields to validate
   * @param requiredFields - Array of required field names
   * @returns Validation result
   *
   * @example
   * ```typescript
   * const validation = authService.validateRequiredFields(
   *   { prompt: body.prompt, sessionId: body.sessionId },
   *   ['prompt', 'sessionId']
   * );
   *
   * if (!validation.valid) {
   *   return res.status(400).json({
   *     error: validation.error,
   *     missingFields: validation.missingFields,
   *   });
   * }
   * ```
   */
  validateRequiredFields(
    fields: Record<string, unknown>,
    requiredFields: string[]
  ): ValidationResult;

  /**
   * Get cleanup conditions for a session.
   *
   * Determines what cleanup actions can be performed when deleting
   * or archiving a session.
   *
   * @param session - The session to check
   * @returns Cleanup conditions
   *
   * @example
   * ```typescript
   * const conditions = authService.getCleanupConditions(session);
   *
   * if (conditions.canDeleteBranch && conditions.branchInfo) {
   *   await deleteBranch(conditions.branchInfo);
   * }
   *
   * if (conditions.canArchiveRemote && conditions.remoteSessionId) {
   *   await archiveRemoteSession(conditions.remoteSessionId);
   * }
   * ```
   */
  getCleanupConditions(session: ChatSession): CleanupConditions;

  /**
   * Check if user can modify a session.
   *
   * Synchronous check for modify permission (update title, settings, etc.).
   *
   * @param session - The session to check
   * @param userId - The user requesting modification
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = authService.canModifySession(session, userId);
   *
   * if (!result.authorized) {
   *   return res.status(403).json({ error: 'Cannot modify this session' });
   * }
   *
   * await updateSession(session.id, { title: newTitle });
   * ```
   */
  canModifySession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  /**
   * Check if user can delete a session.
   *
   * Synchronous check for delete permission.
   *
   * @param session - The session to check
   * @param userId - The user requesting deletion
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = authService.canDeleteSession(session, userId);
   *
   * if (!result.authorized) {
   *   return res.status(403).json({ error: result.error });
   * }
   * ```
   */
  canDeleteSession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  /**
   * Check if user can resume a session.
   *
   * Synchronous check for resume permission (send new messages).
   *
   * @param session - The session to check
   * @param userId - The user requesting resume
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = authService.canResumeSession(session, userId);
   *
   * if (!result.authorized) {
   *   return res.status(403).json({ error: 'Cannot resume this session' });
   * }
   *
   * await sendMessage(session.id, prompt);
   * ```
   */
  canResumeSession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  /**
   * Verify user has access to a session (async).
   *
   * Asynchronous check that may query organization membership.
   * Use this for organization-shared sessions.
   *
   * @param session - The session to check (null if not found)
   * @param userId - The user ID to verify
   * @returns Authorization result with role
   *
   * @example
   * ```typescript
   * const result = await authService.verifySessionAccess(session, userId);
   *
   * if (!result.authorized) {
   *   return res.status(result.statusCode).json({ error: result.error });
   * }
   *
   * // User has access - check their role
   * if (result.role === 'owner' || result.role === 'admin') {
   *   showEditControls();
   * }
   * ```
   */
  verifySessionAccess(
    session: ChatSession | null,
    userId: string
  ): Promise<AuthorizationResult>;

  /**
   * Check if user can modify a session (async).
   *
   * Asynchronous version that checks organization permissions.
   *
   * @param session - The session to check
   * @param userId - The user requesting modification
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = await authService.canModifySessionAsync(session, userId);
   *
   * if (result.authorized) {
   *   await updateSession(session.id, updates);
   * }
   * ```
   */
  canModifySessionAsync(
    session: ChatSession,
    userId: string
  ): Promise<AuthorizationResult>;

  /**
   * Check if user can delete a session (async).
   *
   * Asynchronous version that checks organization permissions.
   *
   * @param session - The session to check
   * @param userId - The user requesting deletion
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = await authService.canDeleteSessionAsync(session, userId);
   *
   * if (!result.authorized) {
   *   throw new ForbiddenError(result.error);
   * }
   * ```
   */
  canDeleteSessionAsync(
    session: ChatSession,
    userId: string
  ): Promise<AuthorizationResult>;

  /**
   * Verify access via share token.
   *
   * Checks if a share token is valid for accessing a session.
   *
   * @param session - The session to check (null if not found)
   * @param shareToken - The share token to verify
   * @returns Authorization result
   *
   * @example
   * ```typescript
   * const result = authService.verifyShareTokenAccess(session, shareToken);
   *
   * if (!result.authorized) {
   *   return res.status(403).json({ error: 'Invalid or expired share link' });
   * }
   *
   * // Allow read-only access
   * res.json({ session: sanitizeForSharing(session) });
   * ```
   */
  verifyShareTokenAccess(
    session: ChatSession | null,
    shareToken: string
  ): AuthorizationResult;

  /**
   * Check if a session's share token is still valid.
   *
   * @param session - The session to check
   * @returns True if share token is valid and not expired
   *
   * @example
   * ```typescript
   * if (authService.isShareTokenValid(session)) {
   *   showShareLink(session.shareToken);
   * } else {
   *   showShareExpiredMessage();
   * }
   * ```
   */
  isShareTokenValid(session: ChatSession): boolean;
}
