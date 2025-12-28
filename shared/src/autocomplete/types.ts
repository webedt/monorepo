/**
 * Autocomplete Types
 * Type definitions for AI-powered code completion
 */

/**
 * Request parameters for autocomplete suggestions
 */
export interface AutocompleteRequest {
  /** The code before the cursor position */
  prefix: string;
  /** The code after the cursor position */
  suffix: string;
  /** Programming language of the file */
  language: string;
  /** File path for context */
  filePath?: string;
  /** Maximum number of suggestions to return */
  maxSuggestions?: number;
  /** Additional context from other open files */
  additionalContext?: FileContext[];
}

/**
 * Context from additional files
 */
export interface FileContext {
  filePath: string;
  content: string;
  language: string;
}

/**
 * A single autocomplete suggestion
 */
export interface AutocompleteSuggestion {
  /** The suggested text to insert */
  text: string;
  /** Display label for the suggestion */
  label: string;
  /** Type of suggestion (e.g., function, variable, keyword) */
  kind: SuggestionKind;
  /** Optional description/documentation */
  detail?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

/**
 * Types of code suggestions
 */
export type SuggestionKind =
  | 'function'
  | 'method'
  | 'variable'
  | 'class'
  | 'interface'
  | 'property'
  | 'keyword'
  | 'snippet'
  | 'text';

/**
 * Response from autocomplete service
 */
export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
  /** Time taken for the request in ms */
  latencyMs: number;
  /** Whether the response was cached */
  cached?: boolean;
}

/**
 * Configuration for the autocomplete service
 */
export interface AutocompleteConfig {
  /** API key for the LLM provider */
  apiKey?: string;
  /** Model to use for completions */
  model?: string;
  /** Maximum tokens in the completion */
  maxTokens?: number;
  /** Temperature for generation (lower = more deterministic) */
  temperature?: number;
  /** Timeout for requests in ms */
  timeoutMs?: number;
}
