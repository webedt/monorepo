import { AService } from '../services/abstracts/AService.js';

import type { ChatSession } from '../db/schema.js';
import type { OrganizationRole } from '../db/schema.js';

export interface AuthorizationResult {
  authorized: boolean;
  error?: string;
  statusCode?: number;
  role?: OrganizationRole | 'owner' | 'shared';
}

export interface ValidationResult {
  valid: boolean;
  missingFields?: string[];
  error?: string;
}

export interface CleanupConditions {
  canDeleteBranch: boolean;
  canArchiveRemote: boolean;
  branchInfo?: {
    owner: string;
    repo: string;
    branch: string;
  };
  remoteSessionId?: string;
}

export abstract class ASessionAuthorizationService extends AService {
  readonly order = 0;

  abstract verifyOwnership(
    session: ChatSession | null,
    userId: string
  ): AuthorizationResult;

  abstract validateRequiredFields(
    fields: Record<string, unknown>,
    requiredFields: string[]
  ): ValidationResult;

  abstract getCleanupConditions(
    session: ChatSession
  ): CleanupConditions;

  abstract canModifySession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  abstract canDeleteSession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  abstract canResumeSession(
    session: ChatSession,
    userId: string
  ): AuthorizationResult;

  abstract verifySessionAccess(
    session: ChatSession | null,
    userId: string
  ): Promise<AuthorizationResult>;

  abstract canModifySessionAsync(
    session: ChatSession,
    userId: string
  ): Promise<AuthorizationResult>;

  abstract canDeleteSessionAsync(
    session: ChatSession,
    userId: string
  ): Promise<AuthorizationResult>;

  abstract verifyShareTokenAccess(
    session: ChatSession | null,
    shareToken: string
  ): AuthorizationResult;

  abstract isShareTokenValid(
    session: ChatSession
  ): boolean;
}
