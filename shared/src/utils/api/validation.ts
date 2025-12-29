/**
 * Input Validation Utilities
 * Zod-based validation middleware for Express routes
 * @module utils/api/validation
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendValidationError } from './apiResponse.js';

/**
 * Schema definition for request validation
 */
export interface RequestSchema {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

/**
 * Format Zod errors into field-level error messages
 * @param error - Zod error object
 * @returns Record mapping field names to error messages
 */
export function formatZodErrors(error: z.ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!fields[path]) {
      fields[path] = [];
    }
    fields[path].push(issue.message);
  }

  return fields;
}

/**
 * Create a validation middleware for Express routes
 * Validates body, query, and/or params against Zod schemas
 *
 * @param schema - Object containing body, query, and/or params schemas
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * const createUserSchema = {
 *   body: z.object({
 *     email: z.string().email(),
 *     password: z.string().min(8),
 *   }),
 * };
 *
 * router.post('/users', validateRequest(createUserSchema), (req, res) => {
 *   // req.body is now typed and validated
 * });
 * ```
 */
export function validateRequest(schema: RequestSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const errors: Record<string, string[]> = {};

    try {
      // Validate body
      if (schema.body) {
        const result = schema.body.safeParse(req.body);
        if (!result.success) {
          Object.assign(errors, formatZodErrors(result.error));
        } else {
          req.body = result.data;
        }
      }

      // Validate query
      if (schema.query) {
        const result = schema.query.safeParse(req.query);
        if (!result.success) {
          const queryErrors = formatZodErrors(result.error);
          // Prefix query errors
          for (const [key, messages] of Object.entries(queryErrors)) {
            errors[`query.${key}`] = messages;
          }
        } else {
          (req as Request & { validatedQuery: unknown }).validatedQuery = result.data;
        }
      }

      // Validate params
      if (schema.params) {
        const result = schema.params.safeParse(req.params);
        if (!result.success) {
          const paramErrors = formatZodErrors(result.error);
          // Prefix param errors
          for (const [key, messages] of Object.entries(paramErrors)) {
            errors[`params.${key}`] = messages;
          }
        } else {
          (req as Request & { validatedParams: unknown }).validatedParams = result.data;
        }
      }

      if (Object.keys(errors).length > 0) {
        sendValidationError(res, 'Validation failed', errors);
        return;
      }

      next();
    } catch (error) {
      sendValidationError(
        res,
        error instanceof Error ? error.message : 'Validation error'
      );
    }
  };
}

/**
 * Common validation schemas for reuse across routes
 */
export const CommonSchemas = {
  /** UUID v4 string */
  uuid: z.string().uuid(),

  /** Non-empty string */
  nonEmptyString: z.string().min(1, 'This field is required'),

  /** Email address */
  email: z.string().email('Invalid email address'),

  /** Password with minimum length */
  password: z.string().min(8, 'Password must be at least 8 characters'),

  /** Positive integer */
  positiveInt: z.number().int().positive(),

  /** Non-negative integer */
  nonNegativeInt: z.number().int().nonnegative(),

  /** Boolean that accepts string 'true'/'false' */
  booleanFromString: z.union([
    z.boolean(),
    z.string().transform((val) => val === 'true'),
  ]),

  /** Pagination limit */
  limit: z.coerce.number().int().min(1).max(100).default(20),

  /** Pagination offset */
  offset: z.coerce.number().int().nonnegative().default(0),

  /** Sort order */
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  /** GitHub repository owner/name */
  githubOwner: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Invalid GitHub owner'),
  githubRepo: z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/, 'Invalid repository name'),
  githubBranch: z.string().min(1, 'Branch name is required'),

  /** URL validation */
  url: z.string().url('Invalid URL'),

  /** Date string (ISO 8601) */
  isoDate: z.string().datetime({ message: 'Invalid date format' }),
};

/**
 * Create a pagination schema with custom defaults
 */
export function createPaginationSchema(options?: {
  defaultLimit?: number;
  maxLimit?: number;
}) {
  const { defaultLimit = 20, maxLimit = 100 } = options ?? {};
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
    offset: z.coerce.number().int().nonnegative().default(0),
  });
}

/**
 * Type helper to extract validated request type
 */
export type ValidatedRequest<T extends RequestSchema> = Request & {
  body: T['body'] extends z.ZodTypeAny ? z.infer<T['body']> : unknown;
  validatedQuery: T['query'] extends z.ZodTypeAny ? z.infer<T['query']> : unknown;
  validatedParams: T['params'] extends z.ZodTypeAny ? z.infer<T['params']> : unknown;
};
