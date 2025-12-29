/**
 * Autocomplete Routes
 * AI-powered code completion suggestions
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  AutocompleteService,
  sendSuccess,
  sendError,
  sendInternalError,
} from '@webedt/shared';

import type { AutocompleteRequest } from '@webedt/shared';

const router = Router();

// Singleton instance
let autocompleteService: AutocompleteService | null = null;

function getAutocompleteService(): AutocompleteService {
  if (!autocompleteService) {
    autocompleteService = new AutocompleteService();
  }
  return autocompleteService;
}

/**
 * POST /api/autocomplete
 * Get code completion suggestions
 */
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      prefix,
      suffix,
      language,
      filePath,
      maxSuggestions,
      additionalContext,
    } = req.body as AutocompleteRequest;

    // Validate required fields
    if (typeof prefix !== 'string') {
      sendError(res, 'prefix is required and must be a string', 400);
      return;
    }

    if (typeof suffix !== 'string') {
      sendError(res, 'suffix is required and must be a string', 400);
      return;
    }

    if (typeof language !== 'string' || language.trim().length === 0) {
      sendError(res, 'language is required', 400);
      return;
    }

    // Limit context size to prevent abuse
    const maxPrefixLength = 4000;
    const maxSuffixLength = 1000;
    const truncatedPrefix = prefix.slice(-maxPrefixLength);
    const truncatedSuffix = suffix.slice(0, maxSuffixLength);

    const service = getAutocompleteService();
    const response = await service.complete({
      prefix: truncatedPrefix,
      suffix: truncatedSuffix,
      language,
      filePath,
      maxSuggestions: Math.min(maxSuggestions || 3, 5),
      additionalContext: additionalContext?.slice(0, 3),
    });

    sendSuccess(res, response);
  } catch (error) {
    console.error('[Autocomplete] Error:', error);
    sendInternalError(res, error instanceof Error ? error.message : 'Internal server error');
  }
});

/**
 * GET /api/autocomplete/languages
 * Get list of supported languages
 */
router.get('/languages', requireAuth, async (req: Request, res: Response) => {
  const languages = [
    { id: 'typescript', name: 'TypeScript', extensions: ['.ts', '.tsx'] },
    { id: 'javascript', name: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'] },
    { id: 'python', name: 'Python', extensions: ['.py', '.pyw'] },
    { id: 'rust', name: 'Rust', extensions: ['.rs'] },
    { id: 'go', name: 'Go', extensions: ['.go'] },
    { id: 'java', name: 'Java', extensions: ['.java'] },
    { id: 'c', name: 'C', extensions: ['.c', '.h'] },
    { id: 'cpp', name: 'C++', extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hxx'] },
    { id: 'csharp', name: 'C#', extensions: ['.cs'] },
    { id: 'ruby', name: 'Ruby', extensions: ['.rb'] },
    { id: 'php', name: 'PHP', extensions: ['.php'] },
    { id: 'html', name: 'HTML', extensions: ['.html', '.htm'] },
    { id: 'css', name: 'CSS', extensions: ['.css'] },
    { id: 'scss', name: 'SCSS', extensions: ['.scss', '.sass'] },
    { id: 'sql', name: 'SQL', extensions: ['.sql'] },
    { id: 'shell', name: 'Shell', extensions: ['.sh', '.bash', '.zsh'] },
    { id: 'yaml', name: 'YAML', extensions: ['.yml', '.yaml'] },
    { id: 'json', name: 'JSON', extensions: ['.json'] },
    { id: 'markdown', name: 'Markdown', extensions: ['.md', '.markdown'] },
    { id: 'xml', name: 'XML', extensions: ['.xml'] },
  ];

  sendSuccess(res, { languages });
});

export default router;
