/**
 * Path Validation Middleware
 * Protects routes using wildcard path parameters from directory traversal attacks
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { validatePath, validateBranchPath, logger } from '@webedt/shared';

/**
 * Middleware factory for validating wildcard path parameters
 *
 * This middleware validates the path captured by Express wildcard routes (req.params[0])
 * against directory traversal attacks and other malicious patterns.
 *
 * @param options - Configuration options
 * @param options.paramIndex - The index of the wildcard parameter (default: 0)
 * @param options.isBranchName - Whether this is a branch name (more lenient validation)
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * // Validate file paths
 * router.get('/:owner/:repo/contents/*', validatePathParam(), async (req, res) => {
 *   const path = req.params[0]; // Safe to use
 * });
 *
 * // Validate branch names
 * router.delete('/:owner/:repo/branches/*', validatePathParam({ isBranchName: true }), ...);
 * ```
 */
export function validatePathParam(options: {
  paramIndex?: number;
  isBranchName?: boolean;
} = {}): RequestHandler {
  const { paramIndex = 0, isBranchName = false } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const paramValue = req.params[paramIndex];

    if (!paramValue) {
      res.status(400).json({
        success: false,
        error: isBranchName ? 'Branch name is required' : 'Path is required'
      });
      return;
    }

    const validationResult = isBranchName
      ? validateBranchPath(paramValue)
      : validatePath(paramValue);

    if (!validationResult.valid) {
      logger.warn('Path validation failed', {
        component: 'PathValidation',
        path: paramValue.substring(0, 100), // Log only first 100 chars for safety
        error: validationResult.error,
        url: req.originalUrl,
        method: req.method,
      });

      res.status(400).json({
        success: false,
        error: validationResult.error
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to validate the 'newPath' field in request body
 *
 * Used for rename operations where both source path (param) and
 * destination path (body) need validation.
 *
 * @example
 * ```typescript
 * router.post('/:owner/:repo/rename/*',
 *   validatePathParam(),
 *   validateBodyPath('newPath'),
 *   async (req, res) => { ... }
 * );
 * ```
 */
export function validateBodyPath(fieldName: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const pathValue = req.body?.[fieldName];

    if (!pathValue) {
      // Let the route handler decide if the field is required
      next();
      return;
    }

    if (typeof pathValue !== 'string') {
      res.status(400).json({
        success: false,
        error: `${fieldName} must be a string`
      });
      return;
    }

    const validationResult = validatePath(pathValue);

    if (!validationResult.valid) {
      logger.warn('Body path validation failed', {
        component: 'PathValidation',
        field: fieldName,
        error: validationResult.error,
        url: req.originalUrl,
        method: req.method,
      });

      res.status(400).json({
        success: false,
        error: `Invalid ${fieldName}: ${validationResult.error}`
      });
      return;
    }

    next();
  };
}
