import { AService } from '../services/abstracts/AService.js';

export interface InvitationCleanupResult {
  invitationsDeleted: number;
  errors: string[];
}

export interface ExpiredInvitation {
  id: string;
  organizationId: string;
  email: string;
  expiresAt: Date;
}

export abstract class AInvitationCleanupService extends AService {
  readonly order = 20;

  abstract cleanupExpiredInvitations(
    retentionDaysAfterExpiry: number
  ): Promise<InvitationCleanupResult>;

  abstract getExpiredInvitations(
    retentionDaysAfterExpiry: number
  ): Promise<ExpiredInvitation[]>;

  abstract deleteInvitation(
    invitationId: string
  ): Promise<{ success: boolean; message: string }>;

  abstract startScheduledCleanup(): void;

  abstract stopScheduledCleanup(): void;
}
