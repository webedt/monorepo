import { ASessionAuthorizationService } from './ASessionAuthorizationService.js';

import type { ChatSession } from '../db/schema.js';
import type { AuthorizationResult, ValidationResult, CleanupConditions } from './ASessionAuthorizationService.js';

export class SessionAuthorizationService extends ASessionAuthorizationService {
  verifyOwnership(session: ChatSession | null, userId: string): AuthorizationResult {
    if (!session) {
      return {
        authorized: false,
        error: 'Session not found',
        statusCode: 404,
      };
    }

    if (session.userId !== userId) {
      return {
        authorized: false,
        error: 'Unauthorized',
        statusCode: 403,
      };
    }

    return { authorized: true };
  }

  validateRequiredFields(
    fields: Record<string, unknown>,
    requiredFields: string[]
  ): ValidationResult {
    const missingFields: string[] = [];

    for (const field of requiredFields) {
      const value = fields[field];
      if (value === undefined || value === null || value === '') {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      return {
        valid: false,
        missingFields,
        error: `Missing required fields: ${missingFields.join(', ')}`,
      };
    }

    return { valid: true };
  }

  getCleanupConditions(session: ChatSession): CleanupConditions {
    const canDeleteBranch = !!(
      session.repositoryOwner &&
      session.repositoryName &&
      session.branch &&
      session.baseBranch &&
      session.branch !== session.baseBranch
    );

    const canArchiveRemote = !!session.remoteSessionId;

    const conditions: CleanupConditions = {
      canDeleteBranch,
      canArchiveRemote,
    };

    if (canDeleteBranch) {
      conditions.branchInfo = {
        owner: session.repositoryOwner!,
        repo: session.repositoryName!,
        branch: session.branch!,
      };
    }

    if (canArchiveRemote) {
      conditions.remoteSessionId = session.remoteSessionId!;
    }

    return conditions;
  }

  canModifySession(session: ChatSession, userId: string): AuthorizationResult {
    const ownership = this.verifyOwnership(session, userId);
    if (!ownership.authorized) {
      return ownership;
    }

    if (session.locked) {
      return {
        authorized: false,
        error: 'Session is locked',
        statusCode: 423,
      };
    }

    return { authorized: true };
  }

  canDeleteSession(session: ChatSession, userId: string): AuthorizationResult {
    const ownership = this.verifyOwnership(session, userId);
    if (!ownership.authorized) {
      return ownership;
    }

    if (session.status === 'running') {
      return {
        authorized: false,
        error: 'Cannot delete a running session',
        statusCode: 409,
      };
    }

    return { authorized: true };
  }

  canResumeSession(session: ChatSession, userId: string): AuthorizationResult {
    const ownership = this.verifyOwnership(session, userId);
    if (!ownership.authorized) {
      return ownership;
    }

    if (!session.remoteSessionId) {
      return {
        authorized: false,
        error: 'Session has no remote session ID',
        statusCode: 400,
      };
    }

    if (session.status === 'running') {
      return {
        authorized: false,
        error: 'Session is already running',
        statusCode: 409,
      };
    }

    return { authorized: true };
  }
}

export const sessionAuthorizationService = new SessionAuthorizationService();
