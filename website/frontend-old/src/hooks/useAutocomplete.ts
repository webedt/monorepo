/**
 * useAutocomplete Hook
 *
 * Provides AI-powered code completion (autocomplete) functionality.
 * Uses OpenRouter with GPT-OSS-120B on Cerebras for ultra-fast inference.
 *
 * Features:
 * - Debounced requests to avoid spamming the API
 * - Request cancellation when user continues typing
 * - Local caching of recent completions
 * - Tab to accept, Escape to dismiss
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiBaseUrl } from '../lib/api';

export interface CompletionResult {
  suggestion: string;
  confidence: number;
  provider: string;
  model: string;
  cached: boolean;
  latencyMs: number;
}

interface AutocompleteState {
  suggestion: string | null;
  isLoading: boolean;
  error: string | null;
  cursorPosition: number | null;
}

export interface UseAutocompleteOptions {
  /** Whether autocomplete is enabled (default: true) */
  enabled?: boolean;
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Minimum prefix length before requesting completion (default: 10) */
  minPrefixLength?: number;
  /** Callback when a suggestion is accepted */
  onAccept?: (suggestion: string) => void;
}

export interface UseAutocompleteReturn {
  /** Current suggestion text (null if none) */
  suggestion: string | null;
  /** Whether a request is in progress */
  isLoading: boolean;
  /** Error message if request failed */
  error: string | null;
  /** Cursor position where suggestion should appear */
  cursorPosition: number | null;
  /** Request a completion for the current content */
  requestCompletion: (
    content: string,
    cursorPosition: number,
    language: string,
    filename?: string
  ) => void;
  /** Accept the current suggestion and return it */
  acceptSuggestion: () => string | null;
  /** Clear the current suggestion */
  clearSuggestion: () => void;
  /** Cancel any pending request */
  cancelRequest: () => void;
}

// Local cache for completions
const completionCache = new Map<string, { suggestion: string; timestamp: number }>();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCacheKey(prefix: string, suffix: string, language: string): string {
  // Use last 300 chars of prefix + first 100 chars of suffix
  const prefixKey = prefix.slice(-300);
  const suffixKey = suffix.slice(0, 100);
  return `${language}:${prefixKey}|||${suffixKey}`;
}

export function useAutocomplete(options: UseAutocompleteOptions = {}): UseAutocompleteReturn {
  const {
    enabled = true,
    debounceMs = 300,
    minPrefixLength = 10,
    onAccept,
  } = options;

  const [state, setState] = useState<AutocompleteState>({
    suggestion: null,
    isLoading: false,
    error: null,
    cursorPosition: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestKeyRef = useRef<string>('');

  // Cancel any pending request
  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Clear the current suggestion
  const clearSuggestion = useCallback(() => {
    cancelRequest();
    setState({
      suggestion: null,
      isLoading: false,
      error: null,
      cursorPosition: null,
    });
  }, [cancelRequest]);

  // Request a completion
  const requestCompletion = useCallback(
    (content: string, cursorPos: number, language: string, filename?: string) => {
      if (!enabled) return;

      // Cancel previous request
      cancelRequest();

      // Extract prefix and suffix based on cursor position
      const prefix = content.slice(0, cursorPos);
      const suffix = content.slice(cursorPos);

      // Don't request if prefix is too short
      if (prefix.length < minPrefixLength) {
        clearSuggestion();
        return;
      }

      // Don't request if cursor is in the middle of a word
      const charBeforeCursor = prefix.slice(-1);
      const charAfterCursor = suffix.slice(0, 1);
      if (/\w/.test(charBeforeCursor) && /\w/.test(charAfterCursor)) {
        // User is in the middle of a word, don't suggest yet
        return;
      }

      // Don't request if we just typed a character that typically precedes more input
      // (let user continue typing)
      const lastTwoChars = prefix.slice(-2);
      if (/^[a-zA-Z]$/.test(charBeforeCursor) && !/\s$/.test(lastTwoChars)) {
        // Just typed a letter and not after whitespace, wait for more
        return;
      }

      // Check cache first
      const cacheKey = getCacheKey(prefix, suffix, language);
      const cached = completionCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        setState({
          suggestion: cached.suggestion,
          isLoading: false,
          error: null,
          cursorPosition: cursorPos,
        });
        return;
      }

      // Avoid duplicate requests
      if (cacheKey === lastRequestKeyRef.current) {
        return;
      }

      // Debounce the request
      debounceTimerRef.current = setTimeout(async () => {
        lastRequestKeyRef.current = cacheKey;
        setState((s) => ({ ...s, isLoading: true, error: null }));

        abortControllerRef.current = new AbortController();

        try {
          const response = await fetch(`${getApiBaseUrl()}/api/completions`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prefix,
              suffix,
              language,
              filename,
            }),
            signal: abortControllerRef.current.signal,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(errorData.message || errorData.error || 'Completion failed');
          }

          const result = await response.json();

          if (result.success && result.data?.suggestion) {
            const suggestion = result.data.suggestion;

            // Cache the result
            completionCache.set(cacheKey, {
              suggestion,
              timestamp: Date.now(),
            });

            // Clean up old cache entries
            if (completionCache.size > 100) {
              const now = Date.now();
              for (const [key, value] of completionCache.entries()) {
                if (now - value.timestamp > CACHE_TTL_MS) {
                  completionCache.delete(key);
                }
              }
            }

            setState({
              suggestion,
              isLoading: false,
              error: null,
              cursorPosition: cursorPos,
            });
          } else {
            // No suggestion available
            setState({
              suggestion: null,
              isLoading: false,
              error: null,
              cursorPosition: null,
            });
          }
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            // Request was cancelled, don't update state
            return;
          }

          console.error('[useAutocomplete] Error:', error);
          setState({
            suggestion: null,
            isLoading: false,
            error: (error as Error).message,
            cursorPosition: null,
          });
        }
      }, debounceMs);
    },
    [enabled, debounceMs, minPrefixLength, cancelRequest, clearSuggestion]
  );

  // Accept the current suggestion
  const acceptSuggestion = useCallback((): string | null => {
    const { suggestion } = state;
    if (suggestion) {
      onAccept?.(suggestion);
      clearSuggestion();
      return suggestion;
    }
    return null;
  }, [state, onAccept, clearSuggestion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRequest();
    };
  }, [cancelRequest]);

  return {
    suggestion: state.suggestion,
    isLoading: state.isLoading,
    error: state.error,
    cursorPosition: state.cursorPosition,
    requestCompletion,
    acceptSuggestion,
    clearSuggestion,
    cancelRequest,
  };
}

/**
 * Get programming language from filename extension
 */
export function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    vue: 'vue',
    svelte: 'svelte',

    // Python
    py: 'python',
    pyw: 'python',
    pyx: 'python',

    // Systems
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    rs: 'rust',
    go: 'go',

    // JVM
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',
    groovy: 'groovy',

    // .NET
    cs: 'csharp',
    fs: 'fsharp',
    vb: 'vb',

    // Scripting
    rb: 'ruby',
    php: 'php',
    pl: 'perl',
    lua: 'lua',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'fish',
    ps1: 'powershell',

    // Data/Config
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',

    // Documentation
    md: 'markdown',
    mdx: 'markdown',
    rst: 'rst',
    tex: 'latex',

    // Mobile
    swift: 'swift',
    m: 'objective-c',
    mm: 'objective-c',
    dart: 'dart',

    // Other
    r: 'r',
    R: 'r',
    jl: 'julia',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hrl: 'erlang',
    clj: 'clojure',
    cljs: 'clojure',
    hs: 'haskell',
    ml: 'ocaml',
    nim: 'nim',
    zig: 'zig',
    v: 'v',
    sol: 'solidity',

    // Config files
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    cmake: 'cmake',

    // Fallback
    txt: 'text',
  };

  // Check for special filenames
  const basename = filename.split('/').pop()?.toLowerCase() || '';
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile' || basename === 'gnumakefile') return 'makefile';
  if (basename === 'cmakelists.txt') return 'cmake';
  if (basename.startsWith('.env')) return 'dotenv';
  if (basename === '.gitignore' || basename === '.dockerignore') return 'gitignore';

  return languageMap[ext] || 'text';
}
