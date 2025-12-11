# AI-Powered Tab-Complete Autocomplete Implementation Plan

## Status: ✅ IMPLEMENTED

### Implementation Summary

The following components have been implemented:

**Backend - AI Worker** (`ai-coding-worker/`):
- ✅ `src/providers/OpenRouterCompletionProvider.ts` - Provider for OpenRouter API with FIM-style prompting
- ✅ `src/server.ts` - Added `/completions` endpoint for fast, lightweight completions

**Backend - Internal API** (`internal-api-server/`):
- ✅ `src/routes/completions.ts` - Completions route with rate limiting and worker coordination
- ✅ `src/db/schema.ts` - Added `openrouterApiKey`, `autocompleteEnabled`, `autocompleteModel` columns
- ✅ `src/routes/user.ts` - Added routes for managing OpenRouter API key and autocomplete settings

**Frontend** (`website/client/`):
- ✅ `src/hooks/useAutocomplete.ts` - React hook for managing autocomplete state
- ✅ `src/components/SyntaxHighlightedEditor.tsx` - Added ghost text overlay support
- ✅ `src/pages/Code.tsx` - Integrated autocomplete with the code editor

### Model Used: `openai/gpt-oss-120b:cerebras`
- Ultra-fast inference via Cerebras (2,700+ tokens/sec, 280ms time-to-first-token)
- Cost-effective ($0.039/M input, $0.19/M output tokens)
- 128K context window
- Accessed via OpenRouter API

### How to Enable
1. Get an OpenRouter API key from https://openrouter.ai
2. Go to Settings → Add your OpenRouter API key
3. Start typing code - suggestions appear as ghost text
4. Press **Tab** to accept, **Escape** to dismiss

---

## Original Plan (for reference)

## Part 1: AI Provider Analysis & Recommendation

### Provider Comparison for Code Completion

| Provider | FIM Support | Latency | Cost | Quality | Recommendation |
|----------|-------------|---------|------|---------|----------------|
| **DeepSeek Coder** | ✅ Native FIM API | ~200-400ms | Very Low ($0.14/1M tokens) | Excellent | ⭐ **Best for Autocomplete** |
| **Claude** | ❌ No native FIM | ~500-1000ms | High ($3-15/1M tokens) | Excellent | Best for chat/agentic |
| **OpenAI GPT-4** | ❌ Deprecated FIM | ~300-600ms | High ($2.50-10/1M tokens) | Excellent | Good fallback |
| **Codestral (Mistral)** | ✅ Native FIM | ~150-300ms | Low ($0.30/1M tokens) | Very Good | Great alternative |
| **GitHub Copilot** | ✅ Built-in | ~100-200ms | $10-19/month | Excellent | Requires subscription |

### Why DeepSeek is the Top Choice for Autocomplete

1. **Native Fill-in-the-Middle (FIM) Support**
   - DeepSeek has a dedicated FIM API endpoint (`/v1/completions` with `suffix` parameter)
   - No prompt engineering workarounds needed
   - Specifically trained for code insertion tasks

2. **Cost Effectiveness**
   - At $0.14 per million input tokens, it's ~20-100x cheaper than Claude/GPT-4
   - Critical for autocomplete which makes many small requests

3. **Speed**
   - Optimized for low-latency completions
   - 200-400ms typical response time

4. **Quality**
   - DeepSeek Coder models (1B-33B params) excel at code completion
   - 16K context window for understanding surrounding code

### FIM (Fill-in-the-Middle) Explained

```
┌─────────────────────────────────────────────────────────┐
│  PREFIX (code before cursor)                            │
│  ─────────────────────────────                          │
│  def calculate_total(items):                            │
│      total = 0                                          │
│      for item in items:                                 │
│          █ ← CURSOR HERE                                │
│                                                         │
│  ─────────────────────────────                          │
│  SUFFIX (code after cursor)                             │
│      return total                                       │
│                                                         │
│  ═══════════════════════════════════════                │
│  AI GENERATES: "total += item.price"                    │
└─────────────────────────────────────────────────────────┘
```

The AI sees both what comes BEFORE and AFTER the cursor, allowing it to generate contextually appropriate insertions.

### Recommended Multi-Provider Strategy

```
Primary:    DeepSeek Coder (FIM) - Fast, cheap, high quality
Fallback 1: Codestral (FIM)      - Alternative FIM provider
Fallback 2: Claude (prompted)    - When FIM unavailable, use prompt engineering
```

---

## Part 2: System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                               │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                  SyntaxHighlightedEditor.tsx                        │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │ │
│  │  │    Textarea      │  │   Ghost Text     │  │  Syntax Layer    │  │ │
│  │  │    (input)       │  │   (suggestion)   │  │  (highlighting)  │  │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    useAutocomplete Hook                             │ │
│  │  • Debounced trigger (300ms)     • Request cancellation            │ │
│  │  • Cache management              • Keyboard handlers               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │ POST /api/completions
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      INTERNAL API SERVER                                 │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                   /api/completions endpoint                         │ │
│  │  • Auth validation              • Rate limiting                    │ │
│  │  • Provider selection           • Response caching                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
            ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
            │  DeepSeek   │   │  Codestral  │   │   Claude    │
            │  FIM API    │   │  FIM API    │   │  (fallback) │
            └─────────────┘   └─────────────┘   └─────────────┘
```

### Request/Response Flow

```
1. User types code
         │
         ▼
2. Debounce timer starts (300ms)
         │
         ▼
3. Timer fires → Extract context
   • Prefix: 50-100 lines before cursor
   • Suffix: 20-50 lines after cursor
   • Current line content
   • File language/extension
         │
         ▼
4. Check cache for similar context
   • Cache hit → Show cached suggestion
   • Cache miss → Continue to API
         │
         ▼
5. POST /api/completions
   {
     prefix: "def calc...",
     suffix: "return total",
     language: "python",
     filename: "utils.py",
     cursor_line: 15,
     cursor_column: 8
   }
         │
         ▼
6. Backend selects provider & calls FIM API
         │
         ▼
7. Return completion
   {
     suggestion: "total += item.price",
     confidence: 0.92,
     provider: "deepseek"
   }
         │
         ▼
8. Display ghost text at cursor position
         │
         ▼
9. User presses Tab → Accept suggestion
   User presses Esc → Dismiss
   User keeps typing → Cancel & restart
```

---

## Part 3: Detailed Implementation Plan

### Phase 1: Backend - Completion Endpoint

#### 1.1 Add DeepSeek Provider

**File: `ai-coding-worker/src/providers/DeepSeekProvider.ts`** (NEW)

```typescript
import { BaseProvider, ProviderOptions, ProviderStreamEvent } from './BaseProvider';

interface DeepSeekFIMRequest {
  model: string;
  prompt: string;
  suffix?: string;
  max_tokens: number;
  temperature: number;
  stop?: string[];
}

interface DeepSeekFIMResponse {
  choices: Array<{
    text: string;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export class DeepSeekProvider extends BaseProvider {
  private apiKey: string;
  private model: string;
  private baseUrl = 'https://api.deepseek.com/beta';

  constructor(authentication: string, workspace: string, model?: string) {
    super(authentication, workspace);
    this.apiKey = authentication;
    this.model = model || 'deepseek-coder';
  }

  async completeFIM(
    prefix: string,
    suffix: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      stop?: string[];
    } = {}
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: prefix,
        suffix: suffix,
        max_tokens: options.maxTokens || 150,
        temperature: options.temperature || 0.2,
        stop: options.stop || ['\n\n', '```'],
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data: DeepSeekFIMResponse = await response.json();
    return data.choices[0]?.text || '';
  }

  getProviderName(): string {
    return 'deepseek';
  }

  async validateToken(): Promise<boolean> {
    try {
      // Simple validation call
      await this.completeFIM('// test', '', { maxTokens: 1 });
      return true;
    } catch {
      return false;
    }
  }

  // Required by BaseProvider but not used for completions
  async execute(
    userRequest: any,
    options: ProviderOptions,
    onEvent: (event: ProviderStreamEvent) => void
  ): Promise<void> {
    throw new Error('Use completeFIM() for code completion');
  }
}
```

#### 1.2 Create Completions Endpoint in AI Worker

**File: `ai-coding-worker/src/server.ts`** (MODIFY - add new endpoint)

```typescript
// Add after existing endpoints

interface CompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  filename?: string;
  cursorLine?: number;
  cursorColumn?: number;
  maxTokens?: number;
  temperature?: number;
  provider?: string;
  authentication: string;
}

interface CompletionResponse {
  suggestion: string;
  confidence: number;
  provider: string;
  cached: boolean;
  latencyMs: number;
}

// Simple in-memory cache for completions
const completionCache = new Map<string, { suggestion: string; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute

function getCacheKey(prefix: string, suffix: string): string {
  // Use last 500 chars of prefix + first 200 chars of suffix
  const normalizedPrefix = prefix.slice(-500);
  const normalizedSuffix = suffix.slice(0, 200);
  return `${normalizedPrefix}|||${normalizedSuffix}`;
}

app.post('/completions', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const {
    prefix,
    suffix,
    language,
    filename,
    maxTokens = 150,
    temperature = 0.2,
    provider = 'deepseek',
    authentication,
  } = req.body as CompletionRequest;

  // Validate required fields
  if (!prefix || !authentication) {
    return res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: prefix, authentication',
    });
  }

  res.setHeader('X-Container-ID', containerId);

  // Check cache
  const cacheKey = getCacheKey(prefix, suffix || '');
  const cached = completionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({
      suggestion: cached.suggestion,
      confidence: 0.8,
      provider,
      cached: true,
      latencyMs: Date.now() - startTime,
    });
  }

  try {
    let suggestion = '';

    if (provider === 'deepseek') {
      const deepseek = new DeepSeekProvider(authentication, '/tmp/completions');
      suggestion = await deepseek.completeFIM(prefix, suffix || '', {
        maxTokens,
        temperature,
      });
    } else if (provider === 'codestral') {
      // Codestral FIM implementation
      suggestion = await callCodestralFIM(authentication, prefix, suffix, { maxTokens, temperature });
    } else {
      // Fallback: Use Claude with prompt engineering
      suggestion = await callClaudeFallback(authentication, prefix, suffix, language);
    }

    // Clean up suggestion (remove leading/trailing whitespace issues)
    suggestion = cleanupSuggestion(suggestion, prefix);

    // Cache the result
    completionCache.set(cacheKey, { suggestion, timestamp: Date.now() });

    // Cleanup old cache entries periodically
    if (completionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of completionCache.entries()) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          completionCache.delete(key);
        }
      }
    }

    res.json({
      suggestion,
      confidence: suggestion.length > 0 ? 0.85 : 0,
      provider,
      cached: false,
      latencyMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error('Completion error:', error);
    res.status(500).json({
      error: 'completion_failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - startTime,
    });
  }
});

function cleanupSuggestion(suggestion: string, prefix: string): string {
  // Remove common artifacts
  let cleaned = suggestion;

  // Trim trailing incomplete lines if they look cut off
  const lines = cleaned.split('\n');
  if (lines.length > 1 && lines[lines.length - 1].trim() === '') {
    lines.pop();
    cleaned = lines.join('\n');
  }

  // Ensure suggestion doesn't repeat end of prefix
  const prefixEnd = prefix.slice(-50);
  if (cleaned.startsWith(prefixEnd)) {
    cleaned = cleaned.slice(prefixEnd.length);
  }

  return cleaned;
}
```

#### 1.3 Add Completions Route to Internal API Server

**File: `internal-api-server/src/routes/completions.ts`** (NEW)

```typescript
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from 'express-rate-limit';

const router = Router();

// Rate limit: 60 requests per minute per user
const completionRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'rate_limited', message: 'Too many completion requests' },
});

interface CompletionRequestBody {
  prefix: string;
  suffix?: string;
  language: string;
  filename?: string;
  cursorLine?: number;
  cursorColumn?: number;
}

router.post('/', requireAuth, completionRateLimit, async (req: Request, res: Response) => {
  const { prefix, suffix, language, filename, cursorLine, cursorColumn } = req.body as CompletionRequestBody;
  const user = req.user!;

  // Validate request
  if (!prefix || typeof prefix !== 'string') {
    return res.status(400).json({ error: 'invalid_request', message: 'prefix is required' });
  }

  // Determine which provider to use for completions
  // Priority: DeepSeek (if configured) > Codestral > Claude fallback
  let provider = 'deepseek';
  let authentication = '';

  if (user.deepseekAuth?.apiKey) {
    provider = 'deepseek';
    authentication = user.deepseekAuth.apiKey;
  } else if (user.codestralAuth?.apiKey) {
    provider = 'codestral';
    authentication = user.codestralAuth.apiKey;
  } else if (user.claudeAuth) {
    provider = 'claude';
    authentication = user.claudeAuth; // Will use prompt-based completion
  } else {
    return res.status(403).json({
      error: 'no_provider',
      message: 'No completion provider configured. Add DeepSeek or Claude API key in settings.',
    });
  }

  try {
    // For completions, we can call the AI worker directly without session management
    // Or use a lightweight direct API call to skip the worker entirely

    const workerResponse = await fetch(`${process.env.AI_WORKER_URL}/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prefix,
        suffix: suffix || '',
        language,
        filename,
        cursorLine,
        cursorColumn,
        provider,
        authentication,
        maxTokens: 150,
        temperature: 0.2,
      }),
    });

    if (!workerResponse.ok) {
      const error = await workerResponse.json();
      return res.status(workerResponse.status).json(error);
    }

    const result = await workerResponse.json();
    res.json(result);
  } catch (error) {
    console.error('Completion proxy error:', error);
    res.status(500).json({
      error: 'proxy_error',
      message: 'Failed to get completion',
    });
  }
});

export default router;
```

---

### Phase 2: Frontend - Autocomplete UI

#### 2.1 Create useAutocomplete Hook

**File: `website/client/src/hooks/useAutocomplete.ts`** (NEW)

```typescript
import { useState, useCallback, useRef, useEffect } from 'react';
import { completionsApi } from '../lib/api';

interface AutocompleteState {
  suggestion: string | null;
  isLoading: boolean;
  cursorPosition: { line: number; column: number } | null;
}

interface UseAutocompleteOptions {
  enabled?: boolean;
  debounceMs?: number;
  minPrefixLength?: number;
}

export function useAutocomplete(options: UseAutocompleteOptions = {}) {
  const {
    enabled = true,
    debounceMs = 300,
    minPrefixLength = 10,
  } = options;

  const [state, setState] = useState<AutocompleteState>({
    suggestion: null,
    isLoading: false,
    cursorPosition: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastRequestRef = useRef<string>('');

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
    setState({ suggestion: null, isLoading: false, cursorPosition: null });
  }, [cancelRequest]);

  // Request a completion
  const requestCompletion = useCallback(
    async (
      content: string,
      cursorPosition: number,
      language: string,
      filename?: string
    ) => {
      if (!enabled) return;

      // Cancel previous request
      cancelRequest();

      // Extract prefix and suffix based on cursor position
      const prefix = content.slice(0, cursorPosition);
      const suffix = content.slice(cursorPosition);

      // Don't request if prefix is too short
      if (prefix.length < minPrefixLength) {
        clearSuggestion();
        return;
      }

      // Don't request if cursor is in the middle of a word (let user finish typing)
      const charBeforeCursor = prefix.slice(-1);
      const charAfterCursor = suffix.slice(0, 1);
      if (/\w/.test(charBeforeCursor) && /\w/.test(charAfterCursor)) {
        return;
      }

      // Calculate line/column for cursor
      const lines = prefix.split('\n');
      const cursorLine = lines.length;
      const cursorColumn = lines[lines.length - 1].length;

      // Create cache key to avoid duplicate requests
      const requestKey = `${prefix.slice(-200)}|${suffix.slice(0, 100)}`;
      if (requestKey === lastRequestRef.current) {
        return;
      }

      // Debounce the request
      debounceTimerRef.current = setTimeout(async () => {
        lastRequestRef.current = requestKey;
        setState((s) => ({ ...s, isLoading: true }));

        abortControllerRef.current = new AbortController();

        try {
          const result = await completionsApi.getCompletion(
            {
              prefix,
              suffix,
              language,
              filename,
              cursorLine,
              cursorColumn,
            },
            abortControllerRef.current.signal
          );

          if (result.suggestion && result.suggestion.trim()) {
            setState({
              suggestion: result.suggestion,
              isLoading: false,
              cursorPosition: { line: cursorLine, column: cursorColumn },
            });
          } else {
            setState({ suggestion: null, isLoading: false, cursorPosition: null });
          }
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            console.error('Autocomplete error:', error);
          }
          setState({ suggestion: null, isLoading: false, cursorPosition: null });
        }
      }, debounceMs);
    },
    [enabled, debounceMs, minPrefixLength, cancelRequest, clearSuggestion]
  );

  // Accept the current suggestion
  const acceptSuggestion = useCallback((): string | null => {
    const { suggestion } = state;
    clearSuggestion();
    return suggestion;
  }, [state, clearSuggestion]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRequest();
    };
  }, [cancelRequest]);

  return {
    suggestion: state.suggestion,
    isLoading: state.isLoading,
    cursorPosition: state.cursorPosition,
    requestCompletion,
    acceptSuggestion,
    clearSuggestion,
    cancelRequest,
  };
}
```

#### 2.2 Add Completions API Function

**File: `website/client/src/lib/api.ts`** (MODIFY - add completions API)

```typescript
// Add to existing api.ts file

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  language: string;
  filename?: string;
  cursorLine?: number;
  cursorColumn?: number;
}

export interface CompletionResponse {
  suggestion: string;
  confidence: number;
  provider: string;
  cached: boolean;
  latencyMs: number;
}

export const completionsApi = {
  getCompletion: async (
    request: CompletionRequest,
    signal?: AbortSignal
  ): Promise<CompletionResponse> => {
    const response = await fetch(`${getApiBaseUrl()}/api/completions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.message || error.error || 'Completion request failed');
    }

    return response.json();
  },
};
```

#### 2.3 Modify SyntaxHighlightedEditor for Ghost Text

**File: `website/client/src/components/SyntaxHighlightedEditor.tsx`** (MODIFY)

```typescript
// Key changes to add ghost text support

interface SyntaxHighlightedEditorProps {
  content: string;
  filename: string;
  onChange?: (content: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  className?: string;
  readOnly?: boolean;
  // NEW: Autocomplete props
  ghostText?: string | null;
  ghostTextPosition?: { line: number; column: number } | null;
  onAcceptGhostText?: () => void;
}

export const SyntaxHighlightedEditor = React.memo(function SyntaxHighlightedEditor({
  content,
  filename,
  onChange,
  onKeyDown,
  className,
  readOnly = false,
  ghostText,
  ghostTextPosition,
  onAcceptGhostText,
}: SyntaxHighlightedEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle keyboard events for autocomplete
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Tab to accept ghost text
      if (e.key === 'Tab' && ghostText && onAcceptGhostText) {
        e.preventDefault();
        onAcceptGhostText();
        return;
      }

      // Escape to dismiss ghost text (handled by parent clearing ghostText)
      if (e.key === 'Escape' && ghostText) {
        e.preventDefault();
        // Parent should clear ghost text
      }

      // Forward to parent handler
      onKeyDown?.(e);
    },
    [ghostText, onAcceptGhostText, onKeyDown]
  );

  // Render code with ghost text overlay
  const renderContentWithGhost = useMemo(() => {
    if (!ghostText || !ghostTextPosition) {
      return null;
    }

    const lines = content.split('\n');
    const { line, column } = ghostTextPosition;

    // Calculate position for ghost text
    const lineIndex = line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }

    return (
      <div
        className="ghost-text-overlay pointer-events-none absolute"
        style={{
          // Position calculated based on line height and character width
          top: `${lineIndex * 1.5}em`, // Adjust based on your line height
          left: `${column}ch`,
        }}
      >
        <span className="text-gray-400 dark:text-gray-600 opacity-70">
          {ghostText}
        </span>
      </div>
    );
  }, [content, ghostText, ghostTextPosition]);

  return (
    <div className={`syntax-editor-container relative ${className || ''}`}>
      {/* Line numbers */}
      <div className="line-numbers">
        {/* ... existing line number rendering ... */}
      </div>

      {/* Code display with syntax highlighting */}
      <div className="code-display">
        <SyntaxHighlighter
          language={getLanguage(filename)}
          style={isDarkMode ? oneDark : oneLight}
        >
          {content}
        </SyntaxHighlighter>

        {/* Ghost text overlay */}
        {renderContentWithGhost}
      </div>

      {/* Transparent textarea for input */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        className="absolute inset-0 opacity-0 resize-none"
        spellCheck={false}
      />
    </div>
  );
});
```

#### 2.4 Integrate Autocomplete in Code Page

**File: `website/client/src/pages/Code.tsx`** (MODIFY - key sections)

```typescript
import { useAutocomplete } from '../hooks/useAutocomplete';

// Inside the Code component:

function Code() {
  // ... existing state ...

  // Autocomplete hook
  const {
    suggestion,
    isLoading: isAutocompletLoading,
    cursorPosition,
    requestCompletion,
    acceptSuggestion,
    clearSuggestion,
  } = useAutocomplete({
    enabled: userSettings?.autocompleteEnabled ?? true,
    debounceMs: 300,
  });

  // Handle content change with autocomplete trigger
  const handleContentChange = useCallback(
    (newContent: string, filename: string) => {
      // Update content state
      setFileContent(newContent);

      // Get cursor position from textarea
      const textarea = textareaRef.current;
      if (textarea) {
        const cursorPos = textarea.selectionStart;
        const language = getLanguageFromFilename(filename);

        // Request autocomplete
        requestCompletion(newContent, cursorPos, language, filename);
      }
    },
    [requestCompletion]
  );

  // Handle accepting autocomplete suggestion
  const handleAcceptSuggestion = useCallback(() => {
    const accepted = acceptSuggestion();
    if (accepted && textareaRef.current) {
      const textarea = textareaRef.current;
      const cursorPos = textarea.selectionStart;

      // Insert the suggestion at cursor position
      const before = fileContent.slice(0, cursorPos);
      const after = fileContent.slice(cursorPos);
      const newContent = before + accepted + after;

      setFileContent(newContent);

      // Move cursor to end of inserted text
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = cursorPos + accepted.length;
      }, 0);
    }
  }, [acceptSuggestion, fileContent]);

  // Clear suggestion when switching files or on certain keypresses
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Escape clears suggestion
      if (e.key === 'Escape') {
        clearSuggestion();
      }

      // Arrow keys clear suggestion (user is navigating)
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        clearSuggestion();
      }
    },
    [clearSuggestion]
  );

  return (
    <div>
      {/* ... existing UI ... */}

      <SyntaxHighlightedEditor
        content={fileContent}
        filename={currentFile}
        onChange={(content) => handleContentChange(content, currentFile)}
        onKeyDown={handleKeyDown}
        ghostText={suggestion}
        ghostTextPosition={cursorPosition}
        onAcceptGhostText={handleAcceptSuggestion}
      />

      {/* Optional: Loading indicator */}
      {isAutocompletLoading && (
        <div className="absolute bottom-2 right-2 text-xs text-gray-400">
          <span className="animate-pulse">●</span> Thinking...
        </div>
      )}
    </div>
  );
}
```

---

### Phase 3: Database & Settings

#### 3.1 Add User Settings for Autocomplete

**File: `internal-api-server/src/db/schema.ts`** (MODIFY)

```typescript
// Add to users table or user_settings table

export const users = pgTable('users', {
  // ... existing columns ...

  // Autocomplete settings
  autocompleteEnabled: boolean('autocomplete_enabled').default(true),
  autocompleteProvider: text('autocomplete_provider').default('deepseek'),
  deepseekApiKey: text('deepseek_api_key'),
  codestralApiKey: text('codestral_api_key'),
});
```

#### 3.2 Settings UI

**File: `website/client/src/pages/Settings.tsx`** (MODIFY - add section)

```typescript
// Add autocomplete settings section

<section className="settings-section">
  <h3>Code Autocomplete</h3>

  <div className="setting-item">
    <label>
      <input
        type="checkbox"
        checked={settings.autocompleteEnabled}
        onChange={(e) => updateSetting('autocompleteEnabled', e.target.checked)}
      />
      Enable AI autocomplete suggestions
    </label>
  </div>

  <div className="setting-item">
    <label>Autocomplete Provider</label>
    <select
      value={settings.autocompleteProvider}
      onChange={(e) => updateSetting('autocompleteProvider', e.target.value)}
    >
      <option value="deepseek">DeepSeek Coder (Recommended)</option>
      <option value="codestral">Codestral (Mistral)</option>
      <option value="claude">Claude (Fallback)</option>
    </select>
  </div>

  {settings.autocompleteProvider === 'deepseek' && (
    <div className="setting-item">
      <label>DeepSeek API Key</label>
      <input
        type="password"
        value={settings.deepseekApiKey || ''}
        onChange={(e) => updateSetting('deepseekApiKey', e.target.value)}
        placeholder="sk-..."
      />
      <small>
        Get your API key from{' '}
        <a href="https://platform.deepseek.com" target="_blank" rel="noopener">
          platform.deepseek.com
        </a>
      </small>
    </div>
  )}
</section>
```

---

## Part 4: Implementation Checklist

### Phase 1: Backend (Week 1)
- [ ] Create `DeepSeekProvider.ts` with FIM support
- [ ] Add `/completions` endpoint to ai-coding-worker
- [ ] Add `/api/completions` route to internal-api-server
- [ ] Implement basic caching
- [ ] Add rate limiting
- [ ] Write unit tests for completion endpoint

### Phase 2: Frontend Hook (Week 1-2)
- [ ] Create `useAutocomplete.ts` hook
- [ ] Add `completionsApi` to api.ts
- [ ] Implement debouncing and request cancellation
- [ ] Add local suggestion caching

### Phase 3: Editor Integration (Week 2)
- [ ] Modify `SyntaxHighlightedEditor.tsx` for ghost text
- [ ] Add CSS for ghost text styling
- [ ] Integrate autocomplete in `Code.tsx`
- [ ] Handle Tab/Escape/Arrow key events
- [ ] Test cursor positioning

### Phase 4: Settings & Polish (Week 2-3)
- [ ] Add database columns for autocomplete settings
- [ ] Create settings UI for autocomplete configuration
- [ ] Add DeepSeek API key management
- [ ] Add enable/disable toggle
- [ ] Performance optimization

### Phase 5: Testing & Launch (Week 3)
- [ ] End-to-end testing
- [ ] Performance benchmarking (target: <500ms latency)
- [ ] Error handling edge cases
- [ ] Documentation
- [ ] Gradual rollout

---

## Part 5: Cost Estimation

### DeepSeek Pricing (Recommended)
- Input: $0.14 / 1M tokens
- Output: $0.28 / 1M tokens

### Estimated Usage Per Developer Per Day
- ~200 completion requests/day
- ~500 tokens/request average (prefix + suffix context)
- ~50 tokens/response average

### Daily Cost Per Developer
- Input: 200 × 500 = 100K tokens = $0.014
- Output: 200 × 50 = 10K tokens = $0.003
- **Total: ~$0.02/developer/day**
- **Monthly: ~$0.50/developer/month**

This is 50-100x cheaper than using Claude or GPT-4 for completions!

---

## Sources & References

- [DeepSeek FIM API Documentation](https://api-docs.deepseek.com/guides/fim_completion)
- [OpenAI FIM Research Paper](https://arxiv.org/pdf/2207.14255)
- [Minuet-AI - Multi-provider completion](https://github.com/milanglacier/minuet-ai.nvim)
- [Best AI Coding Models 2025](https://dev.to/apipie-ai/top-5-ai-coding-models-of-march-2025-5f04)
- [System Design: Autocomplete](https://lopespm.com/2020/08/03/implementation-autocomplete-system-design.html)
