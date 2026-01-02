/**
 * Composable Resource Authorization Middleware
 *
 * Provides reusable middleware factories for resource authorization:
 * - requireOwnership(resourceType, extractIdFn) - verifies user owns the resource
 * - requireMembership(roleCheck) - verifies organization membership and role
 * - requireResourceAccess(config) - composable access control with permissions
 *
 * Includes audit logging integration for security monitoring.
 *
 * @example
 * ```typescript
 * // Simple ownership check
 * router.get('/:id', requireAuth, requireOwnership('collection', req => req.params.id), handler);
 *
 * // With custom ID extraction
 * router.delete('/:collectionId/items/:itemId',
 *   requireAuth,
 *   requireOwnership('collection', req => req.params.collectionId),
 *   handler
 * );
 *
 * // Composable access with organization support
 * router.patch('/:id',
 *   requireAuth,
 *   requireResourceAccess({
 *     resourceType: 'session',
 *     extractId: req => req.params.id,
 *     allowOrgAccess: true,
 *     requiredRole: 'admin',
 *   }),
 *   handler
 * );
 * ```
 */

import { Request, Response, NextFunction } from 'express';
import {
  db,
  eq,
  and,
  logger,
  collections,
  snippets,
  snippetCollections,
  chatSessions,
  cloudSaves,
  communityPosts,
  communityComments,
  organizationService,
} from '@webedt/shared';

import type { OrganizationRole } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

// =============================================================================
// Types and Interfaces
// =============================================================================

/**
 * Supported resource types for authorization
 */
export type ResourceType =
  | 'session'
  | 'collection'
  | 'snippet'
  | 'snippetCollection'
  | 'cloudSave'
  | 'communityPost'
  | 'communityComment';

/**
 * Result of an authorization check
 */
export interface AuthorizationResult {
  authorized: boolean;
  error?: string;
  statusCode?: number;
  role?: 'owner' | OrganizationRole | 'shared';
  resource?: Record<string, unknown>;
}

/**
 * Function to extract resource ID from request
 */
export type ExtractIdFn = (req: Request) => string | undefined;

/**
 * Configuration for resource access middleware
 */
export interface ResourceAccessConfig {
  resourceType: ResourceType;
  extractId: ExtractIdFn;
  /** Allow organization members to access (for org-owned resources) */
  allowOrgAccess?: boolean;
  /** Minimum role required for organization access */
  requiredRole?: OrganizationRole;
  /** Additional custom authorization check */
  customCheck?: (resource: Record<string, unknown>, userId: string, req: Request) => AuthorizationResult | Promise<AuthorizationResult>;
  /** Attach resource to request for use in handler */
  attachToRequest?: boolean;
  /** Key to use when attaching resource to request */
  attachKey?: string;
}

/**
 * Configuration for ownership middleware
 */
export interface OwnershipConfig {
  /** Attach resource to request for use in handler */
  attachToRequest?: boolean;
  /** Key to use when attaching resource to request */
  attachKey?: string;
}

/**
 * Configuration for membership middleware
 */
export interface MembershipConfig {
  /** Organization ID extractor */
  extractOrgId: ExtractIdFn;
  /** Minimum role required */
  requiredRole?: OrganizationRole;
}

/**
 * Extended request with authorized resource attached
 */
export interface AuthorizedRequest extends AuthRequest {
  authorizedResource?: Record<string, unknown>;
  authorizationResult?: AuthorizationResult;
}

/**
 * Access attempt log entry for audit trail
 */
export interface AccessAttemptLog {
  userId: string;
  resourceType: ResourceType;
  resourceId: string;
  action: 'read' | 'write' | 'delete';
  granted: boolean;
  reason?: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

// =============================================================================
// Resource Fetchers Registry
// =============================================================================

/**
 * Resource fetcher function type
 */
type ResourceFetcher = (id: string, userId: string) => Promise<{
  resource: Record<string, unknown> | null;
  isOwner: boolean;
  organizationId?: string | null;
}>;

/**
 * Registry of resource fetchers by type
 * Each fetcher returns the resource and ownership status
 */
const resourceFetchers: Record<ResourceType, ResourceFetcher> = {
  session: async (id, userId) => {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id))
      .limit(1);

    if (!session) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: session as Record<string, unknown>,
      isOwner: session.userId === userId,
      organizationId: session.organizationId,
    };
  },

  collection: async (id, userId) => {
    const [collection] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, id))
      .limit(1);

    if (!collection) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: collection as Record<string, unknown>,
      isOwner: collection.userId === userId,
    };
  },

  snippet: async (id, userId) => {
    const [snippet] = await db
      .select()
      .from(snippets)
      .where(eq(snippets.id, id))
      .limit(1);

    if (!snippet) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: snippet as Record<string, unknown>,
      isOwner: snippet.userId === userId,
    };
  },

  snippetCollection: async (id, userId) => {
    const [collection] = await db
      .select()
      .from(snippetCollections)
      .where(eq(snippetCollections.id, id))
      .limit(1);

    if (!collection) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: collection as Record<string, unknown>,
      isOwner: collection.userId === userId,
    };
  },

  cloudSave: async (id, userId) => {
    const [save] = await db
      .select()
      .from(cloudSaves)
      .where(eq(cloudSaves.id, id))
      .limit(1);

    if (!save) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: save as Record<string, unknown>,
      isOwner: save.userId === userId,
    };
  },

  communityPost: async (id, userId) => {
    const [post] = await db
      .select()
      .from(communityPosts)
      .where(eq(communityPosts.id, id))
      .limit(1);

    if (!post) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: post as Record<string, unknown>,
      isOwner: post.userId === userId,
    };
  },

  communityComment: async (id, userId) => {
    const [comment] = await db
      .select()
      .from(communityComments)
      .where(eq(communityComments.id, id))
      .limit(1);

    if (!comment) {
      return { resource: null, isOwner: false };
    }

    return {
      resource: comment as Record<string, unknown>,
      isOwner: comment.userId === userId,
    };
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Send a standardized error response
 */
function sendError(res: Response, statusCode: number, error: string): void {
  res.status(statusCode).json({ success: false, error });
}

/**
 * Extract client IP address from request
 */
function getClientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip?.trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  return req.ip || req.socket?.remoteAddress;
}

/**
 * Organization role hierarchy for permission comparison
 */
const ROLE_HIERARCHY: Record<OrganizationRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

/**
 * Check if user has sufficient role
 */
function hasRequiredRole(userRole: OrganizationRole, requiredRole: OrganizationRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

// =============================================================================
// Access Attempt Logging
// =============================================================================

/** In-memory buffer for access attempts (for batch processing) */
const accessAttemptBuffer: AccessAttemptLog[] = [];
const MAX_BUFFER_SIZE = 100;

/**
 * Log an access attempt for audit purposes.
 * Logs are buffered and can be processed in batches.
 */
export function logAccessAttempt(
  req: Request,
  resourceType: ResourceType,
  resourceId: string,
  granted: boolean,
  action: 'read' | 'write' | 'delete' = 'read',
  reason?: string
): void {
  const authReq = req as AuthRequest;

  const logEntry: AccessAttemptLog = {
    userId: authReq.user?.id || 'anonymous',
    resourceType,
    resourceId,
    action,
    granted,
    reason,
    timestamp: new Date(),
    ipAddress: getClientIp(req),
    userAgent: req.get('user-agent'),
  };

  // Log to console for immediate visibility
  if (!granted) {
    logger.warn(`Access denied: ${resourceType}/${resourceId}`, {
      component: 'Authorization',
      ...logEntry,
    });
  } else {
    logger.debug(`Access granted: ${resourceType}/${resourceId}`, {
      component: 'Authorization',
      userId: logEntry.userId,
      resourceType,
      resourceId,
    });
  }

  // Buffer for batch processing
  accessAttemptBuffer.push(logEntry);

  // Flush if buffer is full
  if (accessAttemptBuffer.length >= MAX_BUFFER_SIZE) {
    flushAccessAttempts();
  }
}

/**
 * Flush buffered access attempts.
 * Can be called periodically or on shutdown.
 */
export function flushAccessAttempts(): AccessAttemptLog[] {
  const attempts = [...accessAttemptBuffer];
  accessAttemptBuffer.length = 0;
  return attempts;
}

/**
 * Get buffered access attempts (for testing/monitoring)
 */
export function getBufferedAccessAttempts(): ReadonlyArray<AccessAttemptLog> {
  return accessAttemptBuffer;
}

// =============================================================================
// Middleware Factories
// =============================================================================

/**
 * Create middleware that requires user ownership of a resource.
 *
 * This is the simplest form of authorization - just checks if the
 * authenticated user owns the specified resource.
 *
 * @param resourceType - Type of resource to check
 * @param extractId - Function to extract resource ID from request
 * @param config - Optional configuration
 *
 * @example
 * ```typescript
 * // Check collection ownership
 * router.get('/:id',
 *   requireAuth,
 *   requireOwnership('collection', req => req.params.id),
 *   handler
 * );
 *
 * // Attach resource to request
 * router.patch('/:id',
 *   requireAuth,
 *   requireOwnership('snippet', req => req.params.id, { attachToRequest: true }),
 *   (req, res) => {
 *     const snippet = (req as AuthorizedRequest).authorizedResource;
 *   }
 * );
 * ```
 */
export function requireOwnership(
  resourceType: ResourceType,
  extractId: ExtractIdFn,
  config: OwnershipConfig = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const { attachToRequest = false, attachKey = 'authorizedResource' } = config;

  return async function ownershipMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authReq = req as AuthRequest;

    // Verify authentication
    if (!authReq.user) {
      logAccessAttempt(req, resourceType, 'unknown', false, 'read', 'Not authenticated');
      sendError(res, 401, 'Unauthorized');
      return;
    }

    // Extract resource ID
    const resourceId = extractId(req);
    if (!resourceId) {
      logAccessAttempt(req, resourceType, 'unknown', false, 'read', 'Missing resource ID');
      sendError(res, 400, 'Invalid resource ID');
      return;
    }

    try {
      // Fetch resource and check ownership
      const fetcher = resourceFetchers[resourceType];
      const { resource, isOwner } = await fetcher(resourceId, authReq.user.id);

      if (!resource) {
        logAccessAttempt(req, resourceType, resourceId, false, 'read', 'Resource not found');
        sendError(res, 404, `${capitalize(resourceType)} not found`);
        return;
      }

      if (!isOwner) {
        logAccessAttempt(req, resourceType, resourceId, false, 'read', 'Not owner');
        sendError(res, 403, 'Access denied');
        return;
      }

      // Log successful access
      logAccessAttempt(req, resourceType, resourceId, true, 'read');

      // Attach resource to request if configured
      if (attachToRequest) {
        const authorizedReq = req as unknown as Record<string, unknown>;
        authorizedReq[attachKey] = resource;
        authorizedReq.authorizationResult = {
          authorized: true,
          role: 'owner',
          resource,
        };
      }

      next();
    } catch (error) {
      logger.error('Authorization check failed', error as Error, {
        component: 'Authorization',
        resourceType,
        resourceId,
        userId: authReq.user.id,
      });
      sendError(res, 500, 'Authorization check failed');
    }
  };
}

/**
 * Create middleware that requires organization membership.
 *
 * Verifies the user is a member of the specified organization
 * and optionally checks for a minimum role.
 *
 * @param config - Membership configuration
 *
 * @example
 * ```typescript
 * // Require any membership
 * router.get('/org/:orgId/resources',
 *   requireAuth,
 *   requireMembership({ extractOrgId: req => req.params.orgId }),
 *   handler
 * );
 *
 * // Require admin role
 * router.post('/org/:orgId/settings',
 *   requireAuth,
 *   requireMembership({
 *     extractOrgId: req => req.params.orgId,
 *     requiredRole: 'admin'
 *   }),
 *   handler
 * );
 * ```
 */
export function requireMembership(
  config: MembershipConfig
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const { extractOrgId, requiredRole = 'member' } = config;

  return async function membershipMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authReq = req as AuthRequest;

    if (!authReq.user) {
      sendError(res, 401, 'Unauthorized');
      return;
    }

    const orgId = extractOrgId(req);
    if (!orgId) {
      sendError(res, 400, 'Invalid organization ID');
      return;
    }

    try {
      const member = await organizationService.getMember(orgId, authReq.user.id);

      if (!member) {
        logger.warn('Organization access denied: not a member', {
          component: 'Authorization',
          organizationId: orgId,
          userId: authReq.user.id,
        });
        sendError(res, 403, 'Not a member of this organization');
        return;
      }

      const userRole = member.role as OrganizationRole;
      if (!hasRequiredRole(userRole, requiredRole)) {
        logger.warn('Organization access denied: insufficient role', {
          component: 'Authorization',
          organizationId: orgId,
          userId: authReq.user.id,
          userRole,
          requiredRole,
        });
        sendError(res, 403, `Requires ${requiredRole} role or higher`);
        return;
      }

      // Attach membership info to request
      (req as AuthorizedRequest).authorizationResult = {
        authorized: true,
        role: userRole,
      };

      next();
    } catch (error) {
      logger.error('Membership check failed', error as Error, {
        component: 'Authorization',
        organizationId: orgId,
        userId: authReq.user.id,
      });
      sendError(res, 500, 'Membership check failed');
    }
  };
}

/**
 * Create composable resource access middleware.
 *
 * This is the most flexible authorization middleware that combines
 * ownership checks with organization access and custom authorization logic.
 *
 * @param config - Resource access configuration
 *
 * @example
 * ```typescript
 * // Session with organization access
 * router.patch('/:id',
 *   requireAuth,
 *   requireResourceAccess({
 *     resourceType: 'session',
 *     extractId: req => req.params.id,
 *     allowOrgAccess: true,
 *     requiredRole: 'admin',
 *     attachToRequest: true,
 *   }),
 *   handler
 * );
 *
 * // With custom check
 * router.delete('/:id',
 *   requireAuth,
 *   requireResourceAccess({
 *     resourceType: 'session',
 *     extractId: req => req.params.id,
 *     allowOrgAccess: true,
 *     customCheck: (resource, userId) => {
 *       if (resource.status === 'running') {
 *         return { authorized: false, error: 'Cannot delete running session', statusCode: 409 };
 *       }
 *       return { authorized: true };
 *     },
 *   }),
 *   handler
 * );
 * ```
 */
export function requireResourceAccess(
  config: ResourceAccessConfig
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const {
    resourceType,
    extractId,
    allowOrgAccess = false,
    requiredRole = 'member',
    customCheck,
    attachToRequest = false,
    attachKey = 'authorizedResource',
  } = config;

  return async function resourceAccessMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const authReq = req as AuthRequest;

    // Verify authentication
    if (!authReq.user) {
      logAccessAttempt(req, resourceType, 'unknown', false, 'read', 'Not authenticated');
      sendError(res, 401, 'Unauthorized');
      return;
    }

    // Extract resource ID
    const resourceId = extractId(req);
    if (!resourceId) {
      logAccessAttempt(req, resourceType, 'unknown', false, 'read', 'Missing resource ID');
      sendError(res, 400, 'Invalid resource ID');
      return;
    }

    try {
      // Fetch resource
      const fetcher = resourceFetchers[resourceType];
      const { resource, isOwner, organizationId } = await fetcher(resourceId, authReq.user.id);

      if (!resource) {
        logAccessAttempt(req, resourceType, resourceId, false, 'read', 'Resource not found');
        sendError(res, 404, `${capitalize(resourceType)} not found`);
        return;
      }

      let accessRole: 'owner' | OrganizationRole | undefined;
      let accessGranted = false;

      // Check ownership first
      if (isOwner) {
        accessGranted = true;
        accessRole = 'owner';
      }
      // Check organization access if allowed and resource has an org
      else if (allowOrgAccess && organizationId) {
        const member = await organizationService.getMember(organizationId, authReq.user.id);
        if (member) {
          const userRole = member.role as OrganizationRole;
          if (hasRequiredRole(userRole, requiredRole)) {
            accessGranted = true;
            accessRole = userRole;
          }
        }
      }

      if (!accessGranted) {
        logAccessAttempt(req, resourceType, resourceId, false, 'read', 'Not authorized');
        sendError(res, 403, 'Access denied');
        return;
      }

      // Run custom check if provided
      if (customCheck) {
        const customResult = await Promise.resolve(customCheck(resource, authReq.user.id, req));
        if (!customResult.authorized) {
          logAccessAttempt(req, resourceType, resourceId, false, 'read', customResult.error);
          sendError(res, customResult.statusCode || 403, customResult.error || 'Access denied');
          return;
        }
      }

      // Log successful access
      logAccessAttempt(req, resourceType, resourceId, true, 'read');

      // Attach resource to request if configured
      const authorizedReq = req as unknown as Record<string, unknown>;
      if (attachToRequest) {
        authorizedReq[attachKey] = resource;
      }
      authorizedReq.authorizationResult = {
        authorized: true,
        role: accessRole,
        resource,
      };

      next();
    } catch (error) {
      logger.error('Resource access check failed', error as Error, {
        component: 'Authorization',
        resourceType,
        resourceId,
        userId: authReq.user.id,
      });
      sendError(res, 500, 'Authorization check failed');
    }
  };
}

// =============================================================================
// Convenience Factories
// =============================================================================

/**
 * Create session ownership middleware with common defaults
 */
export function requireSessionOwnership(
  extractId: ExtractIdFn = req => req.params.id,
  config: Omit<ResourceAccessConfig, 'resourceType' | 'extractId'> = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return requireResourceAccess({
    resourceType: 'session',
    extractId,
    allowOrgAccess: true,
    ...config,
  });
}

/**
 * Create collection ownership middleware
 */
export function requireCollectionOwnership(
  extractId: ExtractIdFn = req => req.params.id,
  config: OwnershipConfig = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return requireOwnership('collection', extractId, config);
}

/**
 * Create snippet ownership middleware
 */
export function requireSnippetOwnership(
  extractId: ExtractIdFn = req => req.params.id,
  config: OwnershipConfig = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return requireOwnership('snippet', extractId, config);
}

/**
 * Create snippet collection ownership middleware
 */
export function requireSnippetCollectionOwnership(
  extractId: ExtractIdFn = req => req.params.id,
  config: OwnershipConfig = {}
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return requireOwnership('snippetCollection', extractId, config);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Capitalize first letter of string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Register a custom resource fetcher
 *
 * Allows extending the authorization system with new resource types.
 *
 * @example
 * ```typescript
 * registerResourceFetcher('customResource', async (id, userId) => {
 *   const resource = await fetchCustomResource(id);
 *   return {
 *     resource,
 *     isOwner: resource?.ownerId === userId,
 *     organizationId: resource?.orgId,
 *   };
 * });
 * ```
 */
export function registerResourceFetcher(
  resourceType: string,
  fetcher: ResourceFetcher
): void {
  (resourceFetchers as Record<string, ResourceFetcher>)[resourceType] = fetcher;
}

/**
 * Create a middleware that combines multiple authorization checks.
 * All checks must pass for access to be granted.
 *
 * @example
 * ```typescript
 * router.patch('/:id',
 *   requireAuth,
 *   combineAuthorization(
 *     requireOwnership('session', req => req.params.id),
 *     (req, res, next) => {
 *       // Additional check
 *       if (someCondition) next();
 *       else res.status(403).json({ error: 'Denied' });
 *     }
 *   ),
 *   handler
 * );
 * ```
 */
export function combineAuthorization(
  ...middlewares: Array<(req: Request, res: Response, next: NextFunction) => void | Promise<void>>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async function combinedMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    let currentIndex = 0;

    const runNext = async (): Promise<void> => {
      if (currentIndex >= middlewares.length) {
        next();
        return;
      }

      const middleware = middlewares[currentIndex++];
      await new Promise<void>((resolve, reject) => {
        const nextFn: NextFunction = (err?: unknown) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve();
        };
        try {
          const result = middleware(req, res, nextFn);
          if (result instanceof Promise) {
            result.catch(reject);
          }
        } catch (err) {
          reject(err);
        }
      });

      // Only continue if response hasn't been sent
      if (!res.headersSent) {
        await runNext();
      }
    };

    try {
      await runNext();
    } catch (error) {
      if (!res.headersSent) {
        logger.error('Combined authorization failed', error as Error, {
          component: 'Authorization',
        });
        sendError(res, 500, 'Authorization check failed');
      }
    }
  };
}
