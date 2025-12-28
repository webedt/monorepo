/**
 * Abstract Autocomplete Service
 * Base interface for AI-powered code completion
 */

import type { AutocompleteRequest } from './types.js';
import type { AutocompleteResponse } from './types.js';
import type { AutocompleteConfig } from './types.js';

export abstract class AAutocompleteService {
  protected config: AutocompleteConfig;

  constructor(config: AutocompleteConfig = {}) {
    this.config = {
      model: 'claude-3-5-haiku-latest',
      maxTokens: 150,
      temperature: 0,
      timeoutMs: 5000,
      ...config,
    };
  }

  abstract complete(
    request: AutocompleteRequest
  ): Promise<AutocompleteResponse>;

  abstract dispose(): void;
}
