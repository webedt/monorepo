/**
 * Completions Route
 *
 * Provides AI-powered code completions (autocomplete) using OpenRouter.
 * This is a lightweight, fast endpoint for real-time editor suggestions.
 *
 * Default model: openai/gpt-oss-120b:cerebras (ultra-fast inference)
 */

import { Router, Request, Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { workerCoordinator } from '../../logic/execution/workerCoordinator.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Rate limiting: Track requests per user
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // 120 requests per minute (2 per second average)

function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId);

  if (!userLimit || now >= userLimit.resetAt) {
    // Reset window
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
  }

  if (userLimit.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: userLimit.resetAt };
  }

  userLimit.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - userLimit.count, resetAt: userLimit.resetAt };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of rateLimitMap.entries()) {
    if (now >= limit.resetAt) {
      rateLimitMap.delete(userId);
    }
  }
}, 60000); // Every minute

interface CompletionRequestBody {
  prefix: string;
  suffix?: string;
  language: string;
  filename?: string;
  cursorLine?: number;
  cursorColumn?: number;
  maxTokens?: number;
  temperature?: number;
}

/**
 * POST /api/completions
 *
 * Get AI-powered code completion suggestions.
 *
 * Request body:
 * - prefix: Code before the cursor (required)
 * - suffix: Code after the cursor (optional, for fill-in-the-middle)
 * - language: Programming language (required)
 * - filename: Current file name (optional, for context)
 * - maxTokens: Max tokens to generate (optional, default: 150)
 * - temperature: Sampling temperature (optional, default: 0.2)
 *
 * Response:
 * - suggestion: The generated code completion
 * - confidence: Confidence score (0-1)
 * - provider: The provider used (openrouter)
 * - model: The model used
 * - cached: Whether this was a cached response
 * - latencyMs: Time taken in milliseconds
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const user = authReq.user!;

  // Check rate limit
  const rateLimit = checkRateLimit(user.id);
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
  res.setHeader('X-RateLimit-Reset', rateLimit.resetAt.toString());

  if (!rateLimit.allowed) {
    res.status(429).json({
      success: false,
      error: 'rate_limited',
      message: 'Too many completion requests. Please slow down.',
      retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
    });
    return;
  }

  const {
    prefix,
    suffix,
    language,
    filename,
    cursorLine,
    cursorColumn,
    maxTokens = 150,
    temperature = 0.2,
  } = req.body as CompletionRequestBody;

  // Validate required fields
  if (!prefix || typeof prefix !== 'string') {
    res.status(400).json({
      success: false,
      error: 'invalid_request',
      message: 'Missing required field: prefix',
    });
    return;
  }

  if (!language || typeof language !== 'string') {
    res.status(400).json({
      success: false,
      error: 'invalid_request',
      message: 'Missing required field: language',
    });
    return;
  }

  // Get OpenRouter API key from user settings
  // The user object comes from the database - we need to check for openrouterApiKey
  const userWithOpenRouter = user as typeof user & {
    openrouterApiKey?: string;
    autocompleteEnabled?: boolean;
    autocompleteModel?: string;
  };

  // Check if autocomplete is enabled for this user
  if (userWithOpenRouter.autocompleteEnabled === false) {
    res.status(403).json({
      success: false,
      error: 'autocomplete_disabled',
      message: 'Autocomplete is disabled. Enable it in settings.',
    });
    return;
  }

  let apiKey: string | undefined;

  if (userWithOpenRouter.openrouterApiKey) {
    apiKey = userWithOpenRouter.openrouterApiKey;
  } else if (user.codexAuth?.apiKey && user.codexAuth.apiKey.startsWith('sk-or-')) {
    // OpenRouter keys start with sk-or-
    apiKey = user.codexAuth.apiKey;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      error: 'no_api_key',
      message: 'No OpenRouter API key configured. Add your API key in settings to enable autocomplete.',
    });
    return;
  }

  // Get user's preferred model or use default
  const model = userWithOpenRouter.autocompleteModel || 'openai/gpt-oss-120b:cerebras';

  // Generate a unique request ID for tracking
  const requestId = `completion-${uuidv4().substring(0, 8)}`;

  try {
    // Acquire worker via coordinator
    const workerAssignment = await workerCoordinator.acquireWorker(requestId);

    if (!workerAssignment) {
      res.status(503).json({
        success: false,
        error: 'no_workers',
        message: 'No AI workers available. Please try again in a moment.',
      });
      return;
    }

    const workerUrl = workerAssignment.url;

    logger.info('[Completions] Worker acquired', {
      requestId,
      workerId: workerAssignment.worker.id,
      containerId: workerAssignment.worker.containerId,
      workerUrl,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for completions

      const response = await fetch(`${workerUrl}/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix,
          suffix: suffix || '',
          language,
          filename,
          cursorLine,
          cursorColumn,
          maxTokens,
          temperature,
          authentication: apiKey,
          model,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
        logger.error('[Completions] Worker error:', errorData);

        // Mark worker as failed
        workerCoordinator.markWorkerFailed(
          workerAssignment.worker.id,
          requestId,
          `HTTP ${response.status}: ${errorData.message || errorData.error}`
        );

        res.status(response.status).json({
          success: false,
          error: errorData.error || 'completion_failed',
          message: errorData.message || 'Failed to generate completion',
        });
        return;
      }

      const result = await response.json() as { latencyMs?: number; cached?: boolean; suggestion?: string };

      logger.info('[Completions] Completion generated', {
        requestId,
        latencyMs: result.latencyMs,
        cached: result.cached,
        suggestionLength: result.suggestion?.length || 0,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        workerCoordinator.markWorkerFailed(workerAssignment.worker.id, requestId, 'Request timeout');
        res.status(504).json({
          success: false,
          error: 'timeout',
          message: 'Completion request timed out',
        });
        return;
      }

      throw error;
    } finally {
      // Release worker back to pool
      workerAssignment.release();
    }
  } catch (error) {
    logger.error('[Completions] Request error:', error);

    res.status(500).json({
      success: false,
      error: 'completion_failed',
      message: error instanceof Error ? error.message : 'Failed to generate completion',
    });
  }
});

export default router;
