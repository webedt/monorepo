/**
 * Storage Quota Middleware
 * Enforces storage limits on upload operations
 */

import { Request, Response, NextFunction } from 'express';
import { StorageService, calculateBase64Size, calculateJsonSize } from '@webedt/shared';
import type { AuthRequest } from './auth.js';

export interface StorageQuotaOptions {
  // Calculate size from request body using this function
  calculateSize?: (body: unknown) => number;
  // Skip quota check for admins
  skipForAdmins?: boolean;
  // Error message when quota exceeded
  errorMessage?: string;
}

/**
 * Middleware factory for enforcing storage quotas
 */
export function requireStorageQuota(options: StorageQuotaOptions = {}) {
  const {
    skipForAdmins = false,
    errorMessage = 'Storage quota exceeded. Please free up space or upgrade your plan.',
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;

    // Skip if user is not authenticated (let auth middleware handle it)
    if (!authReq.user) {
      next();
      return;
    }

    try {
      // Skip for admins if configured
      if (skipForAdmins && authReq.user.isAdmin) {
        next();
        return;
      }

      // Calculate the size of the incoming data
      let size = 0;

      if (options.calculateSize) {
        size = options.calculateSize(req.body);
      } else {
        // Default: estimate from JSON body
        size = calculateJsonSize(req.body);
      }

      // Check quota
      const check = await StorageService.checkQuota(authReq.user.id, size);

      if (!check.allowed) {
        res.status(413).json({
          success: false,
          error: errorMessage,
          details: {
            usedBytes: check.usedBytes.toString(),
            quotaBytes: check.quotaBytes.toString(),
            availableBytes: check.availableBytes.toString(),
            requestedBytes: check.requestedBytes.toString(),
            usedFormatted: StorageService.formatBytes(check.usedBytes),
            quotaFormatted: StorageService.formatBytes(check.quotaBytes),
            availableFormatted: StorageService.formatBytes(check.availableBytes),
            requestedFormatted: StorageService.formatBytes(check.requestedBytes),
          },
        });
        return;
      }

      // Attach size info to request for later use
      (req as any).storageSize = size;

      next();
    } catch (error) {
      console.error('Storage quota check error:', error);
      // Don't block the request on quota check errors
      next();
    }
  };
}

/**
 * Calculate the storage size for a message with images
 */
export function calculateMessageSize(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;

  const message = body as {
    content?: string;
    images?: Array<{ data?: string }>;
  };

  let size = 0;

  // Content size
  if (message.content) {
    size += Buffer.byteLength(message.content, 'utf8');
  }

  // Images size
  if (message.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.data) {
        size += calculateBase64Size(img.data);
      }
    }
  }

  return size;
}

/**
 * Calculate the storage size for a live chat message
 */
export function calculateLiveChatMessageSize(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;

  const message = body as {
    content?: string;
    images?: Array<{ data?: string }>;
    toolCalls?: unknown[];
  };

  let size = 0;

  // Content size
  if (message.content) {
    size += Buffer.byteLength(message.content, 'utf8');
  }

  // Images size
  if (message.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.data) {
        size += calculateBase64Size(img.data);
      }
    }
  }

  // Tool calls size
  if (message.toolCalls) {
    size += calculateJsonSize(message.toolCalls);
  }

  return size;
}

/**
 * Calculate the storage size for a workspace event
 */
export function calculateWorkspaceEventSize(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;

  const event = body as {
    payload?: unknown;
  };

  if (event.payload) {
    return calculateJsonSize(event.payload);
  }

  return 0;
}

/**
 * Middleware to track and update storage usage after successful operations
 */
export function trackStorageUsage() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;

    // Store original send function
    const originalSend = res.send.bind(res);

    res.send = function (body: any): Response {
      // Only track if request was successful and we have size info
      if (res.statusCode >= 200 && res.statusCode < 300 && (req as any).storageSize > 0 && authReq.user) {
        StorageService.addUsage(authReq.user.id, (req as any).storageSize).catch((error) => {
          console.error('Failed to track storage usage:', error);
        });
      }
      return originalSend(body);
    };

    next();
  };
}

export default requireStorageQuota;
